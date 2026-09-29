import { ExternalLink, Hourglass, Loader2 } from "lucide-react";
import type { Project } from "@/lib/api";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { formatElapsed, progressOf, type ProgressModel } from "./project-progress";

/**
 * O andamento do que está em curso no projeto, com o relógio correndo: a
 * geração no Lovable (fases e ação atual) ou a publicação (passo do deploy).
 * Some quando nada roda.
 */
export function ProjectProgress({
  project,
  className,
  compact = false,
}: {
  project: Project;
  className?: string;
  /** Duas linhas de altura fixa (o card): título e barra, com o passo no título. */
  compact?: boolean;
}) {
  const model = progressOf(project);
  if (!model) return null;
  if (compact) return <CompactProgress model={model} className={className} />;
  return <ProgressBody model={model} className={className} />;
}

/**
 * O andamento em duas linhas, para caber no card sem mudar a altura dele: a
 * primeira diz o quê e há quanto tempo; a segunda é a barra (as quatro fases
 * da geração, ou o avanço do deploy). O passo atual fica no título ao passar
 * o mouse, e completo no modal do projeto.
 */
function CompactProgress({ model, className }: { model: ProgressModel; className?: string }) {
  const esperando = model.kind === "agent" && model.waiting;
  const detalhe = model.kind === "agent" ? [model.current, model.counts].filter(Boolean).join(" · ") : model.step;
  return (
    <div
      className={cn("min-w-0 flex-1 space-y-1 text-xs", className)}
      title={detalhe || undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        {esperando ? (
          <Hourglass className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-info" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{model.title}</span>
        <span className="text-muted-foreground">
          <Elapsed startedAt={model.startedAt} waiting={esperando} />
        </span>
      </div>
      {model.kind === "agent" ? (
        <div className="grid grid-cols-4 gap-1" aria-label="Fases da geração">
          {model.phases.map((fase) => (
            <div
              key={fase.label}
              title={fase.label}
              className={cn(
                "h-1 rounded-full",
                fase.state === "done" && "bg-info",
                fase.state === "active" && (esperando ? "bg-destructive/60" : "animate-pulse bg-info/70"),
                fase.state === "todo" && "bg-muted-foreground/20",
              )}
            />
          ))}
        </div>
      ) : (
        <div className="h-1 overflow-hidden rounded-full bg-muted-foreground/20">
          <div
            className={cn(
              "h-full rounded-full bg-info transition-[width] duration-700",
              model.fraction === null && "w-1/4 animate-pulse",
            )}
            style={model.fraction === null ? undefined : { width: `${Math.max(5, model.fraction * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Elapsed({ startedAt, waiting }: { startedAt: string | null; waiting?: boolean }) {
  const now = useNow();
  const inicio = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(inicio)) return null;
  return (
    <span className="shrink-0 tabular-nums" title={`Começou às ${new Date(inicio).toLocaleTimeString("pt-BR")}`}>
      {waiting ? "há " : ""}
      {formatElapsed(now - inicio)}
    </span>
  );
}

function ProgressBody({ model, className }: { model: ProgressModel; className?: string }) {
  const esperando = model.kind === "agent" && model.waiting;
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border px-3 py-2 text-xs",
        esperando
          ? "border-destructive/30 bg-destructive/5"
          : "border-info/30 bg-info/5",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        {esperando ? (
          <Hourglass className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-info" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{model.title}</span>
        <Elapsed startedAt={model.startedAt} waiting={esperando} />
      </div>

      {model.kind === "agent" ? (
        <>
          {/* As quatro fases de toda construção: é o que diz se falta pouco. */}
          <ol className="grid grid-cols-4 gap-1" aria-label="Fases da geração">
            {model.phases.map((fase) => (
              <li key={fase.label} className="min-w-0" title={fase.label}>
                <div
                  className={cn(
                    "h-1 rounded-full",
                    fase.state === "done" && "bg-info",
                    fase.state === "active" && (esperando ? "bg-destructive/60" : "animate-pulse bg-info/70"),
                    fase.state === "todo" && "bg-muted-foreground/20",
                  )}
                />
                <span
                  className={cn(
                    "mt-0.5 block truncate text-2xs",
                    fase.state === "active" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {fase.label}
                </span>
              </li>
            ))}
          </ol>
          {(model.current || model.counts) && (
            <p className="truncate text-muted-foreground" title={model.current ?? undefined}>
              {model.current}
              {model.current && model.counts && " · "}
              {model.counts}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-muted-foreground/20">
            <div
              className={cn(
                "h-full rounded-full bg-info transition-[width] duration-700",
                model.fraction === null && "w-1/4 animate-pulse",
              )}
              style={model.fraction === null ? undefined : { width: `${Math.max(5, model.fraction * 100)}%` }}
            />
          </div>
          <p className="flex items-center gap-1 text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" title={model.step}>
              {model.step}
            </span>
            {model.href && (
              <a
                href={model.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline"
              >
                GitHub
                <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        </>
      )}
    </div>
  );
}
