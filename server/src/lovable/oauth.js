import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { createSerialQueue, writeFileAtomic } from "../atomic-write.js";
import { httpError } from "../http.js";

/**
 * OAuth do Lovable — Dynamic Client Registration + authorization code + PKCE.
 *
 * O registro aberto do Lovable só aceita redirect de loopback ("localhost",
 * "127.0.0.1"), que é exatamente o caso deste painel. Se ele um dia sair da
 * máquina local, o registro dinâmico deixa de funcionar: troque para o fluxo
 * de client_id_metadata_document (o servidor anuncia
 * `client_id_metadata_document_supported: true`) ou peça ao suporte do Lovable
 * para colocar o redirect na allowlist.
 */

const ISSUER = "https://lovable.dev/oauth";

/** O MCP exige que o token seja emitido para ele (RFC 8707). */
export const MCP_RESOURCE = "https://mcp.lovable.dev";

const SCOPES = [
  "offline", // sem isso não vem refresh_token e o painel pediria login toda hora
  "projects:create",
  "projects:read",
  "projects:write",
  "workspaces:read",
  // Manter o bloco "Já usado" da Workspace Knowledge e as skills pede escrita
  // no workspace. Sem este escopo o Lovable recusa set_workspace_knowledge.
  "workspaces:write",
].join(" ");

const DATA_DIR = config.dataDir;
const DATA_FILE = path.join(DATA_DIR, "lovable-auth.json");

/** Teto das chamadas ao servidor de autorização do Lovable. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Margem antes do vencimento — evita usar um token que expira no meio da chamada. */
const RENEW_MARGIN_MS = 60_000;

/** Uma autorização iniciada e não concluída expira, para o state não valer para sempre. */
const PENDING_TTL_MS = 10 * 60_000;

const empty = () => ({ client: null, tokens: null, pending: null });

let state = null;
const enqueueWrite = createSerialQueue();
/** Serializa o refresh: duas chamadas simultâneas não podem gastar o mesmo refresh_token. */
let refreshing = null;

async function read() {
  if (state) return state;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    state = {
      client: parsed.client ?? null,
      tokens: parsed.tokens ?? null,
      pending: parsed.pending ?? null,
    };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    state = empty();
  }
  return state;
}

/** Escrita atômica, mesmo padrão do store das tags. */
async function flush() {
  const snapshot = JSON.stringify(state, null, 2);
  return enqueueWrite(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeFileAtomic(DATA_FILE, snapshot, { encoding: "utf8", mode: 0o600 });
  });
}

let metadataPromise = null;

/** Endpoints do authorization server — descobertos, não chumbados no código. */
function metadata() {
  metadataPromise ??= (async () => {
    const res = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw httpError(502, `Discovery do Lovable falhou (${res.status})`);
    }
    return res.json();
  })().catch((err) => {
    // Qualquer falha — inclusive rede e timeout — libera nova tentativa. Antes
    // só o status HTTP limpava o cache, e uma queda de rede ficava guardada
    // como resposta definitiva até reiniciar a API.
    metadataPromise = null;
    throw err;
  });
  return metadataPromise;
}

export const redirectUri = () =>
  `http://localhost:${config.port}/api/lovable/callback`;

const base64url = (buffer) => buffer.toString("base64url");

/** Registra o painel como cliente OAuth. Feito uma vez e reaproveitado. */
async function ensureClient() {
  const data = await read();
  const uri = redirectUri();
  // O Lovable prende os escopos ao cliente registrado: reconectar com o mesmo
  // client_id reaproveita a permissão antiga. Mudou a lista, registra outro.
  if (
    data.client?.client_id &&
    data.client.redirect_uri === uri &&
    data.client.scope === SCOPES
  ) {
    return data.client;
  }

  const { registration_endpoint } = await metadata();
  const res = await fetch(registration_endpoint, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Painel Gerenciador · Sites Express",
      redirect_uris: [uri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Cliente público: um segredo guardado no painel não seria segredo.
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });

  const body = /** @type {Record<string, any>} */ (
    await res.json().catch(() => ({}))
  );
  if (!res.ok) {
    throw httpError(
      res.status === 400 ? 400 : 502,
      body.error_description ??
        body.error ??
        `Não foi possível registrar o painel no Lovable (${res.status})`,
    );
  }

  // Os tokens em uso continuam do cliente anterior até a nova autorização.
  if (data.tokens && !data.tokens.clientId && data.client?.client_id) {
    data.tokens.clientId = data.client.client_id;
  }
  data.client = {
    client_id: body.client_id,
    redirect_uri: uri,
    scope: SCOPES,
    registeredAt: new Date().toISOString(),
  };
  await flush();
  return data.client;
}

