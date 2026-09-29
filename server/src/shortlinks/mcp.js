import { config } from "../config.js";

/**
 * Cliente do MCP do BetterLinks. É um servidor **stateless**: não devolve
 * `Mcp-Session-Id` e cada requisição se autentica pelo bearer, então não há
 * handshake a manter nem sessão a renovar — diferente do MCP do Lovable.
 */

const REQUEST_TIMEOUT_MS = 20_000;

let nextId = 0;

export class ShortlinkError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
    // Mensagem escrita para a interface: o tratador de erros pode devolvê-la.
    this.expose = true;
  }
}

/**
 * O BetterLinks pede confirmação antes de sobrescrever um campo: responde
 * `confirmation_required`, com o resumo e os campos que mudariam, e só grava
 * se a chamada vier de novo com `confirm: true`. Nada foi alterado ainda.
 */
export class ShortlinkConfirmationRequired extends ShortlinkError {
  /**
   * @param {string} summary
   * @param {Record<string, string>} details campo -> "antes → depois"
   */
  constructor(summary, details) {
    super(`O encurtador pediu confirmação: ${summary}`, 409);
    this.summary = summary;
    this.details = details;
  }
}

export const isConfigured = () =>
  Boolean(config.shortlinks.mcpUrl && config.shortlinks.mcpToken);

const assertConfigured = () => {
  if (!isConfigured()) {
    throw new ShortlinkError(
      "O encurtador não está configurado. Preencha-o em Configurações → Encurtador (BetterLinks).",
      503,
    );
  }
};

/**
 * O transporte aceita responder JSON puro ou SSE. Quando vem SSE, o que
 * interessa é o último `data:` — as linhas anteriores são eventos de progresso.
 */
const parseEnvelope = (texto) => {
  const corpo = texto.trim();
  if (!corpo) throw new ShortlinkError("O encurtador respondeu vazio.");

  if (!corpo.startsWith("{") && !corpo.startsWith("[")) {
    const dados = corpo
      .split("\n")
      .filter((linha) => linha.startsWith("data:"))
      .map((linha) => linha.slice(5).trim())
      .filter(Boolean);
    if (!dados.length) {
      throw new ShortlinkError("Resposta do encurtador em formato inesperado.");
    }
    return JSON.parse(dados.at(-1));
  }

  return JSON.parse(corpo);
};

const rpc = async (method, params = {}) => {
  assertConfigured();

  let response;
  try {
    response = await fetch(config.shortlinks.mcpUrl, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        Authorization: `Bearer ${config.shortlinks.mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++nextId,
        method,
        params,
      }),
    });
  } catch (error) {
    const motivo =
      error instanceof Error && error.name === "TimeoutError"
        ? "O encurtador não respondeu dentro do tempo limite."
        : "Não foi possível alcançar o encurtador.";
    throw new ShortlinkError(motivo, 504);
  }

  const texto = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new ShortlinkError(
      "O encurtador recusou o token. Confira BETTERLINKS_MCP_TOKEN.",
      502,
    );
  }
  if (!response.ok) {
    throw new ShortlinkError(
      `O encurtador respondeu ${response.status}.`,
      502,
    );
  }

  const envelope = parseEnvelope(texto);
  if (envelope.error) {
    throw new ShortlinkError(
      envelope.error.message ?? "O encurtador recusou a chamada.",
      502,
    );
  }
  return envelope.result;
};

/**
 * As tools do BetterLinks devolvem o payload como texto JSON dentro de
 * `content`, e sinalizam falha de duas formas: `isError` no resultado ou
 * `success: false` no corpo. As duas caem aqui como erro.
 */
export const callTool = async (name, args = {}) => {
  const result = await rpc("tools/call", { name, arguments: args });

  const texto = (result?.content ?? [])
    .filter((parte) => parte?.type === "text")
    .map((parte) => parte.text)
    .join("\n");

  if (result?.isError) {
    throw new ShortlinkError(texto || `A tool ${name} falhou.`, 502);
  }

  if (!texto) return null;

  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // Algumas tools respondem texto solto; devolvemos como está.
    return texto;
  }

  if (corpo?.confirmation_required) {
    throw new ShortlinkConfirmationRequired(
      String(corpo.summary ?? `A tool ${name} pediu confirmação.`),
      corpo.details && typeof corpo.details === "object" ? corpo.details : {},
    );
  }

  if (corpo && corpo.success === false) {
    throw new ShortlinkError(
      corpo.message ?? corpo.error ?? `A tool ${name} recusou a chamada.`,
      502,
    );
  }

  return corpo?.data ?? corpo;
};

/**
 * Conferência da conexão — `tools/list` não altera nada. Com descrição e
 * parâmetros: o BetterLinks muda o formato das tools sem aviso (a paginação do
 * `list-links` e o prefixo dos links apareceram assim).
 */
export const listTools = async () => {
  const result = await rpc("tools/list", {});
  return (result?.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
  }));
};
