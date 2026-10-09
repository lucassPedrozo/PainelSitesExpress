import { useMemo, useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, ChartNoAxesGantt, FolderTree, X } from "lucide-react";
import type { Project } from "@/lib/api";
import { formatDateTime, pluralize, relativeTime } from "@/lib/format";
import { toneBadge } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { EmptyNotice, EmptyState, PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSpan } from "@/features/projects/project-timeline";
import { ProjectTimeline } from "@/features/projects/project-timeline-view";
import { timelineIcons } from "@/features/projects/timeline-icons";
import { StageBadge } from "@/features/projects/stage-badge";
import type { ProjectList } from "@/features/projects/use-project-list";
import {
  buildRows,
  byDeveloper,
  developerLabel,
  durationOf,
  inPeriod,
  periodLabels,
  periodStart,
  phaseCounts,
  phaseLabels,
  recentActivity,
  summarize,
  type DashboardRow,
  type PeriodKey,
} from "./dashboard-metrics";
import { phaseColor } from "./phase-color";
import { ProjectsGantt } from "./projects-gantt";

const ALL = "__todos__";
const PERIODS: PeriodKey[] = ["30", "90", "365", "all"];
const GANTT_PAGE = 30;
const ACTIVITY_PAGE = 12;

type GanttSort = "recent" | "longest";

type DashboardViewProps = {
  /** A mesma lista da seção de projetos: uma carga só para as duas telas. */
  list: ProjectList;
  /** A tag que tira o projeto das vistas de trabalho também o fecha aqui. */
  finishedTagId: string | null;
  /** Leva à seção de projetos com este projeto na tela. */
  onShowInProjects: (project: Project) => void;
  /** Leva à fila "Fazer agora". */
  onOpenQueue: () => void;
};

/**
 * O dashboard: o controle dos projetos e a linha do tempo de todos eles.
 *
 * A seção de projetos responde "o que eu faço agora"; esta responde "como
 * estamos indo" — quantos projetos há em cada etapa, com quem cada um está e
 * quanto tempo levam do recebimento ao site no ar.
 */
