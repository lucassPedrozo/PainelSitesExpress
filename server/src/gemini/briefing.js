import { createHash } from "node:crypto";
import { cached } from "../cache.js";
import { httpError } from "../http.js";
import { gemini as defaultClient } from "./client.js";

/**
 * A análise do briefing pelo Gemini: o que o material tem, o que falta, o
 * que a equipe pode acrescentar nas observações e que fotos buscar no banco
 * de imagens. Tudo sugestão — nada entra no envio ao Lovable sem a pessoa
 * inserir.
 *
 * A heurística da tela (`briefing-assessment.ts`) olha tamanho e nomes de
 * arquivo; aqui o modelo lê o conteúdo. As duas coexistem: a heurística é
 * imediata e de graça, a análise é pedida com um clique.
 *
 * Para a cota gratuita durar: a mesma entrada (briefing, observações,
 * arquivos) volta do cache por 24 h, e a rota limita as chamadas por minuto.
 */

export const LIMITS = {
  briefingChars: 50_000,
  observationsChars: 10_000,
  projectNameChars: 200,
  fileNames: 120,
  fileNameChars: 200,
  /** Tetos da resposta, para a tela não virar um relatório. */
  missing: 8,
  suggestions: 6,
  suggestionChars: 700,
  imageQueries: 6,
  termChars: 100,
  sectionChars: 40,
  minQuantity: 1,
  maxQuantity: 10,
  defaultQuantity: 3,
};

const CACHE_TTL_MS = 24 * 60 * 60_000;

/**
 * O que o modelo precisa saber do trabalho. Não é o prompt do site (esse vai
 * ao Lovable e é outro): é a instrução para avaliar o briefing e sugerir.
 */
export const SYSTEM_INSTRUCTION = `Você é o assistente da equipe da Joinvix, uma agência brasileira que produz sites institucionais ("Sites Express") para pequenas e médias empresas. O site é gerado por uma IA a partir do briefing que o cliente preencheu num formulário, mais observações escritas pela equipe e os arquivos da pasta do cliente (logo, fotos, documentos).

Sua tarefa é ler o briefing e ajudar a equipe a completá-lo ANTES da geração, que custa crédito. Responda em português do Brasil, de forma direta e curta.

Regras:
- Nunca invente dados do cliente: telefone, endereço, preços, horários, nomes, números, redes sociais. Quando faltar algo, diga o que falta e o que perguntar ou decidir.
- "summary": 1 ou 2 frases dizendo que negócio é, onde atua e para quem, só com o que o briefing diz. Se não houver briefing, diga isso.
- "missing": o que o briefing não traz e um site institucional precisa — contato, endereço ou área de atendimento, serviços ou produtos, diferenciais, público, tom e estilo, cores e identidade, chamada para ação, depoimentos, horário, redes sociais. Liste só o que realmente falta, até 8 itens: "label" curto (2 a 4 palavras) e "detail" de uma frase.
- "suggestions": até 6 instruções prontas para a equipe colar nas "Observações adicionais" que vão ao gerador do site — estrutura de seções, tom, chamadas para ação, o que destacar, como tratar imagens e marca. Escreva cada "text" como instrução ao gerador, no imperativo, em 1 a 3 frases, sem placeholders entre colchetes e sem inventar fatos. "title" é um rótulo de 2 a 5 palavras.
- "imageQueries": até 6 buscas para um banco de imagens (Pixabay), para completar fotos que o cliente não enviou. "term" em português, concreto e visual (ex.: "dentista atendendo paciente"), com 2 a 4 palavras; "section" é a seção do site onde a foto entra (hero, sobre, serviços, equipe, contato…), em minúsculas; "quantity" de 2 a 4; "reason" é opcional e curta. Se os arquivos do cliente já parecem cobrir uma seção, proponha menos buscas.`;

/** O formato da resposta — o Gemini devolve JSON neste schema. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Que negócio é, onde atua e para quem, em 1 ou 2 frases." },
    missing: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Rótulo curto do que falta." },
          detail: { type: "string", description: "Uma frase: o que perguntar ou decidir." },
        },
        required: ["label", "detail"],
      },
    },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Rótulo de 2 a 5 palavras." },
          text: { type: "string", description: "Instrução pronta para as observações, no imperativo." },
        },
        required: ["title", "text"],
      },
    },
    imageQueries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string", description: "Busca em português, concreta e visual." },
          section: { type: "string", description: "Seção do site, em minúsculas." },
          quantity: { type: "integer", description: "Quantas fotos, de 2 a 4." },
          reason: { type: "string", description: "Por que esta busca, em poucas palavras." },
        },
        required: ["term", "section", "quantity"],
      },
    },
  },
  required: ["summary", "missing", "suggestions", "imageQueries"],
  propertyOrdering: ["summary", "missing", "suggestions", "imageQueries"],
};

/** Texto numa linha só, sem excesso de espaço, até `max` caracteres. */
const linha = (value, max) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Texto com parágrafos preservados, até `max` caracteres. */
const paragrafo = (value, max) =>
  typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)
    : "";

/**
 * O que chega do navegador, conferido. O briefing é o texto que está na caixa
 * (editável), não o do Drive: é ele que vai ao gerador.
 *
 * @param {unknown} raw
 * @returns {{ briefing: string, observations: string, projectName: string, fileNames: string[] }}
 */
