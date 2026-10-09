import type { Project } from "@/lib/api";
import type { DatedGroup } from "./date-groups";
import { projectStatus, type ProjectStage } from "./project-status";

/**
 * A fila de trabalho: os projetos agrupados pelo que falta fazer, na ordem de
 * urgência — o que quebrou vem antes do que espera, e o que espera o cliente
 * vem depois do que depende só de nós.
 *
 * Por data, a lista respondia "o que chegou quando"; a pergunta do dia é
 * "o que eu faço agora". Os que estão no ar não têm o que fazer e ficam fora.
 */

export type QueueKey =
  | "deploy-failed"
  | "dev-failed"
  | "link-broken"
  | "answer"
  | "claude-failed"
  | "claude-resume"
  | "claude-approve"
  | "claude-fix"
  | "claude-review"
  | "send"
  | "connect-github"
  | "link"
  | "to-github"
  | "generate"
  | "describe"
  | "publish"
  | "in-progress"
  | "empty";

/**
 * A cor do número do grupo, a mesma do selo de etapa: vermelho para o que
 * quebrou ou parou, âmbar para o que depende de alguém, nada para o resto.
 */
export type QueueTone = "destructive" | "warning" | null;

export const queueToneClass: Record<NonNullable<QueueTone>, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
};

export type QueueGroup = {
  key: QueueKey;
  /** O título do grupo na lista. */
  label: string;
  /** O mesmo grupo no resumo do topo, onde cada um divide a linha com os outros. */
  short: string;
  tone: QueueTone;
  stages: ProjectStage[];
};

export const QUEUE: QueueGroup[] = [
  { key: "deploy-failed", label: "Publicação falhou", short: "Publicação falhou", tone: "destructive", stages: ["deploy-failed"] },
  { key: "dev-failed", label: "Prévia falhou", short: "Prévia falhou", tone: "destructive", stages: ["dev-failed"] },
  { key: "link-broken", label: "Link do cliente caiu", short: "Link caiu", tone: "destructive", stages: ["delivered-broken", "link-broken"] },
  { key: "answer", label: "Agente esperando resposta", short: "Responder ao agente", tone: "destructive", stages: ["awaiting-input"] },
  { key: "claude-failed", label: "Geração pelo Claude falhou", short: "Geração falhou", tone: "destructive", stages: ["claude-failed"] },
  { key: "claude-resume", label: "Geração interrompida — retomar ou descartar", short: "Geração interrompida", tone: "warning", stages: ["claude-interrupted"] },
  { key: "claude-approve", label: "Aprovar a direção criativa", short: "Aprovar direção", tone: "warning", stages: ["claude-approval"] },
  { key: "send", label: "Enviar ao cliente", short: "Enviar ao cliente", tone: null, stages: ["ready"] },
  { key: "connect-github", label: "Conectar ao GitHub no Lovable", short: "Conectar ao GitHub", tone: "warning", stages: ["connect-github"] },
  { key: "link", label: "Criar ou conferir o link", short: "Criar o link", tone: "warning", stages: ["generated"] },
  { key: "to-github", label: "Enviar o site ao GitHub", short: "Enviar ao GitHub", tone: "warning", stages: ["to-github"] },
  { key: "claude-fix", label: "Corrigir o briefing do Claude", short: "Corrigir briefing", tone: "warning", stages: ["claude-brief-refused"] },
  { key: "claude-review", label: "Revisar o briefing e gerar", short: "Revisar e gerar", tone: "warning", stages: ["claude-brief-ready"] },
  { key: "generate", label: "Gerar o site", short: "Gerar o site", tone: null, stages: ["briefed"] },
  { key: "describe", label: "Sem briefing — descrever ao gerar", short: "Sem briefing", tone: null, stages: ["collected"] },
  { key: "publish", label: "Com o cliente — publicar quando aprovar", short: "Com o cliente", tone: null, stages: ["delivered"] },
  { key: "in-progress", label: "Em andamento", short: "Em andamento", tone: null, stages: ["building", "claude-building", "claude-briefing", "claude-queued", "dev-publishing", "deploying"] },
  { key: "empty", label: "Sem material", short: "Sem material", tone: "destructive", stages: ["empty"] },
];

/** O grupo da fila com esta chave — `null` para as faixas de data. */
export const queueGroupOf = (key: string): QueueGroup | null =>
  QUEUE.find((group) => group.key === key) ?? null;

const keyOfStage = new Map<ProjectStage, QueueKey>(
  QUEUE.flatMap((group) => group.stages.map((stage) => [stage, group.key] as const)),
);

/** Os que não têm nada a fazer: os que estão no ar e os projetos só de arquivos. */
export const isDone = (project: Project) => !keyOfStage.has(projectStatus(project).stage);

/** Agrupa mantendo a ordem de entrada dentro de cada grupo. */
export function groupByNextStep(projects: Project[]): Array<DatedGroup<Project>> {
  const byKey = new Map<QueueKey, Project[]>();
  for (const project of projects) {
    const key = keyOfStage.get(projectStatus(project).stage);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), project]);
  }
  return QUEUE.filter((group) => byKey.has(group.key)).map((group) => ({
    key: group.key,
    label: group.label,
    items: byKey.get(group.key)!,
  }));
}