export function DashboardView({
  list,
  finishedTagId,
  onShowInProjects,
  onOpenQueue,
}: DashboardViewProps) {
  const [period, setPeriod] = useState<PeriodKey>("90");
  const [developer, setDeveloper] = useState(ALL);
  const [sort, setSort] = useState<GanttSort>("recent");
  const [ganttLimit, setGanttLimit] = useState(GANTT_PAGE);
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  const { now } = list;
  const rows = useMemo(
    () => buildRows(list.projects, finishedTagId),
    [list.projects, finishedTagId],
  );
  const start = periodStart(period, now);

  // O seletor lista todo mundo, e não só quem tem projeto no período: trocar
  // o período não pode fazer a pessoa escolhida sumir da lista.
  const developers = useMemo(() => byDeveloper(rows), [rows]);
  const scoped = useMemo(
    () =>
      rows.filter(
        (row) => (developer === ALL || row.developerKey === developer) && inPeriod(row, start),
      ),
    [rows, developer, start],
  );

  const summary = useMemo(() => summarize(scoped, start), [scoped, start]);
  const phases = useMemo(() => phaseCounts(scoped), [scoped]);
  const stats = useMemo(() => byDeveloper(scoped), [scoped]);
  const activity = useMemo(
    () => recentActivity(scoped, start, activityLimit + 1),
    [scoped, start, activityLimit],
  );
  const ganttRows = useMemo(
    () =>
      [...scoped].sort((a, b) =>
        sort === "recent"
          ? b.receivedAt - a.receivedAt
          : durationOf(b, now) - durationOf(a, now),
      ),
    [scoped, sort, now],
  );
  const ganttStart = useMemo(() => {
    const first = Math.min(...scoped.map((row) => row.receivedAt), now - 86_400_000);
    return start === null ? first : Math.max(start, first);
  }, [scoped, start, now]);

  const opened = openId ? (rows.find((row) => row.project.id === openId) ?? null) : null;
  const noPeriodo = period === "all" ? "desde o início" : `nos últimos ${periodLabels[period]}`;

  if (list.error) {
    return (
      <EmptyState
        tone="danger"
        icon={<AlertCircle />}
        title="Falha ao carregar os projetos"
        description={list.error}
        action={<Button onClick={() => list.load(true)}>Tentar novamente</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Os filtros ficam fora do `actions` do cabeçalho: lá eles não quebram
          de linha, e no celular empurravam a página para o lado. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <PageHeader
            title="Dashboard"
            description="Em que etapa estão os projetos, com quem cada um está e quanto tempo levam do recebimento ao site no ar."
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <Select value={developer} onValueChange={setDeveloper}>
              <SelectTrigger className="w-52" aria-label="Desenvolvedor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os desenvolvedores</SelectItem>
                {developers.map((dev) => (
                  <SelectItem key={dev.key} value={dev.key}>
                    {dev.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Segmented
              label="Período"
              value={period}
              onChange={setPeriod}
              options={PERIODS.map((value) => ({ value, label: periodLabels[value] }))}
            />
        </div>
      </div>

      {list.loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FolderTree />}
          title="Nenhum projeto ainda"
          description="Quando as pastas de coleta chegarem ao Drive, os números aparecem aqui."
        />
      ) : (
        <>
          <section aria-label="Resumo" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Em aberto"
              value={summary.open}
              hint={`${summary.waiting} aguardando geração`}
            />
            <StatTile
              label="Pedem atenção"
              value={summary.attention}
              valueClassName={summary.attention > 0 ? "text-destructive" : undefined}
              hint={
                summary.attention > 0 ? (
                  <button
                    type="button"
                    onClick={onOpenQueue}
                    className="inline-flex items-center gap-1 rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    Ver na fila
                    <ArrowRight className="size-3" />
                  </button>
                ) : (
                  "nada parado esperando alguém"
                )
              }
            />
            <StatTile label="Recebidos" value={summary.received} hint={noPeriodo} />
            <StatTile label="Foram ao ar" value={summary.live} hint={noPeriodo} />
            <StatTile
              label="Espera até a geração"
              value={summary.medianToGenerate === null ? "—" : formatSpan(summary.medianToGenerate)}
              hint="mediana, do recebimento ao site gerado"
            />
            <StatTile
              label="Tempo até o ar"
              value={summary.medianToLive === null ? "—" : formatSpan(summary.medianToLive)}
              hint={
                summary.live > 0
                  ? "mediana, do recebimento à primeira publicação"
                  : `nenhum site foi ao ar ${noPeriodo}`
              }
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>Projetos por etapa</CardTitle>
                <CardDescription>Onde cada projeto está hoje.</CardDescription>
              </CardHeader>
              <CardContent>
                <PhaseBars phases={phases} total={scoped.length} />
              </CardContent>
            </Card>

            <Card className="gap-4">
              <CardHeader>
                <CardTitle>Por desenvolvedor</CardTitle>
                <CardDescription>
                  Quem gerou o site de cada projeto. Clique num nome para ver só os dele.
                </CardDescription>
              </CardHeader>
              <DeveloperTable
                stats={stats}
                selected={developer === ALL ? null : developer}
                onSelect={(key) => setDeveloper(key === developer ? ALL : key)}
              />
            </Card>
          </div>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Linha do tempo dos projetos</CardTitle>
              <CardDescription>
                Do recebimento do material ao site no ar. Clique num projeto para ver cada passo.
              </CardDescription>
            </CardHeader>

            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-(--card-spacing)">
            <ul
              aria-label="Legenda"
              className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground"
            >
              {(["waiting", "production", "client"] as const).map((phase) => (
                <li key={phase} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("h-2 w-4 rounded-full", phaseColor[phase])} />
                  {phaseLabels[phase]}
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2.5 rounded-full", phaseColor.done)} />
                No ar
              </li>
            </ul>
            <Segmented
              label="Ordenar a linha do tempo"
              value={sort}
              onChange={setSort}
              options={[
                { value: "recent", label: "Mais recentes" },
                { value: "longest", label: "Mais demorados" },
              ]}
            />
            </div>

            {ganttRows.length === 0 ? (
              <EmptyNotice
                icon={<ChartNoAxesGantt />}
                title="Nenhum projeto neste recorte"
                description="Troque o período ou o desenvolvedor."
              />
            ) : (
              <>
                <ProjectsGantt
                  rows={ganttRows.slice(0, ganttLimit)}
                  start={ganttStart}
                  now={now}
                  onOpen={(row) => setOpenId(row.project.id)}
                />
                {ganttRows.length > ganttLimit && (
                  <div className="flex justify-center px-(--card-spacing)">
                    <Button variant="outline" size="sm" onClick={() => setGanttLimit(Infinity)}>
                      Mostrar os {ganttRows.length} projetos
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Atividade recente</CardTitle>
              <CardDescription>O que aconteceu nos projetos, do mais recente ao mais antigo.</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyNotice
                  icon={<ChartNoAxesGantt />}
                  title="Nada aconteceu neste recorte"
                  description="Troque o período ou o desenvolvedor."
                />
              ) : (
                <ol className="grid gap-x-10 gap-y-3 md:grid-cols-2">
                  {activity.slice(0, activityLimit).map((event) => {
                    const Icon = timelineIcons[event.icon];
                    return (
                      <li key={`${event.row.project.id}-${event.key}`} className="flex gap-3">
                        <span
                          className={cn(
                            "grid size-7 shrink-0 place-items-center rounded-full border",
                            toneBadge[event.tone],
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-medium">{event.title}</span>
                            {event.by && <span className="text-muted-foreground"> por {event.by}</span>}
                          </p>
                          <p className="flex gap-2 text-xs text-muted-foreground">
                            <button
                              type="button"
                              onClick={() => setOpenId(event.row.project.id)}
                              className="min-w-0 truncate rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                            >
                              {event.row.label}
                            </button>
                            <time
                              dateTime={event.at}
                              title={formatDateTime(event.at)}
                              className="ml-auto shrink-0 tabular-nums"
                            >
                              {relativeTime(event.at)}
                            </time>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {activity.length > activityLimit && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActivityLimit((limit) => limit + ACTIVITY_PAGE * 2)}
                  >
                    Mostrar mais
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {list.fetchedAt && (
            <p className="pb-4 text-center text-xs text-muted-foreground">
              Dados sincronizados em {formatDateTime(list.fetchedAt)}
            </p>
          )}
        </>
      )}

      <ProjectTimelineDialog
        row={opened}
        onOpenChange={(open) => !open && setOpenId(null)}
        onShowInProjects={onShowInProjects}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card size="sm" className="gap-1 px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl leading-tight font-semibold tracking-tight tabular-nums", valueClassName)}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

/** Barras horizontais: uma por etapa, na ordem do fluxo, com o número ao lado. */
function PhaseBars({
  phases,
  total,
}: {
  phases: ReturnType<typeof phaseCounts>;
  total: number;
}) {
  const max = Math.max(1, ...phases.map((item) => item.count));
  return (
    <ul className="space-y-3">
      {phases.map(({ phase, count }) => (
        <li
          key={phase}
          title={`${phaseLabels[phase]}: ${pluralize(count, "projeto")}${
            total ? ` (${Math.round((count / total) * 100)}%)` : ""
          }`}
        >
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{phaseLabels[phase]}</span>
            <span className="font-medium tabular-nums">{count}</span>
          </div>
          <div className="mt-1 h-2">
            {count > 0 && (
              <div
                className={cn("h-full min-w-1 rounded-r-full", phaseColor[phase])}
                style={{ width: `${(count / max) * 100}%` }}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DeveloperTable({
  stats,
  selected,
  onSelect,
}: {
  stats: ReturnType<typeof byDeveloper>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  if (stats.length === 0) {
    return (
      <EmptyNotice
        icon={<ChartNoAxesGantt />}
        title="Nenhum projeto neste recorte"
        description="Troque o período ou o desenvolvedor."
      />
    );
  }

  const th = "px-3 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground";
  const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const span = (ms: number | null) => (ms === null ? "—" : formatSpan(ms));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className={cn(th, "pl-(--card-spacing) text-left")}>Desenvolvedor</th>
            <th className={th}>Projetos</th>
            <th className={th}>Em aberto</th>
            <th className={th}>Enviados ao cliente</th>
            <th className={th}>No ar</th>
            <th className={th} title="Mediana, da geração do site ao envio do link ao cliente">
              Geração → envio
            </th>
            <th
              className={cn(th, "pr-(--card-spacing)")}
              title="Mediana, do recebimento do material à primeira publicação"
            >
              Recebimento → no ar
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((dev) => (
            <tr
              key={dev.key}
              className={cn("border-b last:border-b-0", selected === dev.key && "bg-accent/50")}
            >
              <th scope="row" className="py-1 pr-3 pl-(--card-spacing) text-left font-medium">
                <button
                  type="button"
                  aria-pressed={selected === dev.key}
                  onClick={() => onSelect(dev.key)}
                  title={selected === dev.key ? "Voltar a ver todos" : `Ver só os projetos de ${dev.name}`}
                  className="-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 whitespace-nowrap outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {dev.name}
                  {selected === dev.key && <X className="size-3.5 text-muted-foreground" />}
                </button>
              </th>
              <td className={td}>{dev.total}</td>
              <td className={td}>{dev.open}</td>
              <td className={td}>{dev.delivered}</td>
              <td className={td}>{dev.live}</td>
              <td className={td}>{span(dev.medianToDeliver)}</td>
              <td className={cn(td, "pr-(--card-spacing)")}>{span(dev.medianToLive)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A linha do tempo de um projeto, aberta a partir do dashboard. */
function ProjectTimelineDialog({
  row,
  onOpenChange,
  onShowInProjects,
}: {
  row: DashboardRow | null;
  onOpenChange: (open: boolean) => void;
  onShowInProjects: (project: Project) => void;
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="sm:max-w-2xl">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate">{row.label}</span>
                <StageBadge project={row.project} />
              </DialogTitle>
              <DialogDescription>
                Desenvolvedor: {developerLabel(row.developerKey)}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <ProjectTimeline project={row.project} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onShowInProjects(row.project)}>
                Ver em Projetos
                <ArrowRight />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
