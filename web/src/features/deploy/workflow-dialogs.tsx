import { FileCode2 } from "lucide-react";
import type { RepoOption, WorkflowFile } from "@/lib/api/deploy";
import type { PreviewContent } from "./deploy-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Confirmação da limpeza dos workflows.
 *
 * A lista dos arquivos vai junto de propósito: a remoção alcança todo YAML em
 * `.github/workflows`, inclusive o que não foi criado pelo painel.
 */
export function ClearWorkflowsDialog({
  open,
  onOpenChange,
  repo,
  files,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repo?: RepoOption;
  files: WorkflowFile[];
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover os workflows?</AlertDialogTitle>
          <AlertDialogDescription>
            A remoção alcança todo YAML em <code>.github/workflows</code> de{" "}
            <b>{repo?.fullName}</b> — inclusive arquivos que não foram criados
            por este painel. O commit vai direto para a branch{" "}
            <b>{repo?.defaultBranch}</b>.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
          {files.map((file) => (
            <li key={file.sha} className="flex items-center gap-2">
              <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{file.name}</span>
              {file.templateVersion !== undefined && (
                <Badge variant="secondary" className="ml-auto">
                  do painel
                </Badge>
              )}
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Sim, remover {files.length} arquivo(s)
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** O conteúdo atual de um workflow, como está no repositório. */
export function WorkflowPreviewDialog({
  preview,
  repoFullName,
  onClose,
}: {
  preview: PreviewContent | null;
  repoFullName?: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={onClose}>
      <DialogContent layout="sectioned" className="h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">{preview?.name}</DialogTitle>
          <DialogDescription>
            Conteúdo atual no repositório
            {repoFullName ? ` · ${repoFullName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1">
          <pre className="p-6 font-mono text-xs leading-relaxed">
            <code>{preview?.content}</code>
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
