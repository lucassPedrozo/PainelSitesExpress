import { useMemo, useState, type CSSProperties } from "react";
import { formatDate } from "@/lib/format";
import { formatSpan } from "@/features/projects/project-timeline";
import { stageOf } from "@/features/projects/stage";
import { StageBadge } from "@/features/projects/stage-badge";
import { cn } from "@/lib/utils";
import {
  axisTicks,
  developerLabel,
  durationOf,
  phaseLabels,
  segmentsOf,
  type DashboardRow,
} from "./dashboard-metrics";

/**
 * A cor de cada trecho do fluxo, nos tons das etapas: a espera é cinza de
 * propósito (ninguém trabalhou no projeto), a produção tem o tom da Geração,
 * o tempo com o cliente o do Cliente e o ponto "no ar" o da Publicação.
 */
export const phaseColor: Record<keyof typeof phaseLabels, string> = {
  waiting: "bg-muted-foreground/35",
  production: "bg-stage-geracao",
  client: "bg-stage-cliente",
  done: "bg-stage-publicacao",
};

const GRID = "md:grid-gantt";

type Hover = { row: DashboardRow; x: number; y: number };

/**
 * A linha do tempo de todos os projetos: uma barra por projeto, do
 * recebimento ao site no ar (ou até hoje, nos que estão em aberto), partida
 * nos trechos do fluxo. Barras que começaram antes da janela são cortadas na
 * borda esquerda.
 */
export function ProjectsGantt({
  rows,
  start,
  now,
  onOpen,
}: {
  rows: DashboardRow[];
  /** Início da janela do eixo. */
  start: number;
  now: number;
  onOpen: (row: DashboardRow) => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const span = Math.max(now - start, 1);
  const ticks = useMemo(() => axisTicks(start, now), [start, now]);
  const position = (time: number) =>
    Math.min(100, Math.max(0, ((time - start) / span) * 100));

  const gridLines = ticks.map((tick) => (
    <span
      key={tick.at}
      aria-hidden
      className="absolute inset-y-0 w-px bg-border/70"
      style={{ left: `${position(tick.at)}%` }}
    />
  ));

  return (
    <div>
      {/* O eixo: as datas em cima, alinhadas com a faixa das barras. */}
      <div className={cn("hidden gap-x-4 border-b px-(--card-spacing) pb-1.5 md:grid", GRID)}>
        <span className="text-xs text-muted-foreground">Projeto · desenvolvedor</span>
        <div className="relative h-4 text-2xs text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span
              key={tick.at}
              className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0"
              style={{ left: `${position(tick.at)}%` }}
            >
              {tick.label}
            </span>
          ))}
          <span className="absolute right-0 translate-x-1/2 bg-card pl-1 font-medium text-foreground max-lg:hidden">
            hoje
          </span>
        </div>
        <span className="text-right text-xs text-muted-foreground">Duração</span>
      </div>

      <ol aria-label="Linha do tempo dos projetos">
        {rows.map((row) => {
          const segments = segmentsOf(row, now);
          const duration = durationOf(row, now);
          const developer = developerLabel(row.developerKey);
          const resumo = `${row.label}: ${row.status.label}, ${developer}, ${
            row.closed ? "finalizado em" : "em aberto há"
          } ${formatSpan(duration)}`;

          return (
            <li key={row.project.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(row)}
                onMouseMove={(event) => setHover({ row, x: event.clientX, y: event.clientY })}
                onMouseLeave={() => setHover(null)}
                onFocus={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  setHover({ row, x: box.left + 24, y: box.bottom - 8 });
                }}
                onBlur={() => setHover(null)}
                aria-label={`${resumo}. Abrir a linha do tempo.`}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-(--card-spacing) py-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                  GRID,
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.label}</span>
                    <StageBadge view={stageOf(row.project)} size="sm" />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{developer}</span>
                </span>

                <span className="relative order-last col-span-2 block h-5 md:order-none md:col-span-1">
                  {gridLines}
                  {segments.map((segment, index) => {
                    const left = position(segment.from);
                    const right = position(segment.to);
                    // Trecho inteiro antes da janela: fica fora do desenho.
                    if (segment.to <= start) return null;
                    const last = index === segments.length - 1;
                    const style: CSSProperties = {
                      left: `${left}%`,
                      // 2px de respiro entre um trecho e o seguinte.
                      width: last ? `${right - left}%` : `calc(${right - left}% - 2px)`,
                    };
                    return (
                      <span
                        key={segment.phase}
                        aria-hidden
                        style={style}
                        className={cn(
                          "absolute top-1.5 h-2 min-w-0.75",
                          phaseColor[segment.phase],
                          index === 0 && segment.from >= start && "rounded-l-full",
                          // Em aberto a barra chega a hoje sem arremate: ela continua.
                          last && row.closed && "rounded-r-full",
                        )}
                      />
                    );
                  })}
                  {row.liveAt !== null && row.liveAt >= start && (
                    <span
                      aria-hidden
                      style={{ left: `${position(row.liveAt)}%` }}
                      className={cn(
                        "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                        phaseColor.done,
                      )}
                    />
                  )}
                </span>

                <span className="text-right">
                  <span className="block text-sm font-medium tabular-nums">
                    {formatSpan(duration)}
                  </span>
                  <span className="block text-2xs text-muted-foreground">
                    {row.liveAt !== null ? "até o ar" : row.closed ? "finalizado" : "em aberto"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {hover && <GanttTooltip hover={hover} now={now} />}
    </div>
  );
}

function GanttTooltip({ hover, now }: { hover: Hover; now: number }) {
  const { row } = hover;
  // Cada marco com a distância do anterior — é ela que mostra onde parou.
  const marcos: Array<[string, number | null, number | null]> = [
    ["Recebido", row.receivedAt, null],
    ["Site gerado", row.generatedAt, row.receivedAt],
    ["Enviado ao cliente", row.deliveredAt, row.generatedAt],
    ["No ar", row.liveAt, row.deliveredAt ?? row.generatedAt ?? row.receivedAt],
  ];
  // Perto da borda direita ou de baixo, o cartão abre para o outro lado.
  const flipX = hover.x > window.innerWidth - 320;
  const flipY = hover.y > window.innerHeight - 220;

  return (
    <div
      role="tooltip"
      style={{
        left: hover.x + (flipX ? -12 : 12),
        top: hover.y + (flipY ? -12 : 12),
        transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
      }}
      className="pointer-events-none fixed z-50 w-72 space-y-2 rounded-lg bg-popover p-3 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <div>
        <p className="truncate text-sm font-medium">{row.label}</p>
        <p className="text-muted-foreground">
          {row.status.label} · {developerLabel(row.developerKey)}
        </p>
      </div>
      <dl className="space-y-1">
        {marcos.map(([label, at, from]) =>
          at === null ? null : (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right tabular-nums">
                {formatDate(new Date(at).toISOString())}
                {from !== null && at >= from && (
                  <span className="text-muted-foreground"> · +{formatSpan(at - from)}</span>
                )}
              </dd>
            </div>
          ),
        )}
        {row.publishedBy && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Publicado por</dt>
            <dd>{row.publishedBy}</dd>
          </div>
        )}
      </dl>
      <p className="border-t pt-2 font-medium">
        {row.closed ? "Finalizado em " : "Em aberto há "}
        <span className="tabular-nums">{formatSpan(durationOf(row, now))}</span>
        {!row.closed && (
          <span className="font-normal text-muted-foreground">
            {" "}
            · {phaseLabels[row.phase].toLowerCase()}
          </span>
        )}
      </p>
    </div>
  );
}
