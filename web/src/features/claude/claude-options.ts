import { ART_DIRECTION_LEVELS, EFFORT_LABELS, MOTION_LEVELS } from "@shared/claude-options.js";
import type { ClaudeEffort, ClaudeOptions, ClaudeRunChoices, ClaudeSiteOptions } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { linesToList } from "./briefing-fields";

/*
 * As opções de um projeto no motor Claude, na língua de quem opera: o nome de
 * cada nível, a frase que diz o que ele muda no site, o rótulo de "padrão do
 * painel" e o corpo que segue com o pedido.
 *
 * Em toda opção, `null` é "o padrão do painel": a pessoa não escolheu nada, e
 * vale o das Configurações. A tela mostra qual é o padrão hoje, mas nunca o
 * manda como se fosse uma escolha — assim o projeto acompanha o padrão quando
 * ele mudar.
 */

/** O Select não aceita valor vazio: "o padrão do painel" é uma opção de verdade. */
export const PADRAO = "__padrao__";
/** No seletor de modelo: um id que não está na lista, digitado à mão. */
export const OUTRO_MODELO = "__outro__";

export const MAX_LINKS = 5;
export const MAX_NOTAS = 1200;
/** Quantas rodadas de crítica e refino um site pode ter. */
export const RODADAS = [1, 2, 3, 4];

type Defaults = ClaudeOptions["defaults"];

/** "Padrão do painel (Opus 5.5)": a opção que não escolhe nada, com o que vale hoje. */
export const defaultLabel = (atual: string | null | undefined) =>
  atual ? `Padrão do painel (${atual})` : "Padrão do painel";

/* ---- modelo e esforço -------------------------------------------------- */

/** O nível de esforço por extenso; um nível que a tela não conhece vai como veio. */
export const effortLabel = (nivel: string) => EFFORT_LABELS[nivel as ClaudeEffort] ?? nivel;

/** O nome do modelo; um id fora da lista vai como foi digitado. */
export const modelLabel = (id: string, modelos: Defaults["modelos"]) =>
  modelos.find((modelo) => modelo.id === id)?.rotulo ?? id;

/**
 * O que o seletor de modelo mostra marcado: o padrão, um dos conhecidos ou
 * "outro" — quando o id gravado não está na lista, ou a pessoa pediu a caixa
 * para digitar um.
 */
export function modelSelection(modelo: string | null, modelos: Defaults["modelos"], digitando: boolean) {
  if (digitando) return OUTRO_MODELO;
  if (modelo === null) return PADRAO;
  return modelos.some((item) => item.id === modelo) ? modelo : OUTRO_MODELO;
}

type InEffect = { label: string; value: string; chosen: boolean };

/** O modelo e o esforço como valem: a escolha do projeto ou, sem ela, o padrão do painel. */
function choicesInEffect(choices: ClaudeRunChoices, defaults: Defaults): { modelo: InEffect; esforco: InEffect } {
  const modelo = choices.modelo ?? defaults.modelo;
  const esforco = choices.esforco ?? defaults.esforco;
  return {
    modelo: { value: modelo, label: modelLabel(modelo, defaults.modelos), chosen: choices.modelo !== null },
    esforco: { value: esforco, label: effortLabel(esforco), chosen: choices.esforco !== null },
  };
}

/** "Opus 5.5 (claude-opus-5-5)": o nome e o valor que vai ao claude, quando são diferentes. */
const withValue = ({ label, value }: InEffect) => (label === value ? label : `${label} (${value})`);

/**
 * A linha do ensaio: o modelo e o esforço do comando conferido, com o valor
 * que o motor recebe — é o que aparece no comando.
 */
export function choicesLine(choices: ClaudeRunChoices, defaults: Defaults) {
  const { modelo, esforco } = choicesInEffect(choices, defaults);
  const origem = (item: InEffect) => (item.chosen ? "" : ", padrão do painel");
  return `Modelo: ${withValue(modelo)}${origem(modelo)} · Esforço: ${withValue(esforco)}${origem(esforco)}`;
}

