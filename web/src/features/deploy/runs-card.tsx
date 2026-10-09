import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { isRunActive, type WorkflowRun } from "@/lib/api/deploy";
import { formatDateTime, relativeTime } from "@/lib/format";
import { stepLabel } from "@/features/projects/project-progress";
import { EmptyNotice } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type RunTone = "running" | "success" | "failure" | "neutral";

const describe = (
  run: WorkflowRun,
): { label: string; tone: RunTone; Icon: typeof CheckCircle2 } => {
  if (isRunActive(run)) {
    return { label: "Em execução", tone: "running", Icon: Loader2 };
  }
  switch (run.conclusion) {
    case "success":
      return { label: "Sucesso", tone: "success", Icon: CheckCircle2 };
    case "failure":
      return { label: "Falhou", tone: "failure", Icon: XCircle };
    case "cancelled":
      return { label: "Cancelado", tone: "neutral", Icon: XCircle };
    case "skipped":
      return { label: "Ignorado", tone: "neutral", Icon: Clock3 };
    case "timed_out":
      return { label: "Tempo esgotado", tone: "failure", Icon: AlertTriangle };
    default:
      return {
        label: run.conclusion ?? "Concluído",
        tone: "neutral",
        Icon: AlertTriangle,
      };
  }
};

const toneClasses: Record<RunTone, string> = {
  running: "text-info",
  success: "text-success",
  failure: "text-destructive",
  neutral: "text-muted-foreground",
};

type RunsCardProps = {
  runs: WorkflowRun[];
  isLoading: boolean;
  isLive: boolean;
  onRefresh: () => void;
};

export function RunsCard({
  runs,
  isLoading,
  isLive,
  onRefresh,
}: RunsCardProps) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Execuções recentes</CardTitle>
          {isLive && (
            <Badge variant="info">
              <Loader2 className="animate-spin" />
              ao vivo
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Atualizar execuções"
            title="Atualizar execuções"
          >
            <RefreshCw className={cn(isLoading && "animate-spin")} />
          </Button>
        </div>
        <CardDescription>
          {isLive
            ? "Atualizando sozinho enquanto houver execução em andamento."
            : "O que o GitHub Actions rodou na branch padrão do repositório."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="rounded-lg border" aria-live="polite">
          {isLoading && runs.length === 0 ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <EmptyNotice
              icon={<Clock3 />}
              title="Nenhuma execução ainda"
              description="Publique para acompanhar o progresso aqui."
            />
          ) : (
            <ul className="divide-y">
              {runs.map((run, index) => {
                const { label, tone, Icon } = describe(run);
                // A dica de abrir a execução vale para a falha mais recente;
                // repetida em cada linha virava ruído.
                const falhou =
                  tone === "failure" &&
                  (Boolean(run.failedStep) ||
                    runs.findIndex((item) => describe(item).tone === "failure") === index);
                return (
                  <li key={run.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        toneClasses[tone],
                        tone === "running" && "animate-spin",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {run.name} #{run.runNumber}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={formatDateTime(run.updatedAt)}
                      >
                        {run.title || run.event} · {relativeTime(run.updatedAt)}
                      </p>
                      {/* Onde parou, quando a API diz; senão, o caminho mais
                          curto até o motivo. */}
                      {falhou && (
                        <p className="truncate text-xs text-destructive">
                          {run.failedStep
                            ? `Parou em “${stepLabel(run.failedStep)}”`
                            : "Abra a execução para ver em que passo parou."}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium",
                        toneClasses[tone],
                      )}
                    >
                      {label}
                    </span>
                    <Button asChild variant="ghost" size="icon-sm">
                      <a
                        href={run.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Abrir execução ${run.runNumber} no GitHub`}
                        title="Abrir no GitHub"
                      >
                        <ExternalLink />
                      </a>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
