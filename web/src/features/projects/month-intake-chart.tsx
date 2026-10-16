import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Project } from "@/lib/api";
import { smoothPath } from "@/lib/chart-path";
import { pluralize } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildRows } from "@/features/dashboard/dashboard-metrics";
import { cn } from "@/lib/utils";
import { countTicks, monthIntake, type IntakeDay } from "./month-intake";

/**
 * O topo da tela de Projetos: os projetos novos do mês, dia a dia, num
 * gráfico de linhas — os recebidos pelo Drive e os criados no painel. O eixo
 * de baixo tem todos os dias do mês; as linhas param hoje.
 *
 * A conta é a do Dashboard (ver `month-intake.ts`). O gráfico é SVG feito
 * aqui, sem biblioteca: traço de 2px em curva suave (que não passa do valor
 * real), um véu da cor da linha embaixo dela, grade de 1px no tom da borda,
 * uma legenda com o total de cada linha, a mira que acompanha o ponteiro (e as
 * setas do teclado) até o dia mais perto, e a tabela para o leitor de tela.
 *
 * O movimento é o momento autoral da tela: ao abrir, as linhas se escrevem do
 * dia 1 até hoje, o véu vem depois e o ponto de hoje assenta no fim — o mês
 * sendo contado. A mira, os pontos e a dica deslizam de um dia para o outro.
 * Com "reduzir movimento", o gráfico já nasce desenhado e nada viaja.
 */

const SERIES = [
  { key: "drive", label: "Recebidos pelo Drive", stroke: "stroke-chart-drive", fill: "fill-chart-drive", bg: "bg-chart-drive" },
  { key: "panel", label: "Criados no painel", stroke: "stroke-chart-panel", fill: "fill-chart-panel", bg: "bg-chart-panel" },
] as const;

/** A área do desenho: o espaço dos números à esquerda e dos dias embaixo. */
const ALTURA = 200;
const MARGEM = { top: 8, right: 12, bottom: 24, left: 28 };

export function MonthIntakeChart({
  projects,
  finishedTagId,
  reference,
  loading,
  unavailable = false,
}: {
  projects: Project[];
  finishedTagId: string | null;
  /** O "agora": o mês e o dia de hoje saem dele. */
  reference: number;
  loading: boolean;
  /** A lista não carregou: sem dado, o gráfico não desenha zero nenhum. */
  unavailable?: boolean;
}) {
  const rows = useMemo(() => buildRows(projects, finishedTagId), [projects, finishedTagId]);
  const mes = useMemo(() => monthIntake(rows, reference), [rows, reference]);
  const nomeDoMes = mes.label.split(" ")[0].toLocaleLowerCase("pt-BR");

  return (
    <SectionCard
      title={`Projetos novos em ${nomeDoMes}`}
      description="Recebidos pelo Drive e criados no painel, dia a dia."
    >
      {loading ? (
        <Skeleton className="h-58 w-full rounded-lg" />
      ) : unavailable ? (
        <p className="grid h-50 place-items-center text-sm text-muted-foreground">Sem a lista de projetos, não há o que contar.</p>
      ) : (
        <>
          <Legend totals={mes.totals} />
          <Plot mes={mes} />
        </>
      )}
    </SectionCard>
  );
}

/** A legenda: o traço da cor de cada linha, o nome e o total do mês. */
function Legend({ totals }: { totals: { drive: number; panel: number } }) {
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" aria-label="Legenda">
      {SERIES.map((serie) => (
        <li key={serie.key} className="flex items-center gap-2">
          <span aria-hidden className={cn("h-0.5 w-3 rounded-full", serie.bg)} />
          <span className="text-muted-foreground">{serie.label}</span>
          <span className="font-semibold tabular-nums">{totals[serie.key]}</span>
        </li>
      ))}
    </ul>
  );
}

