import type { AgentActivity, ClaudeSummary, Project, RunProgress } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { claudeRoundTitle, devAreaOf, latestGeneration } from "./project-status";

/**
 * O andamento do que está em curso no projeto: a geração no Lovable ou uma
 * publicação no GitHub.
 *
 * Antes o card dizia "Gerando no Lovable" ou "Publicando" e só; não havia
 * tempo decorrido, nem sinal de que faltava pouco, e o resultado só aparecia
 * recarregando a página. Aqui cada trabalho diz há quanto tempo começou e em
 * que ponto está: a fase do agente (planejar, escrever, conferir, responder)
 * ou o passo do deploy ("7 de 12: enviando os arquivos por FTP").
 */

export type PhaseState = "done" | "active" | "todo";

export type ProgressModel =
  | {
      kind: "agent";
      title: string;
      /** Início do trabalho em curso — o relógio conta daqui. */
      startedAt: string | null;
      phases: Array<{ label: string; state: PhaseState }>;
      /** A última ação concreta do agente. */
      current: string | null;
      /** "12 arquivos escritos · 34 ações". */
      counts: string | null;
      /** Parado esperando alguém: o relógio conta a espera. */
      waiting: boolean;
      /** Na fila, ainda sem começar: espera sem alarme. */
      queued?: boolean;
    }
  | {
      kind: "run";
      title: string;
      startedAt: string | null;
      /** De 0 a 1, pelos passos concluídos; `null` antes de o job começar. */
      fraction: number | null;
      /** "Passo 7 de 12 · Enviando os arquivos por FTP". */
      step: string;
      href: string | null;
    };

const PHASE_LABELS: Array<[AgentActivity["phase"], string]> = [
  ["planning", "Planejando"],
  ["writing", "Escrevendo o site"],
  ["checking", "Conferindo o build"],
  ["answering", "Respondendo"],
];

/** Os passos dos workflows do painel, na língua de quem opera. */
const STEP_LABELS: Record<string, string> = {
  "Guard branch": "Conferindo a branch",
  "Guard production branch": "Conferindo a branch",
  "Validate deployment configuration": "Conferindo a configuração",
  "Checkout repository": "Baixando o código",
  "Detect package manager": "Detectando o gerenciador de pacotes",
  "Setup Node.js": "Preparando o ambiente",
  "Setup Bun": "Preparando o ambiente",
  "Enable Corepack": "Preparando o ambiente",
  "Prepare the dev area folder": "Preparando a pasta da área",
  "Ensure static build": "Preparando o build estático",
  "Install dependencies and build": "Instalando dependências e gerando o site",
  "Resolve build output": "Localizando o site gerado",
  "Ensure Joinvix signature": "Conferindo a assinatura Joinvix",
  "Finish the dev area build": "Finalizando o build da área",
  "Select transfer protocol": "Testando a conexão FTP",
  "Upload via FTP": "Enviando os arquivos por FTP",
  "Publication summary": "Concluindo",
};

export const stepLabel = (name: string | null) =>
  name ? (STEP_LABELS[name] ?? name) : null;

function runModel(
  title: string,
  startedAt: string | null,
  progress: RunProgress | null | undefined,
  href: string | null,
): ProgressModel {
  if (!progress) {
    return {
      kind: "run",
      title,
      startedAt,
      fraction: null,
      step: href ? "Começando no GitHub…" : "Esperando o GitHub iniciar…",
      href,
    };
  }
  const atual = Math.min(progress.done + 1, progress.total);
  const nome = stepLabel(progress.current);
  return {
    kind: "run",
    title,
    startedAt,
    fraction: progress.total ? progress.done / progress.total : null,
    step: nome ? `Passo ${atual} de ${progress.total} · ${nome}` : `Passo ${atual} de ${progress.total}`,
    href,
  };
}

const plural = pluralize;

type ClaudePhase = [etapa: string, label: string];

/** As etapas de cada pedido ao Claude, na ordem — o card mostra em qual está. */
const CLAUDE_PHASES: Record<string, ClaudePhase[]> = {
  analisar: [["briefing", "Lendo o material e escrevendo o briefing"]],
  ajuste: [["ajuste", "Ajustando o site"]],
  // O que a sessão que escreve o site faz, antes das rodadas.
  site: [
    ["direcao", "Direção criativa"],
    ["geracao", "Escrevendo o site"],
    ["revisao", "Revisando"],
  ],
  criticar: [["critica", "Crítica"]],
  refinar: [["refino", "Refino"]],
};

const CLAUDE_TITLES: Record<string, string> = {
  analisar: "Gerando briefing",
  ajuste: "Ajustando com o Claude",
  site: "Gerando com o Claude",
};

/** O que cada rodada faz, para quem passa o mouse ou abre o projeto. */
const CLAUDE_ROUND_STEPS = {
  criticar: "Outra conversa do Claude avalia o site pronto",
  refinar: "Quem escreveu o site corrige o que a crítica apontou",
} as const;

/**
 * As etapas da criação de um site, do briefing à entrega: as três de quem o
 * escreve e, por rodada, a crítica e o refino. Um site que acabou de ser
 * pedido ainda não diz quantas rodadas terá: elas entram como uma etapa só.
 * `atual` é a etapa em que o pedido está.
 */