/**
 * Monta a URL de consentimento. Quem abre é o navegador do titular da conta —
 * o painel nunca vê a senha do Lovable.
 */
export async function beginAuthorization() {
  const client = await ensureClient();
  const data = await read();
  const { authorization_endpoint } = await metadata();

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const csrf = base64url(randomBytes(16));

  data.pending = { state: csrf, verifier, createdAt: Date.now() };
  await flush();

  const url = new URL(authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", client.redirect_uri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", csrf);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", MCP_RESOURCE);

  return url.toString();
}

async function exchange(params) {
  const { token_endpoint } = await metadata();
  const res = await fetch(token_endpoint, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  const body = /** @type {Record<string, any>} */ (
    await res.json().catch(() => ({}))
  );
  if (!res.ok || !body.access_token) {
    throw httpError(
      502,
      body.error_description ??
        body.error ??
        `Troca de token falhou (${res.status})`,
    );
  }
  return body;
}

/**
 * Guarda o par de tokens com o cliente que o emitiu. Ao reconectar com
 * escopos novos o painel registra outro cliente antes de a autorização
 * terminar; a renovação dos tokens antigos precisa continuar usando o
 * client_id deles, senão falha no meio do caminho.
 */
function store(data, token, clientId) {
  data.tokens = {
    clientId,
    access_token: token.access_token,
    // Numa renovação o Lovable pode não devolver refresh_token: mantém o atual.
    refresh_token: token.refresh_token ?? data.tokens?.refresh_token ?? null,
    scope: token.scope ?? SCOPES,
    expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    connectedAt: data.tokens?.connectedAt ?? new Date().toISOString(),
  };
}

/** Tokens gravados antes de `clientId` existir vieram do cliente registrado. */
const tokenClientId = (data) => data.tokens?.clientId ?? data.client.client_id;

/** Fecha o fluxo: troca o code pelo par de tokens e guarda em disco. */
export async function completeAuthorization(code, csrf) {
  const data = await read();
  const pending = data.pending;

  if (!pending) throw httpError(400, "Nenhuma autorização em andamento");
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    data.pending = null;
    await flush();
    throw httpError(400, "A autorização expirou. Comece de novo.");
  }
  if (!csrf || csrf !== pending.state) {
    throw httpError(400, "State inválido — autorização recusada");
  }

  const token = await exchange({
    grant_type: "authorization_code",
    code,
    redirect_uri: data.client.redirect_uri,
    client_id: data.client.client_id,
    code_verifier: pending.verifier,
    resource: MCP_RESOURCE,
  });

  store(data, token, data.client.client_id);
  data.pending = null;
  await flush();
  return data.tokens;
}

/** Token válido para chamar o MCP, renovando sozinho quando falta pouco. */
export async function getAccessToken() {
  const data = await read();
  if (!data.tokens) {
    throw httpError(401, "O painel ainda não está conectado ao Lovable");
  }
  if (data.tokens.expiresAt - RENEW_MARGIN_MS > Date.now()) {
    return data.tokens.access_token;
  }
  if (!data.tokens.refresh_token) {
    throw httpError(401, "Sessão do Lovable expirada — conecte novamente");
  }

  refreshing ??= (async () => {
    try {
      const token = await exchange({
        grant_type: "refresh_token",
        refresh_token: data.tokens.refresh_token,
        client_id: tokenClientId(data),
        resource: MCP_RESOURCE,
      });
      store(data, token, tokenClientId(data));
      await flush();
      return data.tokens.access_token;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function getStatus() {
  const data = await read();
  const granted = new Set((data.tokens?.scope ?? "").split(" "));
  const missingScopes = data.tokens
    ? SCOPES.split(" ").filter((scope) => !granted.has(scope))
    : [];
  return {
    connected: Boolean(data.tokens),
    /** Conectado com uma autorização antiga, sem tudo que o painel usa. */
    missingScopes,
    registered: Boolean(data.client),
    scope: data.tokens?.scope ?? null,
    connectedAt: data.tokens?.connectedAt ?? null,
    expiresAt: data.tokens
      ? new Date(data.tokens.expiresAt).toISOString()
      : null,
    redirectUri: redirectUri(),
  };
}

/** Revoga no Lovable (best effort) e esquece os tokens locais. */
export async function disconnect() {
  const data = await read();
  const token = data.tokens?.refresh_token ?? data.tokens?.access_token;

  if (token) {
    try {
      const { revocation_endpoint } = await metadata();
      await fetch(revocation_endpoint, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, client_id: tokenClientId(data) }),
      });
    } catch (err) {
      // Revogar é cortesia; o que importa é o painel não guardar mais o token.
      console.warn("[lovable] revogação falhou:", err?.message ?? err);
    }
  }

  data.tokens = null;
  data.pending = null;
  await flush();
}
