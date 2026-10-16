import { StickyNote } from "lucide-react";
import type { Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import type { TagsController } from "@/features/tags/use-tags";
import { ProjectActions, useStepBlock, type ProjectActionHandlers } from "@/features/projects/project-actions";
import { isInProgress } from "@/features/projects/project-progress";
import { ProjectProgress } from "./project-progress-view";
import { ProjectTags } from "@/features/projects/project-tags";
import { SiteEngineBadges } from "@/features/projects/site-engine-badge";
import { StageBadge } from "@/features/projects/stage-badge";
import { stageOf, toneClass } from "@/features/projects/stage";
import { Reason } from "@/components/disabled-hint";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Crumb = {
  id: string;
  name: string;
  /**
   * O nível fica dentro de um `.zip`: qual arquivo do Drive e qual pasta
   * dentro dele (vazio na raiz do zip). Ausente nas pastas do Drive.
   */
  archive?: { fileId: string; prefix: string };
  /**
   * O caminho da pasta dentro de um projeto criado no painel (vazio na raiz)
   * — é para onde vão os arquivos enviados. Ausente nas pastas do Drive.
   */
  localPath?: string;
};

/**
 * O cabeçalho do diálogo do projeto: quem ele é, em que etapa está, o que
 * fazer agora (o quê e por quê) e a ação — uma só, a mesma da lista. Antes
 * o cabeçalho tinha ainda o "Coletado em", o "Ver prompt" e a trilha de
 * pastas; o que não é do projeto inteiro desceu para a aba em que ele vale.
 */
export function ProjectFilesHeader({
  project,
  tags,
  actions,
  onTagsChange,
  stepInView = false,
}: {
  project: Project;
  tags: TagsController;
  actions: ProjectActionHandlers;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  /** A aba aberta já é o destino do passo (a do Claude): o botão não aparece. */
  stepInView?: boolean;
}) {
  const meta = projectIdentity(project);
  const stage = stageOf(project);
  const { step, reason } = useStepBlock(project, Boolean(actions.onPublishToApprovalArea));
  const titulo = meta.domain ?? meta.label;
  const subtitulo = [
    meta.label !== titulo ? meta.label : null,
    project.source === "panel" ? "Criado no painel" : null,
    project.details?.responsible ? `Responsável: ${project.details.responsible}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const emCurso = isInProgress(project);

  return (
    <DialogHeader className="gap-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* Até 15rem o título divide a linha com as ações; abaixo disso as ações
            descem, em vez de espremer o domínio e o selo. */}
        <div className="min-w-0 flex-1 basis-60 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="min-w-0 truncate text-section" title={project.name || titulo}>
              {titulo}
            </DialogTitle>
            <StageBadge view={stage} />
            <SiteEngineBadges project={project} />
          </div>
          {subtitulo && <p className="truncate text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
        <ProjectActions project={project} {...actions} size="default" stepInView={stepInView} />
      </div>

      {/* O que fazer agora, por extenso. Com algo em curso, o andamento toma o
          lugar: é ele que diz o que está acontecendo. */}
      {emCurso ? (
        <ProjectProgress project={project} className="max-w-2xl" />
      ) : (
        <div className="space-y-0.5 text-sm">
          <p className={cn("font-medium", stage.problem && toneClass[stage.tone].text)}>{step.what}</p>
          <DialogDescription>{stage.detail}</DialogDescription>
          {reason && <Reason className="pt-1">{reason}</Reason>}
        </div>
      )}
      {emCurso && <DialogDescription className="sr-only">{stage.detail}</DialogDescription>}

      {/* A observação interna inteira: na lista ela vem cortada. */}
      {project.details?.note && (
        <p className="flex max-w-3xl items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
          <StickyNote className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="whitespace-pre-wrap">
            <span className="sr-only">Observação interna: </span>
            {project.details.note}
          </span>
        </p>
      )}

      <ProjectTags project={project} tags={tags} onChange={onTagsChange} />
    </DialogHeader>
  );
}
