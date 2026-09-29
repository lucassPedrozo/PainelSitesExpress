import { AlertTriangle, Eye, FileCode2, Loader2, Trash2 } from "lucide-react";
import type { DeleteWorkflowResult, WorkflowFile } from "@/lib/api/deploy";
import { formatBytes } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type WorkflowCardProps = {
  files: WorkflowFile[];
  isChecking: boolean;
  isClearing: boolean;
  busy: boolean;
  outdatedWorkflows: string[];
  deleteResult: DeleteWorkflowResult | null;
  onPreview: (file: WorkflowFile) => void;
  onClear: () => void;
};

export function WorkflowCard({
  files,
  isChecking,
  isClearing,
  busy,
  outdatedWorkflows,
  deleteResult,
  onPreview,
  onClear,
}: WorkflowCardProps) {
  const totalSize = files.reduce((total, file) => total + file.size, 0);

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Workflows no repositório</CardTitle>
          {isChecking && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <CardDescription>
          {`${files.length} arquivo(s) · ${formatBytes(totalSize)} em .github/workflows`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="overflow-hidden rounded-lg border">
          {isChecking ? (
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
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {file.path}
                    </p>
                  </div>
                  {file.templateVersion !== undefined && (
                    <Badge variant="secondary" className="shrink-0">
                      do painel
                    </Badge>
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
                  >
                    <Eye className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <FileCode2 className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum workflow encontrado</p>
              <p className="text-xs text-muted-foreground">
                Os dois workflows padrão serão criados ao salvar a configuração.
              </p>
            </div>
          )}
        </div>

        {outdatedWorkflows.length > 0 && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Workflow desatualizado</AlertTitle>
            <AlertDescription>
              {outdatedWorkflows.join(" e ")}{" "}
              {outdatedWorkflows.length > 1 ? "foram gerados" : "foi gerado"} por
              uma versão anterior do painel. Publicar continua funcionando;
              <b> Salvar configuração</b> atualiza e traz a conferência da
              assinatura Joinvix no build.
            </AlertDescription>
          </Alert>
        )}

        {deleteResult && (
          <Alert variant={deleteResult.failed.length ? "destructive" : "default"}>
            <Trash2 />
            <AlertTitle>
              {deleteResult.removed.length} removido(s),{" "}
              {deleteResult.failed.length} falha(s)
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
      </CardContent>

      {/* Remover workflows age sobre esta lista, não sobre o deploy — por isso
          saiu da fileira de botões da publicação. */}
      <CardFooter>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onClear}
          disabled={!files.length || isChecking || busy}
        >
          {isClearing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Limpar workflows
        </Button>
      </CardFooter>
    </Card>
  );
}
