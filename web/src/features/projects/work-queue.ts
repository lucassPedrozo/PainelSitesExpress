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
  | "send"
  | "connect-github"
  | "link"
  | "generate"
  | "describe"
  | "publish"
  | "in-progress"
  | "empty";

export const QUEUE: Array<{ key: QueueKey; label: string; stages: ProjectStage[] }> = [
  { key: "deploy-failed", label: "Publicação falhou", stages: ["deploy-failed"] },
  { key: "dev-failed", label: "Prévia falhou", stages: ["dev-failed"] },
  { key: "link-broken", label: "Link do cliente caiu", stages: ["delivered-broken", "link-broken"] },
  { key: "answer", label: "Agente esperando resposta", stages: ["awaiting-input"] },
  { key: "send", label: "Enviar ao cliente", stages: ["ready"] },
  { key: "connect-github", label: "Conectar ao GitHub no Lovable", stages: ["connect-github"] },
  { key: "link", label: "Criar ou conferir o link", stages: ["generated"] },
  { key: "generate", label: "Gerar o site", stages: ["briefed"] },
  { key: "describe", label: "Sem briefing — descrever ao gerar", stages: ["collected"] },
  { key: "publish", label: "Com o cliente — publicar quando aprovar", stages: ["delivered"] },
  { key: "in-progress", label: "Em andamento", stages: ["building", "dev-publishing", "deploying"] },
  { key: "empty", label: "Sem material", stages: ["empty"] },
];

const keyOfStage = new Map<ProjectStage, QueueKey>(
  QUEUE.flatMap((group) => group.stages.map((stage) => [stage, group.key] as const)),
);

/** Os que não têm nada a fazer — hoje, só os que estão no ar. */
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