function claudeSitePhases(
  fila: NonNullable<ClaudeSummary["queue"]>,
  site: ClaudeSummary["site"],
): { etapas: ClaudePhase[]; atual: string | null } {
  if (fila.tipo === "cliente") {
    return { etapas: [...CLAUDE_PHASES.site, ["rodadas", "Crítica e refino"]], atual: fila.etapa };
  }
  const rodadas = site?.rounds ?? 0;
  const etapas: ClaudePhase[] = [...CLAUDE_PHASES.site];
  for (let rodada = 1; rodada <= rodadas; rodada += 1) {
    etapas.push([`critica-${rodada}`, `Crítica ${rodada}`], [`refino-${rodada}`, `Refino ${rodada}`]);
  }
  if (fila.tipo !== "criticar" && fila.tipo !== "refinar") return { etapas, atual: fila.etapa };

  const etapa = fila.tipo === "criticar" ? "critica" : "refino";
  const atual = `${etapa}-${site?.round}`;
  // Sem saber a rodada (o resumo é de antes das rodadas), sobra dizer só o que roda.
  return site?.phase === etapa && etapas.some(([chave]) => chave === atual)
    ? { etapas, atual }
    : { etapas: CLAUDE_PHASES[fila.tipo], atual: etapa };
}

/** O pedido do projeto na fila do Claude: esperando a vez ou rodando. */
function claudeModel(claude: ClaudeSummary, fila: NonNullable<ClaudeSummary["queue"]>): ProgressModel {
  const pedido = fila.tipo === "analisar" || fila.tipo === "ajuste" ? fila.tipo : "site";
  const rodada = fila.tipo === "criticar" || fila.tipo === "refinar" ? fila.tipo : null;
  const { etapas, atual: etapaAtual } =
    pedido === "site" ? claudeSitePhases(fila, claude.site) : { etapas: CLAUDE_PHASES[pedido], atual: fila.etapa };
  const esperando = fila.estado === "esperando";
  // Antes de o claude abrir a primeira etapa, vale a primeira da lista.
  const atual = Math.max(0, etapas.findIndex(([etapa]) => etapa === etapaAtual));
  return {
    kind: "agent",
    title: esperando
      ? fila.posicao
        ? `Na fila do Claude · ${fila.posicao}º`
        : "Na fila do Claude"
      : rodada
        ? claudeRoundTitle(rodada, claude.site)
        : CLAUDE_TITLES[pedido],
    startedAt: esperando ? fila.criadoEm : (fila.inicio ?? fila.criadoEm),
    // Na fila, o que já foi feito continua feito: só a etapa da vez espera.
    phases: etapas.map(([, label], indice) => ({
      label,
      state: indice < atual ? "done" : indice === atual && !esperando ? "active" : "todo",
    })),
    current: esperando
      ? "Esperando a execução anterior terminar"
      : rodada
        ? CLAUDE_ROUND_STEPS[rodada]
        : etapas[atual][1],
    counts: null,
    waiting: false,
    queued: esperando,
  };
}

/**
 * O que está em curso, por ordem de importância: a publicação no domínio do
 * cliente, o pedido ao Claude, o agente do Lovable e a área de aprovação.
 * `null` quando nada roda.
 */
export function progressOf(project: Project): ProgressModel | null {
  const tentativa = project.publication?.lastAttempt;
  if (tentativa?.status === "pending") {
    return runModel(
      `Publicando em ${project.publication!.domain}`,
      tentativa.at,
      tentativa.progress,
      tentativa.runUrl,
    );
  }

  // A execução interrompida não está em curso: espera uma decisão, e é o
  // selo do card que diz isso.
  const fila = project.claude?.queue;
  if (project.claude && fila && fila.estado !== "interrompida") return claudeModel(project.claude, fila);

  const site = latestGeneration(project);
  if (site?.agentState === "running" || site?.agentState === "awaiting") {
    const atividade = site.agentActivity ?? null;
    const fase = PHASE_LABELS.findIndex(([chave]) => chave === (atividade?.phase ?? "planning"));
    const esperando = site.agentState === "awaiting";
    return {
      kind: "agent",
      title: esperando ? "Parado esperando uma resposta" : "Gerando no Lovable",
      startedAt: atividade?.startedAt ?? site.createdAt,
      phases: PHASE_LABELS.map(([, label], indice) => ({
        label,
        state: indice < fase ? "done" : indice === fase ? "active" : "todo",
      })),
      current: esperando ? null : (atividade?.current ?? "Iniciando…"),
      counts:
        atividade && atividade.steps > 0
          ? [
              atividade.filesWritten > 0
                ? plural(atividade.filesWritten, "arquivo escrito", "arquivos escritos")
                : null,
              plural(atividade.steps, "ação", "ações"),
            ]
              .filter(Boolean)
              .join(" · ")
          : null,
      waiting: esperando,
    };
  }

  const area = devAreaOf(site);
  if (area?.state === "publishing") {
    return runModel(
      "Publicando na área de aprovação",
      area.lastRun?.at ?? area.configuredAt,
      area.lastRun?.progress,
      area.lastRun?.runUrl ?? null,
    );
  }
  return null;
}

/** Algo em curso pede que a lista se atualize sozinha. */
export const isInProgress = (project: Project) => progressOf(project) !== null;

/** O cronômetro do andamento — o formato comum do painel. */
export { formatElapsed } from "@/lib/format";
