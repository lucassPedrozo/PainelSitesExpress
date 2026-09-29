import type { AgentActivity, Project, RunProgress } from "@/lib/api";
import { devAreaOf, latestGeneration } from "./project-status";

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

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * O que está em curso, por ordem de importância: a publicação no domínio do
 * cliente, o agente do Lovable e a área de aprovação. `null` quando nada roda.
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

/** "45 s", "3 min 12 s", "1 h 05 min". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  if (horas > 0) return `${horas} h ${String(minutos).padStart(2, "0")} min`;
  if (minutos > 0) return `${minutos} min ${String(segundos).padStart(2, "0")} s`;
  return `${segundos} s`;
}
