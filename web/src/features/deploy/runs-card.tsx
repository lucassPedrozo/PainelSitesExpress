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
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { When } from "@/components/when";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type RunTone = "running" | "success" | "failure" | "warning" | "neutral";

type RunState = { label: string; tone: RunTone; Icon: typeof CheckCircle2 };

/**
 * Os resultados que o GitHub Actions devolve em `conclusion`, em português.
 * Antes o valor cru ia para a tela ("action_required", "startup_failure").
 */
const conclusions: Record<string, RunState> = {
  success: { label: "Sucesso", tone: "success", Icon: CheckCircle2 },
  failure: { label: "Falhou", tone: "failure", Icon: XCircle },
  startup_failure: { label: "Falhou ao iniciar", tone: "failure", Icon: XCircle },
  timed_out: { label: "Tempo esgotado", tone: "failure", Icon: AlertTriangle },
  action_required: { label: "Requer ação no GitHub", tone: "warning", Icon: AlertTriangle },
  cancelled: { label: "Cancelada", tone: "neutral", Icon: XCircle },
  skipped: { label: "Ignorada", tone: "neutral", Icon: Clock3 },
  neutral: { label: "Neutra", tone: "neutral", Icon: CheckCircle2 },
  stale: { label: "Expirada", tone: "neutral", Icon: Clock3 },
};

const describe = (run: WorkflowRun): RunState => {
  if (isRunActive(run)) {
    return { label: "Em execução", tone: "running", Icon: Loader2 };
  }
  // Um valor novo do GitHub cai num texto genérico, nunca no inglês cru.
  return (
    (run.conclusion ? conclusions[run.conclusion] : undefined) ?? {
      label: "Encerrada",
      tone: "neutral",
      Icon: AlertTriangle,
    }
  );
};

const toneClasses: Record<RunTone, string> = {
  running: "text-info",
  success: "text-success",
  failure: "text-destructive",
  warning: "text-warning",
  neutral: "text-muted-foreground",
};

type RunsCardProps = {
  runs: WorkflowRun[];
  isLoading: boolean;
  /** A leitura falhou: não é o mesmo que "nenhuma execução". */
  error: unknown;
  isLive: boolean;
  onRefresh: () => void;
};

export function RunsCard({
  runs,
  isLoading,
  error,
  isLive,
  onRefresh,
}: RunsCardProps) {
  // A dica de abrir no GitHub vale para a falha mais recente; repetida em
  // cada linha virava ruído.
  const falhaMaisRecente = runs.find((run) => describe(run).tone === "failure")?.id;

  return (
    <SectionCard
      title="Execuções recentes"
      description={
        isLive
          ? "Atualizando sozinho enquanto houver execução em andamento."
          : "O que o GitHub Actions rodou na branch padrão do repositório."
      }
      actions={
        <>
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
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Atualizar execuções"
            title="Atualizar execuções"
          >
            <RefreshCw className={cn(isLoading && "animate-spin")} />
          </Button>
        </>
      }
    >
      <div className="rounded-lg border" aria-live="polite">
        {error && runs.length === 0 ? (
          <ErrorNotice
            title="Não foi possível ler as execuções"
            error={error}
            onRetry={onRefresh}
          />
        ) : isLoading && runs.length === 0 ? (
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
          <>
            {/* A lista que já estava na tela continua; só a releitura falhou. */}
            {Boolean(error) && (
              <p className="border-b px-3 py-2 text-xs text-destructive">
                Não foi possível atualizar as execuções. A lista abaixo pode estar desatualizada.
              </p>
            )}
            <ul className="divide-y">
              {runs.map((run) => {
                const { label, tone, Icon } = describe(run);
                const titulo = `${run.name} #${run.runNumber}`;
                const origem = run.title || run.event;
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
                      <p className="truncate text-sm font-medium" title={titulo}>
                        {titulo}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span title={origem}>{origem}</span> · <When at={run.updatedAt} />
                      </p>
                      {/* A API não diz em que passo a execução parou: o
                          caminho até o motivo é o GitHub. */}
                      {run.id === falhaMaisRecente && (
                        <a
                          href={run.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs text-destructive underline underline-offset-2"
                        >
                          ver no GitHub o que falhou
                          <ExternalLink className="size-3" />
                        </a>
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
          </>
        )}
      </div>
    </SectionCard>
  );
}
