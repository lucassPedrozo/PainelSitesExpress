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
  running: "text-blue-600 dark:text-blue-400",
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
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="size-3 animate-spin" />
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
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
        </div>
        <CardDescription>
          {isLive
            ? "Atualizando sozinho enquanto houver execução em andamento."
            : "Histórico do GitHub Actions para a branch padrão do repositório."}
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
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <Clock3 className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhuma execução ainda</p>
              <p className="text-xs text-muted-foreground">
                Publique para acompanhar o progresso em tempo real.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {runs.map((run) => {
                const { label, tone, Icon } = describe(run);
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
                      >
                        <ExternalLink className="size-4" />
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
