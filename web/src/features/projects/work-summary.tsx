import { X } from "lucide-react";
import type { Project } from "@/lib/api";
import type { DatedGroup } from "@/features/projects/date-groups";
import { formatBytes, pluralize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectsView } from "./use-project-list";
import { queueGroupOf, queueToneClass } from "./work-queue";

type WorkSummaryProps = {
  view: ProjectsView;
  /** Quantos projetos a lista mostra, com os filtros aplicados. */
  visibleCount: number;
  /** Os grupos da fila, quando a lista está agrupada pelo próximo passo. */
  queue: Array<DatedGroup<Project>> | null;
  /** No ar, fora da fila — o que a vista "Todos" mostra a mais. */
  doneCount: number;
  onShowAll: () => void;
  /** Rola até o grupo com esta chave. */
  onJump: (key: string) => void;
  /** Os filtros ligados, já descritos ("busca “x”", "etapa “y”"…). */
  filters: string[];
  onClearFilters: () => void;
  /** O que há no Drive, independentemente do filtro. */
  inventory: { total: number; recent: number; files: number; size: number };
  className?: string;
};

const NUMERAL = "text-xl leading-none font-semibold tracking-tight tabular-nums";

/**
 * O resumo da lista: quantos projetos estão na tela e, na fila, quantos
 * esperam cada passo — em tamanho de título, cada número levando ao seu
 * grupo. É a resposta à pergunta que abre o painel ("o que eu faço agora?"),
 * e antes vivia em 12px cinza, com o mesmo peso dos totais do Drive.
 *
 * Os totais do Drive continuam aqui, à direita e miúdos: são contexto, não
 * trabalho.
 */
export function WorkSummary({
  view,
  visibleCount,
  queue,
  doneCount,
  onShowAll,
  onJump,
  filters,
  onClearFilters,
  inventory,
  className,
}: WorkSummaryProps) {
  const um = visibleCount === 1;
  const qualificador =
    view === "queue"
      ? `${um ? "projeto" : "projetos"} com algo a fazer`
      : view === "finished"
        ? um
          ? "projeto finalizado"
          : "projetos finalizados"
        : um
          ? "projeto"
          : "projetos";

  return (
    <section
      aria-label="Resumo da lista"
      className={cn("flex flex-wrap items-baseline gap-x-6 gap-y-3", className)}
    >
      <p className="flex items-baseline gap-1.5">
        <span className={NUMERAL}>{visibleCount}</span>
        <span className="text-sm text-muted-foreground">{qualificador}</span>
      </p>

      {queue && queue.length > 0 && (
        <ol
          aria-label="Por próximo passo"
          className="flex flex-wrap items-baseline gap-x-5 gap-y-2 sm:border-l sm:pl-6"
        >
          {queue.map((group) => {
            const meta = queueGroupOf(group.key);
            return (
              <li key={group.key}>
                <button
                  type="button"
                  onClick={() => onJump(group.key)}
                  title={`Ir para “${group.label}”`}
                  className="group/salto flex items-baseline gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className={cn(NUMERAL, meta?.tone && queueToneClass[meta.tone])}>
                    {group.items.length}
                  </span>
                  <span className="text-sm text-muted-foreground underline-offset-4 transition-colors group-hover/salto:text-foreground group-hover/salto:underline">
                    {meta?.short ?? group.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {view === "queue" && doneCount > 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={onShowAll}
          title="Os que estão no ar não têm nada a fazer e ficam fora da fila. A vista “Todos” mostra também eles."
        >
          {doneCount} sem pendência, fora da fila
        </button>
      )}

      {filters.length > 0 && (
        <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
          <span>filtrando por {filters.join(", ")}</span>
          <Button variant="ghost" size="xs" onClick={onClearFilters}>
            <X className="size-3.5" />
            Limpar filtros
          </Button>
        </span>
      )}

      <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
        {pluralize(inventory.total, "projeto")} no total · {pluralize(inventory.recent, "coleta")} nos últimos 30 dias ·{" "}
        {pluralize(inventory.files, "arquivo")} · {formatBytes(inventory.size)}
      </span>
    </section>
  );
}
