import { ChevronRight } from "lucide-react";
import { StageBadge } from "@/features/projects/stage-badge";
import type { Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import type { TagsController } from "@/features/tags/use-tags";
import { ViewBriefButton } from "@/features/projects/brief-prompt";
import {
  ProjectActions,
  type ProjectActionHandlers,
} from "@/features/projects/project-actions";
import { nextStep } from "@/features/projects/next-step";
import { isInProgress } from "@/features/projects/project-progress";
import { ProjectProgress } from "@/features/projects/project-progress-view";
import { projectStatus } from "@/features/projects/project-status";
import { ProjectTags } from "@/features/projects/project-tags";
import { Badge } from "@/components/ui/badge";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * Cabeçalho do diálogo: identidade do projeto, o que dá para fazer com ele e
 * o caminho da pasta aberta.
 */
export function ProjectFilesHeader({
  project,
  tags,
  trail,
  onNavigateTo,
  actions,
  onTagsChange,
  claudeOpen = false,
}: {
  project: Project;
  tags: TagsController;
  /** A aba do Claude está aberta: o passo que só levaria até ela não aparece. */
  claudeOpen?: boolean;
  trail: Crumb[];
  /** Voltar para um nível do caminho (índice dentro da trilha). */
  onNavigateTo: (index: number) => void;
  actions: ProjectActionHandlers;
  onTagsChange: (project: Project, tagIds: string[]) => void;
}) {
  const meta = projectIdentity(project);
  const status = projectStatus(project);
  const emCurso = isInProgress(project);

  return (
    <DialogHeader className="gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <DialogTitle className="text-lg">{meta.label}</DialogTitle>
        <StageBadge project={project} />
        {meta.collectedAt && (
          <Badge variant="secondary">
            Coletado em {meta.collectedAt.toLocaleDateString("pt-BR")}
          </Badge>
        )}
        {/* O mesmo próximo passo e o mesmo menu do card: antes o destaque
            aqui era sempre "Gerar site", mesmo com o site pronto e o card
            pedindo "Enviar ao cliente". */}
        <div className="ml-auto flex items-center gap-1">
          {project.brief && <ViewBriefButton project={project} />}
          <ProjectActions
            project={project}
            {...actions}
            stepInView={claudeOpen && nextStep(project).kind === "claude"}
          />
        </div>
      </div>

      {/* O que falta, por extenso — no card cabe uma linha; aqui cabe a
          frase inteira. Com algo em curso, o andamento toma o lugar. */}
      {emCurso ? (
        <ProjectProgress project={project} className="max-w-xl" />
      ) : (
        <p className="text-sm text-muted-foreground">{status.detail}</p>
      )}

      {/* O mesmo componente do card: mesma aparência e a mesma regra de
          permissão (sem "organizar", as tags aparecem sem o "x"). */}
      <ProjectTags project={project} tags={tags} onChange={onTagsChange} />

      {/* A trilha só ajuda dentro de uma subpasta. Na raiz ela repetia o nome
          da pasta logo abaixo do título; fica só para leitores de tela, que
          usam a descrição do diálogo. */}
      <DialogDescription asChild>
        <div
          className={cn(
            "flex items-center gap-1 text-xs",
            trail.length <= 1 && "sr-only",
          )}
        >
          {trail.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 opacity-60" />}
              <button
                type="button"
                onClick={() => onNavigateTo(index)}
                disabled={index === trail.length - 1}
                className={cn(
                  "max-w-56 truncate rounded px-1 py-0.5",
                  index === trail.length - 1
                    ? "font-medium text-foreground"
                    : "hover:bg-muted hover:text-foreground",
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      </DialogDescription>
    </DialogHeader>
  );
}
