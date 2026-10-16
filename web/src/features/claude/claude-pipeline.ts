import type { ClaudeCritique, ClaudeSite } from "@/lib/api";
import { pluralize } from "@/lib/format";

/*
 * A criação de um site, do briefing à entrega, e o parecer da última crítica —
 * a parte que só faz conta: em que passo o site está, quais notas ficaram
 * abaixo da de aprovação e os problemas por gravidade.
 */

/** Feito, onde o site está, pela frente — ou dispensado, quando a crítica aprovou antes. */
export type PipelineStepState = "done" | "current" | "todo" | "skipped";

export type PipelineStep = { key: string; label: string; state: PipelineStepState };

/**
 * A criação como uma linha: direção, geração, revisão, a crítica e o refino de
 * cada rodada, e a entrega. O site está entregue ao fim da última rodada, ou
 * antes, quando uma crítica o aprova — e aí o que sobrou aparece dispensado,
 * em vez de feito.
 *
 * @param critica o parecer da rodada mais recente, se houver
 */
export function pipelineSteps(pipeline: ClaudeSite["pipeline"], critica: ClaudeCritique | null): PipelineStep[] {
  const passos: Array<[key: string, label: string]> = [
    ["direcao", pipeline.fase === "aprovacao" ? "Direção · esperando aprovação" : "Direção"],
    ["geracao", "Geração"],
    ["revisao", "Revisão"],
  ];
  for (let rodada = 1; rodada <= pipeline.rodadas; rodada += 1) {
    passos.push([`critica-${rodada}`, `Crítica ${rodada}`], [`refino-${rodada}`, `Refino ${rodada}`]);
  }
  passos.push(["entregue", "Entregue"]);

  const entregue = pipeline.fase === "entregue";
  const chave =
    pipeline.fase === "critica" || pipeline.fase === "refino"
      ? `${pipeline.fase}-${pipeline.rodada}`
      : pipeline.fase === "aprovacao"
        ? "direcao"
        : pipeline.fase;
  const atual = passos.findIndex(([key]) => key === chave);
  // A crítica que aprovou encerra as rodadas: o refino dela e as seguintes não rodam.
  const aprovou = entregue && critica?.veredito === "aprovado" ? passos.findIndex(([key]) => key === `critica-${critica.rodada}`) : -1;

  return passos.map(([key, label], indice) => ({
    key,
    label,
    state: entregue
      ? aprovou >= 0 && indice > aprovou && indice < passos.length - 1
        ? "skipped"
        : "done"
      : indice < atual
        ? "done"
        : indice === atual
          ? "current"
          : "todo",
  }));
}

/** Por que o site foi entregue antes da última rodada, quando foi. */
export function pipelineNote(pipeline: ClaudeSite["pipeline"], critica: ClaudeCritique | null): string | null {
  if (pipeline.fase !== "entregue" || critica?.veredito !== "aprovado") return null;
  return critica.rodada < pipeline.rodadas
    ? `A crítica da rodada ${critica.rodada} aprovou o site: o refino dela e as rodadas seguintes não foram necessários.`
    : `A crítica da rodada ${critica.rodada} aprovou o site: o refino dela não foi necessário.`;
}

/* ---- a última crítica -------------------------------------------------- */

/** A nota a partir da qual um critério não pede mais trabalho. */
const NOTA_DE_APROVACAO = 8;

/** Os critérios do parecer, na ordem em que o motor os escreve. */
const CRITERIOS: Array<[key: string, label: string]> = [
  ["unicidade", "Unicidade"],
  ["composicao", "Composição"],
  ["tipografia", "Tipografia"],
  ["espacamento", "Espaçamento"],
  ["responsividade", "Responsividade"],
  ["movimento", "Movimento"],
  ["texto", "Texto"],
  ["acabamento", "Acabamento"],
];

export type CritiqueScore = { key: string; label: string; score: number; passing: boolean };

/** As notas na ordem do motor; um critério que a tela não conhece vai ao fim, com o nome que veio. */
export function critiqueScores(notas: ClaudeCritique["notas"]): CritiqueScore[] {
  const conhecidos = new Set(CRITERIOS.map(([key]) => key));
  const ordem = [
    ...CRITERIOS.filter(([key]) => typeof notas[key] === "number"),
    ...Object.keys(notas)
      .filter((key) => !conhecidos.has(key) && typeof notas[key] === "number")
      .map((key): [string, string] => [key, key]),
  ];
  return ordem.map(([key, label]) => ({ key, label, score: notas[key], passing: notas[key] >= NOTA_DE_APROVACAO }));
}

/** "A partir de 8…": o que as notas dizem, numa frase — a cor sozinha não basta. */
export function scoresSentence(scores: CritiqueScore[]): string {
  const abaixo = scores.filter((score) => !score.passing).map((score) => score.label.toLowerCase());
  const regra = `Notas de 0 a 10; a partir de ${NOTA_DE_APROVACAO} o critério não pede mais trabalho.`;
  if (abaixo.length === 0) return `${regra} Todos chegaram lá.`;
  const lista = abaixo.length > 1 ? `${abaixo.slice(0, -1).join(", ")} e ${abaixo.at(-1)}` : abaixo[0];
  return `${regra} ${abaixo.length > 1 ? "Ficaram" : "Ficou"} abaixo: ${lista}.`;
}

type Problem = ClaudeCritique["problemas"][number];

const GRAVIDADES: Array<{ value: Problem["gravidade"]; label: string; singular: string; plural: string }> = [
  { value: "grave", label: "Graves", singular: "grave", plural: "graves" },
  { value: "media", label: "Médios", singular: "médio", plural: "médios" },
  { value: "leve", label: "Leves", singular: "leve", plural: "leves" },
];

export type CritiqueGroup = { gravidade: Problem["gravidade"]; label: string; items: Problem[] };

/** Os problemas por gravidade, do mais grave ao mais leve; grupo vazio fica de fora. */
export function critiqueGroups(problemas: Problem[]): CritiqueGroup[] {
  return GRAVIDADES.map(({ value, label }) => ({
    gravidade: value,
    label,
    items: problemas.filter((problema) => problema.gravidade === value),
  })).filter((grupo) => grupo.items.length > 0);
}

/** "9 problemas apontados: 2 graves, 4 médios e 3 leves". */
export function problemsSummary(problemas: Problem[]): string {
  const partes = GRAVIDADES.map(({ value, singular, plural }) => {
    const quantos = problemas.filter((problema) => problema.gravidade === value).length;
    return quantos > 0 ? pluralize(quantos, singular, plural) : null;
  }).filter((parte): parte is string => parte !== null);
  const total = pluralize(problemas.length, "problema apontado", "problemas apontados");
  if (partes.length === 0) return total;
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}` : partes[0];
  return `${total}: ${lista}`;
}

/** Acima disto, a lista de problemas começa fechada: o resumo e as notas ficam à vista. */
export const MUITOS_PROBLEMAS = 4;
