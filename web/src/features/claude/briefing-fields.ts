import type { ClaudeBriefing } from "@/lib/api";

/**
 * O briefing do motor, visto como campos de formulário.
 *
 * O arquivo é um JSON que o Claude escreve e a conferência do motor aceita ou
 * recusa. A tela edita os campos simples — os que mais se corrigem à mão: nome,
 * ramo, contato, textos — e deixa o resto (depoimentos, perguntas, fotos) para
 * a vista em JSON, onde o documento inteiro está à mão.
 *
 * Regra do motor que vale aqui: campo sem informação fica de fora. Apagar o
 * texto de um campo tira a chave do JSON, em vez de gravar uma string vazia.
 */

export type BriefingField = {
  /** `grupo.campo` ou `campo`. */
  path: string;
  label: string;
  /** A conferência recusa o briefing sem ele. */
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
};

export type BriefingGroup = { title: string; fields: BriefingField[] };

export const BRIEFING_GROUPS: BriefingGroup[] = [
  {
    title: "Empresa",
    fields: [
      { path: "empresa.nome", label: "Nome", required: true },
      { path: "empresa.ramo", label: "Ramo", required: true, placeholder: "O que a empresa faz" },
      { path: "empresa.cidade", label: "Cidade", placeholder: "Bairro, cidade, UF" },
      { path: "empresa.fundacao", label: "Fundação", placeholder: "Ano" },
      { path: "empresa.descricao", label: "Descrição", multiline: true, placeholder: "Duas frases sobre o negócio" },
    ],
  },
  {
    title: "Contato",
    fields: [
      { path: "contato.whatsapp", label: "WhatsApp", placeholder: "Só dígitos, com 55 e DDD" },
      { path: "contato.telefone", label: "Telefone" },
      { path: "contato.email", label: "E-mail" },
      { path: "contato.endereco", label: "Endereço", placeholder: "Rua, número, bairro, cidade, UF" },
      { path: "contato.horario", label: "Horário" },
      { path: "contato.instagram", label: "Instagram", placeholder: "@perfil" },
    ],
  },
  {
    title: "O site",
    fields: [
      { path: "objetivo", label: "Objetivo", placeholder: "O que o visitante deve fazer no site" },
      { path: "publico", label: "Público", placeholder: "Quem é o cliente do negócio" },
      { path: "sobre", label: "Sobre", multiline: true, placeholder: "A história do negócio, com datas e nomes" },
      { path: "tom_desejado", label: "Tom", placeholder: "Como o site deve falar" },
      { path: "preferencias_visuais", label: "Visual", multiline: true, placeholder: "Cores e estilo; o que evitar" },
    ],
  },
];

const partes = (path: string) => path.split(".");

/** O valor de um campo como texto — o que a caixa mostra. */
export function fieldValue(briefing: ClaudeBriefing, path: string): string {
  let atual: unknown = briefing;
  for (const parte of partes(path)) {
    if (!atual || typeof atual !== "object") return "";
    atual = (atual as Record<string, unknown>)[parte];
  }
  return typeof atual === "string" || typeof atual === "number" ? String(atual) : "";
}

/**
 * O briefing com um campo trocado. Texto vazio tira a chave; um número num
 * campo que já era número continua número (o ano de fundação).
 */
export function withField(briefing: ClaudeBriefing, path: string, value: string): ClaudeBriefing {
  const [primeira, segunda] = partes(path);
  const texto = value.trim() === "" ? undefined : value;

  const trocar = (alvo: Record<string, unknown>, chave: string) => {
    const copia = { ...alvo };
    if (texto === undefined) delete copia[chave];
    else copia[chave] = typeof alvo[chave] === "number" && /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : texto;
    return copia;
  };

  if (!segunda) return trocar(briefing, primeira) as ClaudeBriefing;
  const grupo = briefing[primeira];
  const base = grupo && typeof grupo === "object" && !Array.isArray(grupo) ? (grupo as Record<string, unknown>) : {};
  return { ...briefing, [primeira]: trocar(base, segunda) };
}

/** Uma lista de frases, uma por linha — os diferenciais. */
export const listToLines = (lista: unknown): string =>
  Array.isArray(lista) ? lista.filter((item) => typeof item === "string").join("\n") : "";

export const linesToList = (texto: string): string[] =>
  texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);

/** O briefing com a lista de diferenciais trocada; lista vazia tira a chave. */
export function withDifferentials(briefing: ClaudeBriefing, texto: string): ClaudeBriefing {
  const lista = linesToList(texto);
  const copia = { ...briefing };
  if (lista.length) copia.diferenciais = lista;
  else delete copia.diferenciais;
  return copia;
}

export type Service = { nome?: string; descricao?: string; preco?: string };

export const servicesOf = (briefing: ClaudeBriefing): Service[] =>
  Array.isArray(briefing.servicos) ? briefing.servicos : [];

/** O briefing com os serviços trocados. Em cada um, campo vazio fica de fora. */
export function withServices(briefing: ClaudeBriefing, servicos: Service[]): ClaudeBriefing {
  return {
    ...briefing,
    servicos: servicos.map((servico) =>
      Object.fromEntries(Object.entries(servico).filter(([, valor]) => typeof valor === "string" && valor.trim() !== "")),
    ),
  };
}

/** O JSON da vista de texto, como o motor o grava. */
export const briefingToJson = (briefing: ClaudeBriefing) => JSON.stringify(briefing, null, 2);

/** Lê o que foi digitado na vista em JSON. Só um objeto serve de briefing. */
export function parseBriefingJson(
  texto: string,
): { ok: true; value: ClaudeBriefing } | { ok: false; error: string } {
  let lido: unknown;
  try {
    lido = JSON.parse(texto);
  } catch (err) {
    return { ok: false, error: `O texto não é um JSON válido: ${err instanceof Error ? err.message : "erro de sintaxe"}` };
  }
  if (!lido || typeof lido !== "object" || Array.isArray(lido)) {
    return { ok: false, error: "O briefing precisa ser um objeto JSON, entre chaves." };
  }
  return { ok: true, value: lido as ClaudeBriefing };
}

/** O briefing mudou em relação ao que está gravado? */
export const sameBriefing = (a: ClaudeBriefing | null, b: ClaudeBriefing | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
