import type { Generation, Project } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import type { ProjectActionHandlers } from "@/features/projects/project-actions";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SHARE_PREVIEW_INPUT_ID } from "./share-input-id";
import { ProjectFilesBrowser } from "./project-files-browser";

/**
 * O material da coleta, dentro do painel: arquivos, briefing, tags, link do
 * cliente e os atalhos para gerar e publicar.
 */
export function ProjectFilesDialog({
  project,
  tags,
  focusShareInput = false,
  onOpenChange,
  actions,
  onTagsChange,
  onGenerationChange,
}: {
  project: Project | null;
  tags: TagsController;
  /** Aberto por "Criar link": o campo do Share preview já vem em foco. */
  focusShareInput?: boolean;
  onOpenChange: (open: boolean) => void;
  /** As mesmas ações do card: o modal mostra o mesmo próximo passo. */
  actions: ProjectActionHandlers;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  onGenerationChange: (project: Project, generation: Generation) => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent
        layout="sectioned"
        className="h-[90vh] sm:max-w-[min(1100px,95vw)]"
        // O foco automático do diálogo iria para o primeiro botão, tirando-o
        // do campo do Share preview que o "Criar link" quer deixar pronto.
        onOpenAutoFocus={(event) => {
          const campo = focusShareInput
            ? document.getElementById(SHARE_PREVIEW_INPUT_ID)
            : null;
          if (!campo) return;
          event.preventDefault();
          campo.focus();
        }}
      >
        {project && (
          <ProjectFilesBrowser
            key={project.id}
            project={project}
            tags={tags}
            focusShareInput={focusShareInput}
            actions={actions}
            onTagsChange={onTagsChange}
            onGenerationChange={onGenerationChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
