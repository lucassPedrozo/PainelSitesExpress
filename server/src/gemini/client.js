import { httpError } from "../http.js";

/**
 * Cliente do Gemini (API Generative Language) para o assistente da geração.
 *
 * A chave (`GEMINI_API_KEY`) é do nível gratuito do Google AI Studio e tem de
 * continuar assim. O que o painel faz para isso:
 *
 * - só usa modelos Flash, os do nível gratuito — um id sem "flash" é recusado;
 * - nada roda sozinho: toda chamada nasce de um clique na tela;
 * - a resposta de cada análise fica guardada por 24 h (`briefing.js`);
 * - quando um modelo responde "cota esgotada" (429), some (404) ou está
 *   sobrecarregado (503), o painel tenta o próximo — a chave pode transitar
 *   entre os modelos do Google.
 *
 * Os ids de modelo mudam depressa: o `gemini-2.5-flash` deixou de aceitar
 * usuários novos em pouco mais de um ano. Por isso o padrão são os apelidos
 * que o Google mantém apontando para o Flash atual, e, se nem eles
 * responderem, o painel procura no catálogo da própria chave outro modelo
 * Flash de texto (a listagem é gratuita).
 *
 * A chave vai num cabeçalho, nunca na URL: assim não entra em log nem em
 * mensagem de erro. O navegador nunca a recebe.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 45_000;
/** O catálogo da chave muda pouco; uma listagem por hora basta. */
const CATALOG_TTL_MS = 60 * 60_000;
/** Quantos modelos do catálogo tentar além dos padrão. */
const DISCOVERY_ATTEMPTS = 3;

/**
 * Os apelidos do nível gratuito, que o Google mantém apontando para o Flash
 * Lite e o Flash mais novos — não envelhecem como um id com versão. O Lite
 * vem primeiro: responde em um segundo e basta para a análise; o Flash
 * completo "pensa" antes de responder (20 s ou mais, medido) e fica para
 * quando o Lite estiver sem cota.
 */
export const FREE_TIER_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

/**
 * O que acelera a resposta: o pensamento desligado no 2.5 Flash e no nível
 * mais baixo nos 3.x e no apelido do Flash completo. Os Lite não pensam por
 * padrão. Um modelo que recusar o parâmetro é chamado de novo sem ele.
 *
 * @param {string} model
 */
export function thinkingFor(model) {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/lite/i.test(model)) return null;
  if (/^gemini-(3|flash-latest)/.test(model)) return { thinkingLevel: "low" };
  return null;
}

/** Lidos a cada uso: a tela de Configurações grava com o painel de pé. */
export const geminiKey = () => (process.env.GEMINI_API_KEY ?? "").trim();
export const geminiPreferredModel = () => (process.env.GEMINI_MODEL ?? "").trim();
export const isGeminiConfigured = () => Boolean(geminiKey());

/** Só modelos Flash: são os do nível gratuito. */
export const isFlashModel = (id) => /flash/i.test(String(id));

/** Variantes Flash que não geram texto — imagem, voz, áudio ao vivo. */
const NOT_TEXT = /image|tts|audio|live|transcribe|omni|robotics|computer-use/i;

/**
 * Os modelos Flash de texto de um catálogo, do mais novo ao mais antigo: os
 * apelidos "latest" primeiro, depois por versão; dentro da mesma versão, o
 * completo antes do Lite e o estável antes do preview.
 *
 * @param {string[]} models
 */
export function flashTextModels(models) {
  const versao = (id) => {
    const v = id.match(/(\d+(?:\.\d+)?)/);
    return v ? Number(v[1]) : Number.POSITIVE_INFINITY;
  };
  const peso = (id) => (/-lite/i.test(id) ? 1 : 0) + (/preview|exp/i.test(id) ? 2 : 0);
  return models
    .filter((id) => isFlashModel(id) && !NOT_TEXT.test(id))
    .sort((a, b) => versao(b) - versao(a) || peso(a) - peso(b) || a.localeCompare(b));
}