/** Com que modelo e esforço a execução vai rodar, dentro de uma frase. */
export function choicesSentence(choices: ClaudeRunChoices, defaults: Defaults) {
  const { modelo, esforco } = choicesInEffect(choices, defaults);
  const nivel = esforco.label.toLowerCase();
  if (modelo.chosen === esforco.chosen) {
    return `modelo ${modelo.label} e esforço ${nivel}, ${modelo.chosen ? "escolhidos para este projeto" : "os padrões do painel"}`;
  }
  const origem = (item: InEffect) => (item.chosen ? "deste projeto" : "padrão do painel");
  return `modelo ${modelo.label} (${origem(modelo)}) e esforço ${nivel} (${origem(esforco)})`;
}

/** O que a pessoa mudou em relação ao que o projeto tem gravado? */
export const sameChoices = (a: ClaudeRunChoices, b: ClaudeRunChoices) =>
  a.modelo === b.modelo && a.esforco === b.esforco;

/*
 * Cada ajuda tem a frase curta, que fica à vista sob o campo, e a longa, que
 * abre no "?" ao lado do rótulo: seis parágrafos fixos empurravam o botão de
 * gerar para o fim de várias telas de rolagem.
 */
export const MODEL_HINT = "Quem escreve o briefing, o site e os ajustes.";
export const MODEL_HELP =
  "Quem escreve o briefing, o site e os ajustes. Um modelo mais capaz resolve melhor o desenho e o texto, e consome mais da assinatura.";
export const EFFORT_HINT = "Quanto o Claude pensa antes de escrever.";
export const EFFORT_HELP =
  "Quanto o Claude pensa antes de escrever. Mais esforço dá um site mais bem resolvido; cada execução demora mais e consome mais da assinatura.";

/* ---- opções do site ---------------------------------------------------- */

export type Level = { value: string; label: string; help: string };

/** A frase de cada nível; o valor e o nome vêm de `shared/claude-options.js`, os mesmos da tela de Configurações. */
const LEVEL_HELP: Record<string, string> = {
  sobria: "Composição clara e estável, com a cor da marca na medida. Para clientes que pedem sobriedade.",
  autoral: "Uma ideia de composição própria do negócio, do cabeçalho ao rodapé, sem estranheza gratuita.",
  ousada: "Composição que surpreende quem conhece o ramo. Para clientes que comportam risco.",
  discreto: "Entradas curtas, quase imperceptíveis: boa parte da página fica parada.",
  expressivo: "Cada seção tem a sua animação, e a página responde à rolagem sem atrapalhar a leitura.",
  cinematografico: "O movimento conduz a visita: a abertura e a rolagem são pensadas como um filme curto.",
};

const withHelp = (levels: { value: string; label: string }[]): Level[] =>
  levels.map(({ value, label }) => ({ value, label, help: LEVEL_HELP[value] }));

/** Até onde o visual do site se afasta do convencional. */
export const ART_DIRECTIONS: Level[] = withHelp(ART_DIRECTION_LEVELS);

/** Quanta animação o site leva. */
export const MOTIONS: Level[] = withHelp(MOTION_LEVELS);

/** O nome de um nível; um valor que a tela não conhece vai como veio. */
export const levelLabel = (levels: Level[], value: string) =>
  levels.find((level) => level.value === value)?.label ?? value;

/** A frase do nível que vale: o escolhido ou, sem escolha, o padrão. */
export const levelHelp = (levels: Level[], value: string | null, padrao: string) =>
  levels.find((level) => level.value === (value ?? padrao))?.help ?? null;

export const roundsLabel = (rodadas: number) => pluralize(rodadas, "rodada");

export const ROUNDS_HINT = "Cada rodada deixa o site melhor e leva mais tempo.";
export const ROUNDS_HELP =
  "Depois de pronto, o site é criticado por uma conversa que não o escreveu e refinado por quem o escreveu. Cada rodada deixa o site melhor e leva mais tempo.";

/** "Escolher a rota" no seletor: sim ou não, além do padrão. */
export const ROUTE_CHOICES = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

