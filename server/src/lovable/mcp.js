import { MCP_RESOURCE, getAccessToken } from "./oauth.js";
import { httpError } from "../http.js";

/**
 * Cliente MCP mínimo (Streamable HTTP) para o servidor do Lovable.
 *
 * Só o necessário para este painel: handshake, sessão e `tools/call`. O
 * servidor pode responder tanto `application/json` quanto um stream SSE de um
 * evento só, então as duas formas são aceitas.
 */

const PROTOCOL_VERSION = "2025-06-18";

/** Sessão devolvida no handshake; o Lovable a exige nas chamadas seguintes. */
let session = null;

const isObject = (value) => typeof value === "object" && value !== null;

/** Extrai o envelope JSON-RPC, seja resposta direta ou stream SSE. */
async function parseEnvelope(res, id) {
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!body) return null;

  if (!type.includes("text/event-stream")) {
    return JSON.parse(body);
  }

  let fallback = null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue; // keep-alive ou evento que não é JSON-RPC
    }
    if (event.id === id) return event;
    fallback ??= event;
  }
  return fallback;
}

let nextId = 1;

/** Teto das chamadas de conferência (handshake, `tools/list`). */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Teto de `tools/call`. Folgado de propósito: `create_project` monta o projeto
 * antes de responder, e cortar cedo demais transformaria uma criação que deu
 * certo num erro — o pior resultado possível, porque convida a gerar de novo.
 */
export const TOOL_CALL_TIMEOUT_MS = 180_000;

async function rpc(
  method,
  params,
  { notification = false, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  // Sem token a chamada nem sai daqui — logo, com certeza não foi executada.
  const token = await getAccessToken().catch((err) => {
    throw markNotProcessed(err);
  });
  const id = notification ? undefined : nextId++;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (session) headers["Mcp-Session-Id"] = session;

  let res;
  try {
    res = await fetch(MCP_RESOURCE, {
      method: "POST",
      headers,
      // Sem teto, uma chamada presa segurava a geração para sempre — e quem
      // espera tende a clicar de novo, que é justamente o que gasta crédito.
      // O sinal vale também para a leitura do corpo, mais abaixo.
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notification ? {} : { id }),
        method,
        params,
      }),
    });
  } catch (err) {
    throw unreachable(err);
  }

  // A sessão caducou: esquece e deixa o chamador refazer o handshake.
  if (res.status === 404 && session) {
    session = null;
    throw sessionExpired();
  }

  if (res.status === 401) {
    session = null;
    throw refused(401, "O Lovable recusou o token — conecte o painel de novo");
  }

  const received = res.headers.get("mcp-session-id");
  if (received) session = received;

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = `MCP ${method} falhou (${res.status}) ${detail}`.trim();
    // 4xx: a chamada foi rejeitada antes de ser executada. 5xx não permite
    // afirmar isso — o servidor pode ter feito o trabalho e falhado depois.
    throw res.status < 500 ? refused(502, message) : httpError(502, message);
  }

  if (notification) return null;

  let envelope;
  try {
    envelope = await parseEnvelope(res, id);
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw unreachable(err);
    }
    throw err;
  }
  if (envelope?.error) {
    throw refused(502, envelope.error.message ?? `Erro em ${method}`);
  }
  return envelope?.result ?? null;
}

async function handshake() {
  if (session) return;

  await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "painel-sites-express", version: "1.0.0" },
  });

  await rpc("notifications/initialized", {}, { notification: true });
}

/** Resultado de tool em objeto: prefere structuredContent, cai no texto JSON. */
function unwrap(result, toolName) {
  if (!isObject(result)) return result;

  if (result.isError) {
    const message = (result.content ?? [])
      .map((part) => part.text)
      .filter(Boolean)
      .join(" ")
      .trim();
    throw refused(502, message || `O Lovable recusou ${toolName}`);
  }

  if (isObject(result.structuredContent)) return result.structuredContent;

  const text = (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * Chama uma tool do Lovable. Refaz o handshake uma vez se a sessão tiver
 * caducado entre duas chamadas — acontece em geração longa.
 */
export async function callTool(name, args = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Falha no handshake acontece antes de a tool ser chamada.
      await handshake().catch((err) => {
        throw markNotProcessed(err);
      });
      const result = await rpc(
        "tools/call",
        { name, arguments: args },
        { timeoutMs: TOOL_CALL_TIMEOUT_MS },
      );
      return unwrap(result, name);
    } catch (err) {
      if (err.code === "MCP_SESSION_EXPIRED" && attempt === 0) continue;
      throw err;
    }
  }
}

/**
 * Lista as tools com descrição e parâmetros — chamada gratuita. Serve para
 * conferir a conexão e para ver o que o Lovable passou a aceitar: o MCP muda
 * sem aviso, e foi lendo estes esquemas que o painel descobriu o que dava
 * para automatizar.
 */
export async function listTools() {
  await handshake();
  const result = await rpc("tools/list", {});
  return (result?.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
  }));
}

function sessionExpired() {
  return Object.assign(new Error("Sessão do MCP expirada"), {
    code: "MCP_SESSION_EXPIRED",
    notProcessed: true,
  });
}

/**
 * Recusa explícita: o Lovable respondeu que **não** executou a chamada. É a
 * única situação em que tentar de novo com certeza não duplica nada — por isso
 * a marca `notProcessed`, que a geração usa para decidir se libera nova
 * tentativa.
 */
function refused(status, message) {
  return markNotProcessed(httpError(status, message));
}

function markNotProcessed(error) {
  if (error && typeof error === "object") error.notProcessed = true;
  return error;
}

/** Sem resposta: a chamada pode ou não ter sido executada do outro lado. */
function unreachable(cause) {
  const timedOut = cause?.name === "TimeoutError";
  const error = httpError(
    504,
    timedOut
      ? "O Lovable não respondeu dentro do tempo limite."
      : "Não foi possível alcançar o Lovable.",
  );
  error.cause = cause;
  return error;
}