/** A ordem de tentativa: o preferido, se houver, e depois os apelidos. */
export function candidateModels(preferred = geminiPreferredModel()) {
  const lista = preferred ? [preferred, ...FREE_TIER_MODELS] : [...FREE_TIER_MODELS];
  return [...new Set(lista)];
}

export const NOT_CONFIGURED =
  "A chave do Gemini não está configurada. Preencha-a em Configurações → Assistente (Gemini).";

/** Uma chave do Google, se escapar numa mensagem, vira "AIza…". */
const redact = (text) => String(text ?? "").replace(/AIza[0-9A-Za-z_-]{35}/g, "AIza…");

/** Erro da API do Google: `{ error: { code, status, message } }`. */
async function readError(res) {
  const body = /** @type {any} */ (await res.json().catch(() => null));
  return {
    status: String(body?.error?.status ?? ""),
    message: redact(body?.error?.message ?? "").slice(0, 200),
  };
}

/** A mensagem de uma recusa, escrita para quem usa o painel. */
export function describeFailure(httpStatus, apiStatus, message) {
  if (httpStatus === 400 && /api key/i.test(message)) {
    return "O Gemini recusou a chave configurada. Confira GEMINI_API_KEY em Configurações → Assistente (Gemini).";
  }
  if (httpStatus === 403) {
    return "A chave do Gemini não tem permissão para usar a API. Confira se ela foi criada no Google AI Studio.";
  }
  if (httpStatus === 429) {
    return "A cota gratuita do Gemini esgotou por agora. Aguarde um minuto e tente de novo.";
  }
  const detalhe = [apiStatus && `(${apiStatus})`, message && `: ${message}`].filter(Boolean).join("");
  return `O Gemini respondeu ${httpStatus}${detalhe ? ` ${detalhe}`.replace(" :", ":") : ""}.`;
}

/**
 * Cliente com as dependências explícitas: os testes trocam o `fetch`, a chave
 * e o modelo preferido sem tocar na rede.
 *
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => string} [deps.apiKey]
 * @param {() => string} [deps.preferredModel]
 * @param {() => number} [deps.now]
 */
