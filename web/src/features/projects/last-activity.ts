import type { Project } from "@/lib/api";
import { progressOf } from "./project-progress";
import { projectTimeline } from "./project-timeline";

/**
 * A última atividade do projeto: quando e o que aconteceu.
 *
 * Antes era o `modifiedTime` mais recente da pasta no Drive — que, num
 * upload, é a data do arquivo no computador do cliente — e nada do que o
 * painel fazia contava: uma publicação que falhou há 4 horas aparecia como
 * "atividade há 1 mês". Agora é o acontecimento mais recente de verdade: o
 * que está em curso (com o que ele está fazendo) ou o último marco da linha do
 * tempo — Drive, geração, Claude, link, entrega e publicação.
 *
 * A coluna "Última atividade", a ordenação por atividade e a atividade
 * recente leem daqui.
 */
export type LastActivity = {
  at: string;
  /** O que aconteceu, numa linha. */
  title: string;
  /** Um detalhe para o tooltip (passo do deploy, arquivos escritos). */
  detail: string | null;
  by: string | null;
  /** Em curso agora: o painel acompanha. */
  running: boolean;
};

export function lastActivityOf(project: Project): LastActivity | null {
  const progress = progressOf(project);
  if (progress?.startedAt) {
    if (progress.kind === "run") {
      return { at: progress.startedAt, title: progress.title, detail: progress.step, by: null, running: true };
    }
    const doClaude = Boolean(project.claude?.queue && project.claude.queue.estado !== "interrompida");
    const ativa = progress.phases.find((phase) => phase.state === "active")?.label;
    return {
      at: progress.startedAt,
      // No Lovable, a fase do agente diz mais que o título ("Gerando no
      // Lovable"); no Claude, o título já diz a etapa ou a posição na fila.
      title: doClaude || progress.waiting || !ativa ? progress.title : ativa,
      detail: progress.counts ?? progress.current,
      by: null,
      running: true,
    };
  }
  const last = projectTimeline(project).at(-1);
  return last ? { at: last.at, title: last.title, detail: last.detail, by: last.by, running: false } : null;
}
