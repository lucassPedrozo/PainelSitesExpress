import { Clock, ExternalLink, Hourglass, Loader2 } from "lucide-react";
import type { Project } from "@/lib/api";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { formatElapsed, progressOf, type ProgressModel } from "@/features/projects/project-progress";

/**
 * O andamento do que está em curso no projeto, com o relógio correndo: a
 * geração no Lovable (fases e ação atual) ou a publicação (passo do deploy).
 * Some quando nada roda.
 */
export function ProjectProgress({ project, className }: { project: Project; className?: string }) {
  const model = progressOf(project);
  if (!model) return null;
  return <ProgressBody model={model} className={className} />;
}

function Elapsed({ startedAt, waiting }: { startedAt: string | null; waiting?: boolean }) {
  const now = useNow();
  const inicio = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(inicio)) return null;
  return (
    <span className="shrink-0 tabular-nums" title={`Começou às ${formatTime(inicio)}`}>
      {waiting ? "há " : ""}
      {formatElapsed(now - inicio)}
    </span>
  );
}

function ProgressBody({ model, className }: { model: ProgressModel; className?: string }) {
  const esperando = model.kind === "agent" && model.waiting;
  const naFila = model.kind === "agent" && model.queued === true;
  // O passo atual só vai por extenso quando diz mais do que o nome da fase
  // ativa, que já está escrito embaixo da barra.
  const faseAtiva = model.kind === "agent" ? model.phases.find((fase) => fase.state === "active")?.label : null;
  const passoAtual = model.kind === "agent" && model.current !== faseAtiva ? model.current : null;
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
        ) : naFila ? (
          <Clock className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-info" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{model.title}</span>
        <Elapsed startedAt={model.startedAt} waiting={esperando || naFila} />
      </div>

      {model.kind === "agent" ? (
        <>
          {/* As fases de toda construção: é o que diz se falta pouco. */}
          <ol
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${model.phases.length}, minmax(0, 1fr))` }}
            aria-label="Fases da geração"
          >
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
          {(passoAtual || model.counts) && (
            <p className="truncate text-muted-foreground" title={passoAtual ?? undefined}>
              {passoAtual}
              {passoAtual && model.counts && " · "}
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