export function createGeminiClient({
  fetchImpl = (...args) => fetch(...args),
  apiKey = geminiKey,
  preferredModel = geminiPreferredModel,
  now = () => Date.now(),
} = {}) {
  /** @type {{ models: string[], expires: number } | null} */
  let catalogo = null;

  /** Chamada à API. A chave vai no cabeçalho: nunca na URL, no log ou num erro. */
  async function call(path, init = {}) {
    const key = apiKey();
    if (!key) throw httpError(409, NOT_CONFIGURED);
    try {
      return await fetchImpl(`${API_BASE}${path}`, {
        ...init,
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw httpError(
        504,
        err?.name === "TimeoutError"
          ? "O Gemini não respondeu a tempo. Tente de novo."
          : "Não foi possível falar com o Gemini. Confira a conexão desta máquina.",
      );
    }
  }

  /**
   * Os modelos que a chave alcança e que geram texto — a listagem não gera
   * nada e não custa nada. É o teste da chave na tela de Configurações.
   *
   * @returns {Promise<string[]>}
   */
  async function listModels() {
    const res = await call("/models?pageSize=200");
    if (!res.ok) {
      const { status, message } = await readError(res);
      throw httpError(502, describeFailure(res.status, status, message));
    }
    const data = /** @type {any} */ (await res.json().catch(() => null));
    const modelos = Array.isArray(data?.models) ? data.models : [];
    return modelos
      .filter((m) => (m?.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => String(m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }

  /** Os Flash de texto do catálogo da chave, lembrados por uma hora. */
  async function flashCatalog() {
    if (!catalogo || catalogo.expires <= now()) {
      catalogo = { models: flashTextModels(await listModels()), expires: now() + CATALOG_TTL_MS };
    }
    return catalogo.models;
  }

  /**
   * Uma tentativa num modelo. Cota, modelo que sumiu, sobrecarga e demora
   * voltam como `retry`, para o próximo da lista; o resto é erro de verdade.
   */
  async function attempt(model, { system, user, schema, temperature, maxOutputTokens }, thinking = thinkingFor(model)) {
    let res;
    try {
      res = await call(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature,
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: schema,
            ...(thinking ? { thinkingConfig: thinking } : {}),
          },
        }),
      });
    } catch (err) {
      // Um modelo lento não derruba a análise: o próximo pode responder.
      if (err?.status === 504 && /a tempo/.test(err.message)) {
        return { retry: true, gone: false, reason: "não respondeu a tempo" };
      }
      throw err;
    }

    if (res.status === 429 || res.status === 404 || res.status === 503) {
      await res.text().catch(() => "");
      return {
        retry: true,
        gone: res.status === 404,
        reason: res.status === 429 ? "cota esgotada" : res.status === 404 ? "modelo indisponível" : "sobrecarregado",
      };
    }
    if (!res.ok) {
      const { status, message } = await readError(res);
      // O parâmetro de pensamento muda entre gerações de modelo: recusado,
      // a mesma chamada vai sem ele.
      if (res.status === 400 && thinking && /thinking/i.test(message)) {
        return attempt(model, { system, user, schema, temperature, maxOutputTokens }, null);
      }
      throw httpError(502, describeFailure(res.status, status, message));
    }

    const data = /** @type {any} */ (await res.json().catch(() => null));
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((part) => part?.text ?? "").join("");
    if (!text) {
      const motivo = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? "resposta vazia";
      throw httpError(502, `O Gemini não devolveu a análise (${motivo}). Tente de novo.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw httpError(502, "O Gemini respondeu num formato inesperado. Tente de novo.");
    }
    return { retry: false, result: { model, data: parsed, usage: data?.usageMetadata ?? null } };
  }

  /**
   * Pede um JSON no formato do `schema`, tentando os modelos na ordem até um
   * responder. Devolve o JSON já lido e qual modelo respondeu.
   *
   * @param {{ system: string, user: string, schema: object, temperature?: number, maxOutputTokens?: number }} input
   * @returns {Promise<{ model: string, data: any, usage: any }>}
   */
  async function generateJson({ system, user, schema, temperature = 0.3, maxOutputTokens = 4096 }) {
    const pedido = { system, user, schema, temperature, maxOutputTokens };
    const tentativas = [];
    const tentados = new Set();
    let algumSumiu = false;

    const tentar = async (model) => {
      tentados.add(model);
      const r = await attempt(model, pedido);
      if (!r.retry) return r.result;
      tentativas.push(`${model}: ${r.reason}`);
      if (r.gone) algumSumiu = true;
      return null;
    };

    for (const model of candidateModels(preferredModel())) {
      if (!isFlashModel(model)) {
        tentativas.push(`${model}: fora do nível gratuito (só modelos Flash)`);
        continue;
      }
      const resultado = await tentar(model);
      if (resultado) return resultado;
    }

    // Os ids padrão envelheceram: o catálogo da chave diz o que existe hoje.
    if (algumSumiu) {
      const novos = (await flashCatalog()).filter((model) => !tentados.has(model)).slice(0, DISCOVERY_ATTEMPTS);
      for (const model of novos) {
        const resultado = await tentar(model);
        if (resultado) return resultado;
      }
    }

    throw httpError(
      429,
      `Nenhum modelo do Gemini respondeu agora (${tentativas.join("; ")}). Aguarde um minuto e tente de novo.`,
    );
  }

  return { listModels, flashCatalog, generateJson };
}

/** O cliente do painel. */
export const gemini = createGeminiClient();
