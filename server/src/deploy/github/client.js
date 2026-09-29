/*
 * Cliente da API REST do GitHub: autenticação, mensagens de erro legíveis,
 * novas tentativas em leituras e paginação. Os endpoints usados pelo painel
 * ficam nos módulos ao lado.
 */

export class GitHubRequestError extends Error {
  /** @param {string} message @param {number} status @param {string} [requiredPermission] */
  constructor(message, status, requiredPermission) {
    super(message);
    this.status = status;
    // Mensagem escrita para a interface: o tratador de erros pode devolvê-la.
    this.expose = true;
    /** Permissão exigida pelo endpoint, quando o GitHub informa no 403. */
    this.requiredPermission = requiredPermission;
  }
}

const defaultConfig = {
  token: "",
  baseUrl: "https://api.github.com",
  userAgent: "sites-express-deploy-panel",
};

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const MAX_PAGES = 10;

export const getGitHubConfig = (overrides = {}) => ({
  ...defaultConfig,
  ...overrides,
});

const allowedTokenPrefixes = ["github_pat_"];

export const assertValidGitHubToken = (token) => {
  const normalized = token.trim();

  if (!normalized) {
    throw new Error(
      "O token do GitHub não foi definido. Informe-o em Configurações → GitHub e publicação.",
    );
  }

  if (!allowedTokenPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(
      "GITHUB_TOKEN inválido. Use um fine-grained personal access token (prefixo github_pat_).",
    );
  }

  return normalized;
};

export const createGitHubHeaders = (config) => ({
  Authorization: `Bearer ${assertValidGitHubToken(config.token)}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": config.userAgent,
});

export const getGitHubBaseUrl = (config) => config.baseUrl;

// A API do GitHub devolve um JSON detalhado; repassar o corpo inteiro polui a
// interface e pode vazar dados internos. Aqui fica apenas a mensagem curta.
export const describeGitHubFailure = (status, rawBody, requiredPermission) => {
  let detail;
  try {
    const parsed = JSON.parse(rawBody);
    detail = parsed.message ?? "";
    const first = parsed.errors?.find((item) => item.message)?.message;
    if (first && first !== detail) detail = `${detail} ${first}`.trim();
  } catch {
    detail = rawBody.slice(0, 120);
  }

  const friendly = {
    401: "Token do GitHub inválido ou expirado.",
    403: "O token não tem permissão para esta operação, ou o limite de uso foi atingido.",
    404: "Recurso não encontrado no GitHub.",
    409: "Conflito ao gravar no repositório; tente novamente.",
    422: "O GitHub recusou os dados enviados.",
  };

  const parts = [friendly[status] ?? `A API do GitHub respondeu ${status}.`];
  if (status === 403 && requiredPermission) {
    parts.push(
      `Permissão exigida pelo token: ${requiredPermission.slice(0, 120)}.`,
    );
  }
  if (detail) parts.push(`(${detail.slice(0, 200)})`);
  return parts.join(" ");
};

const isRetryableStatus = (status) =>
  status === 429 || status === 408 || (status >= 500 && status < 600);

const getRetryDelayMs = (response, attempt) => {
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10_000);
  }

  const reset = Number(response?.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const waitMs = reset * 1000 - Date.now();
    if (waitMs > 0) return Math.min(waitMs, 10_000);
  }

  return Math.min(500 * 2 ** attempt, 4_000);
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export const requestRaw = async (url, config, init) => {
  const method = (init.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { ...createGitHubHeaders(config), ...(init.headers ?? {}) },
      });
    } catch (error) {
      lastError = error;
      // Timeout e falha de rede só são repetidos em leituras: repetir uma
      // escrita sem idempotência poderia duplicar commits ou secrets.
      if (!isIdempotent || attempt === MAX_RETRIES) {
        const reason =
          error instanceof Error && error.name === "TimeoutError"
            ? "O GitHub não respondeu dentro do tempo limite."
            : "Não foi possível alcançar a API do GitHub.";
        throw new GitHubRequestError(reason, 504);
      }
      await wait(getRetryDelayMs(null, attempt));
      continue;
    }

    if (response.ok) return response;

    if (
      isIdempotent &&
      isRetryableStatus(response.status) &&
      attempt < MAX_RETRIES
    ) {
      const delay = getRetryDelayMs(response, attempt);
      await response.body?.cancel().catch(() => undefined);
      await wait(delay);
      continue;
    }

    const body = await response.text().catch(() => "");
    // Em tokens fine-grained não há como listar as permissões concedidas, mas o
    // GitHub diz no 403 qual permissão o endpoint exigia.
    const requiredPermission =
      response.headers.get("x-accepted-github-permissions") ?? undefined;
    throw new GitHubRequestError(
      describeGitHubFailure(response.status, body, requiredPermission),
      response.status,
      requiredPermission,
    );
  }

  throw new GitHubRequestError(
    lastError instanceof Error
      ? lastError.message
      : "Falha ao comunicar com o GitHub.",
    504,
  );
};

export const requestJson = async (url, config, init) => {
  const response = await requestRaw(url, config, init);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

export const requestNoContent = async (url, config, init) => {
  const response = await requestRaw(url, config, init);
  await response.body?.cancel().catch(() => undefined);
};

export const getJson = (url, config) => requestJson(url, config, { method: "GET" });

const parseNextLink = (linkHeader) => {
  if (!linkHeader) return null;
  const match = linkHeader.split(",").find((part) => /rel="next"/.test(part));
  return match?.match(/<([^>]+)>/)?.[1] ?? null;
};

// Sem paginação a listagem parava nos primeiros 100 repositórios.
export const getAllPages = async (url, config) => {
  const items = [];
  let next = url;

  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const response = await requestRaw(next, config, { method: "GET" });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : [];
    if (!Array.isArray(parsed)) break;
    items.push(...parsed);
    next = parseNextLink(response.headers.get("link"));
  }

  return items;
};
