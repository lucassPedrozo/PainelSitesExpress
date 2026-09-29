/**
 * Os provedores de modelo de IA que o motor próprio pode usar.
 *
 * Um provedor sabe: reconhecer o formato da chave, listar os modelos que o
 * painel oferece e conferir se uma chave funciona — de graça. Gerar sites é
 * do motor (`engines/own`), que recebe o cliente pronto daqui. Um provedor
 * novo entra acrescentando uma entrada, sem mexer no motor.
 */

/**
 * @typedef {{ id: string, label: string }} AiModel
 * @typedef {{ ok: true, models: string[] } | { ok: false, reason: string }} KeyCheck
 * @typedef {{
 *   id: string, label: string, keyPattern: RegExp, keyHint: string,
 *   defaultModel: string, models: AiModel[],
 *   verifyKey: (apiKey: string) => Promise<KeyCheck>,
 * }} AiProvider
 */

/**
 * O cliente do SDK carrega só quando usado: o painel sobe do mesmo jeito sem
 * IA configurada, e o SDK não pesa na partida.
 */
export async function anthropicClient(apiKey, options = {}) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return { Anthropic, client: new Anthropic({ apiKey, maxRetries: 1, ...options }) };
}

/**
 * Confere a chave listando os modelos: a listagem não gera tokens, então o
 * teste não custa nada.
 *
 * @param {string} apiKey
 * @param {typeof anthropicClient} [factory] trocada nos testes
 * @returns {Promise<KeyCheck>}
 */
export async function verifyAnthropicKey(apiKey, factory = anthropicClient) {
  const { Anthropic, client } = await factory(apiKey, { timeout: 15_000 });
  try {
    const models = [];
    for await (const model of client.models.list()) {
      models.push(model.id);
      if (models.length >= 50) break;
    }
    return { ok: true, models };
  } catch (err) {
    // Do mais específico para o mais geral: cada um pede uma ação diferente.
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "A chave foi recusada. Confira se foi copiada inteira e se não foi revogada." };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, reason: "A chave não tem permissão para usar a API." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: "Limite de requisições atingido. Tente de novo em instantes." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, reason: "Não foi possível alcançar a API. Confira a conexão desta máquina." };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, reason: `A API respondeu ${err.status ?? "com erro"}.` };
    }
    throw err;
  }
}

/** @type {Record<string, AiProvider>} */
export const AI_PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{10,}$/,
    keyHint: "começa com sk-ant-",
    defaultModel: "claude-opus-5",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
    ],
    verifyKey: (apiKey) => verifyAnthropicKey(apiKey),
  },
};

/**
 * A IA configurada no `.env`. Lida a cada chamada: a tela de configuração grava
 * e o valor novo vale na hora.
 */
export function aiConfig() {
  const providerId = (process.env.AI_PROVIDER ?? "").trim() || "anthropic";
  const provider = AI_PROVIDERS[providerId] ?? null;
  const apiKey = (process.env.AI_API_KEY ?? "").trim();
  const model = (process.env.AI_MODEL ?? "").trim() || provider?.defaultModel || "";
  return { providerId, provider, apiKey, model, configured: Boolean(provider && apiKey) };
}
