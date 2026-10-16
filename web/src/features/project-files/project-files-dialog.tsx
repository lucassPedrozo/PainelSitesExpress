import type { Generation, Project } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import type { ProjectActionHandlers } from "@/features/projects/project-actions";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SHARE_PREVIEW_INPUT_ID } from "./share-input-id";
import { ProjectFilesBrowser, type ProjectTab } from "./project-files-browser";

export type { ProjectTab };

/**
 * O projeto por inteiro: o que fazer agora, o resumo (link do cliente,
 * material, publicação), os arquivos, a linha do tempo e o motor Claude.
 */
export function ProjectFilesDialog({
  project,
  tags,
  tab,
  onTabChange,
  focusShareInput = false,
  onOpenChange,
  actions,
  onTagsChange,
  onGenerationChange,
}: {
  project: Project | null;
  tags: TagsController;
  /**
   * Resumo, arquivos, linha do tempo ou Claude. Mora em quem abre o diálogo:
   * o menu da lista abre direto na linha do tempo, e "Acompanhar" na do Claude.
   */
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
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
        // Quase a tela inteira: o Resumo e a aba Claude se organizam em duas colunas
        // quando o diálogo passa de ~900px de largura.
        className="h-dialog-full max-w-dialog sm:max-w-dialog"
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
            tab={tab}
            onTabChange={onTabChange}
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