export const routeChoiceValue = (escolher: boolean | null) => (escolher === null ? null : escolher ? "sim" : "nao");

export const routeChoiceHelp = (escolher: boolean) =>
  escolher
    ? "A criação para depois da direção criativa: você vê as três rotas propostas e aprova a escolhida ou pede outra."
    : "O site segue direto com a rota que o Claude escolher, sem parar para aprovação.";

export const REFERENCES_HINT = "Sites públicos que o cliente admira: servem de norte, sem cópia.";
export const REFERENCES_HELP =
  "Sites que o cliente admira. A direção criativa os vê fotografados e usa como norte, sem copiar. Só entram sites públicos da internet.";

/** As opções do site como a tela as edita: os links das referências num texto, um por linha. */
export type SiteOptionsDraft = Omit<ClaudeSiteOptions, "referencias"> & { links: string; notas: string };

/**
 * O rascunho a partir do que o briefing tem gravado. Sem briefing, ou num
 * briefing de antes das opções de criação, vale tudo no padrão.
 */
export function siteOptionsDraft(opcoes: ClaudeSiteOptions | null): SiteOptionsDraft {
  return {
    multiplas_paginas: opcoes?.multiplas_paginas ?? false,
    banco_de_imagens: opcoes?.banco_de_imagens ?? true,
    skills: opcoes?.skills ?? [],
    observacoes: opcoes?.observacoes ?? "",
    rodadas: opcoes?.rodadas ?? null,
    direcao_de_arte: opcoes?.direcao_de_arte ?? null,
    movimento: opcoes?.movimento ?? null,
    escolher_rota: opcoes?.escolher_rota ?? null,
    links: (opcoes?.referencias?.links ?? []).join("\n"),
    notas: opcoes?.referencias?.notas ?? "",
  };
}

/**
 * O que segue ao servidor. Vai sempre inteiro: o motor grava as opções como
 * chegam, e uma chave ausente voltaria ao padrão.
 */
export function siteOptionsPayload({ links, notas, ...opcoes }: SiteOptionsDraft): ClaudeSiteOptions {
  return { ...opcoes, referencias: { links: linesToList(links), notas: notas.trim() } };
}

/** O que impede de mandar as opções — o mesmo que o motor recusaria, dito antes. */
export function siteOptionsProblem(draft: SiteOptionsDraft): string | null {
  const { referencias } = siteOptionsPayload(draft);
  if (referencias.links.length > MAX_LINKS) {
    return `As referências têm ${referencias.links.length} links; o limite é ${MAX_LINKS} por site.`;
  }
  if (referencias.notas.length > MAX_NOTAS) {
    return `As notas das referências têm ${referencias.notas.length.toLocaleString("pt-BR")} caracteres; o limite é ${MAX_NOTAS.toLocaleString("pt-BR")}.`;
  }
  return null;
}

/**
 * Quantas das opções que a revisão guarda em "Opções avançadas" saíram do
 * padrão: com alguma, o bloco abre sozinho — ninguém gera um site sem ver
 * uma escolha que não é a de sempre.
 */
export function advancedOptionsChanged(draft: SiteOptionsDraft): number {
  const padrao = siteOptionsDraft(null);
  return [
    draft.rodadas !== null,
    draft.escolher_rota !== null,
    draft.direcao_de_arte !== null,
    draft.movimento !== null,
    draft.multiplas_paginas !== padrao.multiplas_paginas,
    draft.banco_de_imagens !== padrao.banco_de_imagens,
    draft.skills.length > 0,
    draft.links.trim() !== "",
    draft.notas.trim() !== "",
    draft.observacoes.trim() !== "",
  ].filter(Boolean).length;
}

/** As opções do rascunho são as mesmas que estão gravadas? A ordem das skills não conta. */
export function sameSiteOptions(a: SiteOptionsDraft, b: SiteOptionsDraft) {
  const normal = (draft: SiteOptionsDraft) => {
    const opcoes = siteOptionsPayload(draft);
    return JSON.stringify({ ...opcoes, skills: [...opcoes.skills].sort() });
  };
  return normal(a) === normal(b);
}
