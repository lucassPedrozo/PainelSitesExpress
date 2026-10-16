import { useState } from "react";
import { ChevronDown, Eye, FileCode2, Loader2, Trash2 } from "lucide-react";
import type { DeleteWorkflowResult, WorkflowFile } from "@/lib/api/deploy";
import { formatBytes, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { noPermission } from "@/features/projects/project-actions";
import { Reason } from "@/components/disabled-hint";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type WorkflowCardProps = {
  files: WorkflowFile[];
  isChecking: boolean;
  /** A leitura de `.github/workflows` falhou. */
  error: unknown;
  onRetry: () => void;
  isClearing: boolean;
  busy: boolean;
  outdatedWorkflows: string[];
  deleteResult: DeleteWorkflowResult | null;
  onPreview: (file: WorkflowFile) => void;
  onClear: () => void;
};

/**
 * Os arquivos em `.github/workflows`, para quem precisa conferir ou limpar.
 *
 * É detalhe técnico — publicar não depende de abrir isto —, então o cartão
 * nasce recolhido, com uma linha de resumo, e abre sob demanda. O aviso de
 * versão antiga não mora aqui: ele está no resumo da publicação, com a
 * instrução de como atualizar; aqui o arquivo só ganha um selo.
 */
export function WorkflowCard({
  files,
  isChecking,
  error,
  onRetry,
  isClearing,
  busy,
  outdatedWorkflows,
  deleteResult,
  onPreview,
  onClear,
}: WorkflowCardProps) {
  const [open, setOpen] = useState(false);
  const podePublicar = usePermissions().can("publicar");
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const antigos = new Set(outdatedWorkflows);

  // A linha de resumo diz a verdade em cada momento: durante a leitura e na
  // falha não há contagem (antes saía "0 arquivos · —").
  const lendo = isChecking && files.length === 0;
  const resumo = error && files.length === 0
    ? "Não foi possível ler .github/workflows"
    : lendo
      ? "Lendo .github/workflows…"
      : files.length === 0
        ? "Nenhum arquivo em .github/workflows"
        : `${pluralize(files.length, "arquivo")}${totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ""} em .github/workflows`;

  return (
    <Card className="gap-0 py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <h2 className="text-section">
          <CollapsibleTrigger className="flex w-full items-center gap-3 px-5 py-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset">
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block">Detalhes técnicos: workflows</span>
              <span
                className={cn(
                  "block truncate text-xs font-normal",
                  error && files.length === 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {resumo}
              </span>
            </span>
            {isChecking && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
        </h2>

        <CollapsibleContent className="space-y-3 px-5 pb-5">
          <div className="overflow-hidden rounded-lg border">
            {error && files.length === 0 ? (
              <ErrorNotice
                title="Não foi possível ler os workflows"
                error={error}
                onRetry={onRetry}
              />
            ) : lendo ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : files.length ? (
              <ul className="divide-y">
                {files.map((file) => (
                  <li
                    key={file.sha}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={file.name}>
                        {file.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={file.path}>
                        {file.path}
                      </p>
                    </div>
                    {antigos.has(file.name) ? (
                      <Badge variant="warning" className="shrink-0">
                        versão antiga
                      </Badge>
                    ) : (
                      file.templateVersion !== undefined && (
                        <Badge variant="secondary" className="shrink-0">
                          do painel
                        </Badge>
                      )
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatBytes(file.size)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onPreview(file)}
                      aria-label={`Visualizar ${file.name}`}
                      title="Ver o conteúdo"
                    >
                      <Eye />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNotice
                icon={<FileCode2 />}
                title="Nenhum workflow no repositório"
                description="Os dois workflows do painel são criados ao salvar a configuração."
              />
            )}
          </div>

          {deleteResult && (
            <Alert variant={deleteResult.failed.length ? "destructive" : "success"}>
              <Trash2 />
              <AlertTitle>
                {pluralize(deleteResult.removed.length, "removido")},{" "}
                {pluralize(deleteResult.failed.length, "falha")}
              </AlertTitle>
              <AlertDescription>
                {deleteResult.failed.length
                  ? deleteResult.failed
                      .map((item) => `${item.path}: ${item.message}`)
                      .join(" · ")
                  : "A pasta não possui mais workflows gerenciáveis."}
              </AlertDescription>
            </Alert>
          )}

          {/* Remover workflows age sobre esta lista, não sobre o deploy — por
              isso fica aqui dentro, longe da publicação. */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onClear}
              disabled={!files.length || isChecking || busy || !podePublicar}
            >
              {isClearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Limpar workflows
            </Button>
            {!podePublicar && <Reason className="basis-full">{noPermission.publicar}</Reason>}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