/** A largura do elemento, acompanhando o redimensionamento. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const diaPorExtenso = (at: number) => {
  const texto = new Date(at).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "long" });
  return `${texto.charAt(0).toLocaleUpperCase("pt-BR")}${texto.slice(1)}`;
};

function Plot({ mes }: { mes: ReturnType<typeof monthIntake> }) {
  const [boxRef, largura] = useWidth<HTMLDivElement>();
  const id = useId();
  const [ativo, setAtivo] = useState<number | null>(null);

  const total = mes.days.length;
  const plotW = Math.max(0, largura - MARGEM.left - MARGEM.right);
  const plotH = ALTURA - MARGEM.top - MARGEM.bottom;
  const passados = mes.days.filter((d) => d.drive !== null);
  const maior = Math.max(0, ...passados.flatMap((d) => [d.drive ?? 0, d.panel ?? 0]));
  const marcas = countTicks(maior);
  const teto = marcas.at(-1) ?? 4;

  const x = (day: number) => MARGEM.left + ((day - 1) / (total - 1)) * plotW;
  const y = (valor: number) => MARGEM.top + plotH - (valor / teto) * plotH;

  // Os dias no eixo: todos, quando cabem; senão hoje, o 1, o último e os
  // múltiplos de 5, nessa ordem — cada um só entra a 18px dos que já estão.
  const porDia = plotW / (total - 1);
  const dias =
    porDia >= 24
      ? mes.days.map((d) => d.day)
      : [mes.today, 1, total, ...mes.days.map((d) => d.day).filter((day) => day % 5 === 0)].reduce<number[]>(
          (escolhidos, day) =>
            escolhidos.every((outro) => Math.abs(outro - day) * porDia >= 18) ? [...escolhidos, day] : escolhidos,
          [],
        );

  const caminho = (key: "drive" | "panel") => smoothPath(passados.map((d) => ({ x: x(d.day), y: y(d[key] ?? 0) })));
  // O véu: a mesma curva, fechada na base, do dia 1 até hoje.
  const base = y(0);
  const veu = (key: "drive" | "panel") =>
    `${caminho(key)} L${x(mes.today).toFixed(1)},${base.toFixed(1)} L${x(1).toFixed(1)},${base.toFixed(1)} Z`;

  const diaAtivo: IntakeDay | null = ativo !== null ? mes.days[ativo - 1] : null;

  const apontar = (event: PointerEvent<SVGRectElement>) => {
    const caixa = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - caixa.left;
    const dia = Math.round(px / porDia) + 1;
    setAtivo(Math.min(Math.max(dia, 1), mes.today));
  };

  const teclado = (event: KeyboardEvent<HTMLDivElement>) => {
    const atual = ativo ?? mes.today;
    const proximo =
      event.key === "ArrowLeft" ? atual - 1 : event.key === "ArrowRight" ? atual + 1 : event.key === "Home" ? 1 : event.key === "End" ? mes.today : null;
    if (proximo === null) return;
    event.preventDefault();
    setAtivo(Math.min(Math.max(proximo, 1), mes.today));
  };

  // A dica fica à direita da mira; perto da borda, passa para a esquerda.
  // Ela anda por transform, para deslizar de um dia para o outro.
  const dicaX = diaAtivo ? x(diaAtivo.day) : 0;
  const dicaAEsquerda = dicaX > largura - 200;
  const dicaTransform = dicaAEsquerda ? `translateX(calc(${dicaX - 12}px - 100%))` : `translateX(${dicaX + 12}px)`;

  return (
    <div
      ref={boxRef}
      className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      role="group"
      tabIndex={0}
      aria-label={`Gráfico de linhas dos projetos novos em ${mes.label.toLocaleLowerCase("pt-BR")}, por dia: ${pluralize(mes.totals.drive, "recebido")} pelo Drive e ${pluralize(mes.totals.panel, "criado")} no painel até hoje. As setas leem dia a dia.`}
      onKeyDown={teclado}
      onFocus={() => setAtivo((dia) => dia ?? mes.today)}
      onBlur={() => setAtivo(null)}
    >
      {largura > 0 && (
        <svg width={largura} height={ALTURA} className="block overflow-visible" aria-hidden>
          {/* O véu de cada linha: a cor dela a 14% junto da curva, sumindo até a base. */}
          <defs>
            {SERIES.map((serie) => (
              <linearGradient key={serie.key} id={`${id}-${serie.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: `var(--chart-${serie.key})`, stopOpacity: 0.14 }} />
                <stop offset="100%" style={{ stopColor: `var(--chart-${serie.key})`, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>
          {/* A grade: uma linha fina por marca, no tom da borda; o zero é a base. */}
          {marcas.map((valor) => (
            <g key={valor}>
              <line x1={MARGEM.left} x2={MARGEM.left + plotW} y1={y(valor)} y2={y(valor)} className="stroke-border" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={MARGEM.left - 8} y={y(valor)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-2xs tabular-nums">
                {valor}
              </text>
            </g>
          ))}

          {/* Os dias do mês, todos no eixo; hoje em destaque. */}
          {dias.map((day) => (
            <text
              key={day}
              x={x(day)}
              y={ALTURA - 6}
              textAnchor="middle"
              className={cn("text-2xs tabular-nums", day === mes.today ? "fill-foreground font-semibold" : "fill-muted-foreground")}
            >
              {day}
            </text>
          ))}

          {/* A mira: o dia apontado. Desliza entre os dias (transform), e aparece esmaecendo. */}
          {diaAtivo && (
            <line
              x1={0}
              x2={0}
              y1={MARGEM.top}
              y2={MARGEM.top + plotH}
              style={{ transform: `translateX(${x(diaAtivo.day)}px)` }}
              className="animate-appear stroke-foreground/25 transition-transform duration-150 ease-arrive motion-reduce:transition-none"
              strokeWidth={1}
            />
          )}

          {SERIES.map((serie) => (
            <path key={`veu-${serie.key}`} d={veu(serie.key)} fill={`url(#${id}-${serie.key})`} className="animate-wash" />
          ))}

          {/* As linhas se escrevem do dia 1 até hoje (pathLength 1: o traço inteiro vale 1). */}
          {SERIES.map((serie, index) => (
            <path
              key={serie.key}
              d={caminho(serie.key)}
              fill="none"
              pathLength={1}
              strokeDasharray={1}
              className={cn(serie.stroke, "motion-safe:animate-draw")}
              style={{ animationDelay: `${index * 120}ms` }}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* Os pontos: no dia apontado, ou no fim das linhas (hoje). O anel na cor do cartão os separa da linha. */}
          {SERIES.map((serie) => {
            const dia = diaAtivo ?? mes.days[mes.today - 1];
            return (
              <circle
                key={serie.key}
                cx={x(dia.day)}
                cy={y(dia[serie.key] ?? 0)}
                r={4}
                className={cn(
                  serie.fill,
                  "stroke-card [transform-box:fill-box] origin-center transition-[cx,cy] duration-150 ease-arrive motion-safe:animate-settle motion-reduce:transition-none",
                )}
                strokeWidth={2}
              />
            );
          })}

          {/* A área que responde ao ponteiro: o desenho todo, maior que as linhas. */}
          <rect
            x={MARGEM.left}
            y={0}
            width={plotW}
            height={ALTURA}
            fill="transparent"
            onPointerMove={apontar}
            onPointerDown={apontar}
            onPointerLeave={() => setAtivo(null)}
          />
        </svg>
      )}

      {/* A dica do dia: o número primeiro, o nome da linha depois. */}
      <div aria-live="polite" className="sr-only">
        {diaAtivo && `${diaPorExtenso(diaAtivo.at)}: ${diaAtivo.drive} pelo Drive, ${diaAtivo.panel} no painel.`}
      </div>
      {diaAtivo && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-2 left-0 z-10 min-w-40 animate-appear rounded-lg border bg-popover px-3 py-2 text-xs shadow-md transition-transform duration-150 ease-arrive motion-reduce:transition-none"
          style={{ transform: dicaTransform }}
        >
          <p className="mb-1.5 text-muted-foreground">{diaPorExtenso(diaAtivo.at)}</p>
          <ul className="space-y-1">
            {SERIES.map((serie) => (
              <li key={serie.key} className="flex items-center gap-2">
                <span className={cn("h-0.5 w-3 shrink-0 rounded-full", serie.bg)} />
                <span className="w-5 text-sm font-semibold tabular-nums">{diaAtivo[serie.key]}</span>
                <span className="text-muted-foreground">{serie.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <table className="sr-only">
        <caption>Projetos novos por dia em {mes.label.toLocaleLowerCase("pt-BR")}, até hoje</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            {SERIES.map((serie) => (
              <th key={serie.key} scope="col">
                {serie.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {passados.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.drive}</td>
              <td>{d.panel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
