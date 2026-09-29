import {
  getGitHubBaseUrl,
  getJson,
  GitHubRequestError,
  requestRaw,
} from "./client.js";

/* Quem é o token e o que ele alcança — a tela de configuração usa isto. */

const normalizeExpiration = (raw) => {
  if (!raw) return null;
  // O header vem como "2026-12-31 23:59:59 UTC"; ISO é mais fácil de formatar.
  const parsed = new Date(raw.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
};

export const getAuthenticatedUser = async (config) => {
  const response = await requestRaw(`${getGitHubBaseUrl(config)}/user`, config, {
    method: "GET",
  });
  const body = /** @type {{ login?: string }} */ (await response.json());

  return {
    login: body.login ?? "desconhecido",
    tokenExpiresAt: normalizeExpiration(
      response.headers.get("github-authentication-token-expiration"),
    ),
  };
};

/**
 * Uma página só: o diagnóstico precisa de um repositório qualquer para sondar
 * secrets e Actions, não da listagem inteira.
 */
const probeFirstRepo = async (config, organization) => {
  const orgUrl = `${getGitHubBaseUrl(config)}/orgs/${organization}/repos?per_page=1&type=all`;

  try {
    const repos = await getJson(orgUrl, config);
    if (repos.length > 0) return repos[0];
  } catch (error) {
    if (
      !(error instanceof GitHubRequestError) ||
      ![401, 403, 404].includes(error.status)
    ) {
      throw error;
    }
  }

  const userUrl = `${getGitHubBaseUrl(config)}/user/repos?per_page=100&affiliation=organization_member,collaborator,owner`;
  const repos = await getJson(userUrl, config);
  const prefix = `${organization.toLowerCase()}/`;
  return repos.find((repo) => repo.full_name.toLowerCase().startsWith(prefix));
};

const describeProbeFailure = (error, fallback) => {
  if (error instanceof GitHubRequestError) {
    if (error.status === 403 && error.requiredPermission) {
      return `Falta a permissão "${error.requiredPermission}" no token.`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
};

/**
 * Diagnóstico do token antes do primeiro deploy. Só faz leituras, então
 * confirma o acesso mas não prova as permissões de escrita: essas só são
 * exercidas de fato ao salvar a configuração de um repositório.
 */
export const checkAccess = async (config, options) => {
  const checks = [];
  let identity = null;

  try {
    identity = await getAuthenticatedUser(config);
    checks.push({
      id: "identity",
      label: "Token do GitHub",
      ok: true,
      detail: `Autenticado como ${identity.login}.`,
    });
  } catch (error) {
    checks.push({
      id: "identity",
      label: "Token do GitHub",
      ok: false,
      detail: describeProbeFailure(error, "Não foi possível validar o token."),
    });
    return { identity, checks };
  }

  let firstRepo;
  try {
    firstRepo = await probeFirstRepo(config, options.organization);
    checks.push({
      id: "organization",
      label: `Repositórios de ${options.organization}`,
      ok: Boolean(firstRepo),
      detail: firstRepo
        ? `Acesso confirmado (${firstRepo.full_name} está visível).`
        : "O token não enxerga nenhum repositório desta organização.",
    });
  } catch (error) {
    checks.push({
      id: "organization",
      label: `Repositórios de ${options.organization}`,
      ok: false,
      detail: describeProbeFailure(
        error,
        "Não foi possível listar os repositórios.",
      ),
    });
  }

  if (!firstRepo) return { identity, checks };

  const [owner = options.organization, repo = firstRepo.name] =
    firstRepo.full_name.split("/");

  try {
    await getJson(
      `${getGitHubBaseUrl(config)}/repos/${owner}/${repo}/actions/secrets/public-key`,
      config,
    );
    checks.push({
      id: "secrets",
      label: "Actions secrets",
      ok: true,
      detail: "Leitura da chave pública confirmada.",
    });
  } catch (error) {
    checks.push({
      id: "secrets",
      label: "Actions secrets",
      ok: false,
      detail: describeProbeFailure(
        error,
        "Sem acesso aos secrets do repositório.",
      ),
    });
  }

  try {
    await getJson(
      `${getGitHubBaseUrl(config)}/repos/${owner}/${repo}/actions/runs?per_page=1`,
      config,
    );
    checks.push({
      id: "actions",
      label: "GitHub Actions",
      ok: true,
      detail: "Leitura das execuções confirmada.",
    });
  } catch (error) {
    checks.push({
      id: "actions",
      label: "GitHub Actions",
      ok: false,
      detail: describeProbeFailure(error, "Sem acesso ao GitHub Actions."),
    });
  }

  return { identity, checks };
};