export function parseAnalysisInput(raw) {
  const body = raw && typeof raw === "object" ? /** @type {any} */ (raw) : {};
  if (body.briefing !== undefined && typeof body.briefing !== "string") {
    throw httpError(400, "Briefing inválido.");
  }
  if (body.observations !== undefined && typeof body.observations !== "string") {
    throw httpError(400, "Observações inválidas.");
  }
  if (body.fileNames !== undefined && !Array.isArray(body.fileNames)) {
    throw httpError(400, "Lista de arquivos inválida.");
  }

  const briefing = paragrafo(body.briefing, LIMITS.briefingChars + 1);
  if (briefing.length > LIMITS.briefingChars) {
    throw httpError(400, `O briefing passa de ${LIMITS.briefingChars.toLocaleString("pt-BR")} caracteres — demais para a análise.`);
  }
  const observations = paragrafo(body.observations, LIMITS.observationsChars);
  if (!briefing && !observations) {
    throw httpError(400, "Não há briefing nem observações para analisar.");
  }

  const fileNames = (body.fileNames ?? [])
    .map((name) => linha(name, LIMITS.fileNameChars))
    .filter(Boolean)
    .slice(0, LIMITS.fileNames);

  return {
    briefing,
    observations,
    projectName: linha(body.projectName, LIMITS.projectNameChars),
    fileNames,
  };
}

/** A mensagem com o material, como o modelo a recebe. */
export function composeUserMessage({ briefing, observations, projectName, fileNames }) {
  const arquivos = fileNames.length
    ? fileNames.map((name) => `- ${name}`).join("\n")
    : "(nenhum arquivo além do briefing)";
  return [
    "# Projeto",
    `Nome: ${projectName || "(sem nome)"}`,
    "",
    `# Arquivos na pasta do cliente (${fileNames.length})`,
    arquivos,
    "",
    "# Briefing do cliente",
    briefing || "(não há briefing; a equipe vai descrever o site nas observações)",
    "",
    "# Observações já escritas pela equipe",
    observations || "(nenhuma)",
  ].join("\n");
}

const inteiro = (value, fallback) => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, LIMITS.minQuantity), LIMITS.maxQuantity);
};

/**
 * A resposta do modelo, aparada: só os campos esperados, nos tetos da tela e
 * do banco de imagens. Um item sem o essencial é descartado, não inventado.
 *
 * @param {any} data
 */
export function normalizeAnalysis(data) {
  const obj = data && typeof data === "object" ? data : {};
  const lista = (value) => (Array.isArray(value) ? value : []);

  const missing = lista(obj.missing)
    .map((item) => ({ label: linha(item?.label, 80), detail: linha(item?.detail, 300) }))
    .filter((item) => item.label)
    .slice(0, LIMITS.missing);

  const suggestions = lista(obj.suggestions)
    .map((item) => ({ title: linha(item?.title, 80), text: paragrafo(item?.text, LIMITS.suggestionChars) }))
    .filter((item) => item.text)
    .map((item) => ({ ...item, title: item.title || "Sugestão" }))
    .slice(0, LIMITS.suggestions);

  const vistos = new Set();
  const imageQueries = lista(obj.imageQueries)
    .map((item) => ({
      term: linha(item?.term, LIMITS.termChars),
      section: linha(item?.section, LIMITS.sectionChars).toLowerCase(),
      quantity: inteiro(item?.quantity, LIMITS.defaultQuantity),
      reason: linha(item?.reason, 160) || null,
    }))
    .filter((item) => {
      const chave = `${item.section}\u0000${item.term.toLowerCase()}`;
      if (!item.term || vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .slice(0, LIMITS.imageQueries);

  return { summary: linha(obj.summary, 600), missing, suggestions, imageQueries };
}

/** Resultados recém-gerados, para a resposta dizer se veio do cache. */
const recemGeradas = new WeakSet();

/**
 * Analisa o briefing — do cache, quando a mesma entrada já foi analisada nas
 * últimas 24 h.
 *
 * @param {ReturnType<typeof parseAnalysisInput>} input
 * @param {object} [deps]
 * @param {{ generateJson: Function }} [deps.client]
 * @param {() => void} [deps.beforeCall] roda só quando a API vai ser chamada
 *   de verdade — é onde a rota limita a cadência
 * @param {() => number} [deps.now]
 */
export async function analyzeBriefing(input, { client = defaultClient, beforeCall, now = () => Date.now() } = {}) {
  const chave = createHash("sha256")
    .update(JSON.stringify([input.briefing, input.observations, input.projectName, input.fileNames]))
    .digest("hex");

  const resultado = await cached(
    `gemini:briefing:${chave}`,
    async () => {
      beforeCall?.();
      const { model, data } = await client.generateJson({
        system: SYSTEM_INSTRUCTION,
        user: composeUserMessage(input),
        schema: RESPONSE_SCHEMA,
      });
      const fresco = { ...normalizeAnalysis(data), model, analyzedAt: new Date(now()).toISOString() };
      recemGeradas.add(fresco);
      return fresco;
    },
    CACHE_TTL_MS,
  );

  // Quem disparou a chamada recebe `cached: false`; quem chegou depois, `true`.
  const fresco = recemGeradas.delete(resultado);
  return { ...resultado, cached: !fresco };
}
