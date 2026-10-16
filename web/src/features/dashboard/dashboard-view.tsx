import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ChartNoAxesGantt, FileSpreadsheet, FolderTree, Globe, Hourglass, Inbox, Layers, Timer, X } from "lucide-react";
import type { Project } from "@/lib/api";
import { formatTime, pluralize } from "@/lib/format";
import { useMinute } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { EmptyNotice, EmptyState, ErrorNotice, PageHeader } from "@/components/page-header";
import { CounterCard } from "@/components/counter-card";
import { ListFooter, PageColumns } from "@/components/page-layout";
import { SectionCard } from "@/components/section-card";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSpan } from "@/features/projects/project-timeline";
import { ProjectTimeline } from "@/features/projects/project-timeline-view";
import { StageBadge } from "@/features/projects/stage-badge";
import { ETAPAS, toneClass, type Etapa, type WorkGroupKey } from "@/features/projects/stage";
import type { ProjectList } from "@/features/projects/use-project-list";
import {
  buildRows,
  byDeveloper,
  developerLabel,
  durationOf,
  etapaCounts,
  inPeriod,
  periodLabels,
  periodStart,
  phaseColor,
  phaseLabels,
  summarize,
  type DashboardRow,
  type PeriodKey,
} from "./dashboard-metrics";
import { PaymentReportDialog } from "./payment-report-dialog";
import { ProjectsGantt } from "./projects-gantt";

const ALL = "__todos__";
const PERIODS: PeriodKey[] = ["30", "90", "365", "all"];
const GANTT_PAGE = 20;
/** A grade dos contadores do topo: a mesma distância da faixa "Fazer agora". */
const RESUMO = "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6";
/** O círculo do ícone de um número que não tem etapa (as medianas). */
const NEUTRO = "bg-muted text-muted-foreground";

type GanttSort = "recent" | "longest";

/** O que abrir na tela Projetos: um contador do "Fazer agora" ou uma etapa. */
export type WorkFilter = { group?: WorkGroupKey | null; etapa?: Etapa | null };

type DashboardViewProps = {
  /** A mesma lista da seção de projetos: uma carga só para as duas telas. */
  list: ProjectList;
  /** A tag que tira o projeto das vistas de trabalho também o fecha aqui. */
  finishedTagId: string | null;
  /** Leva à seção de projetos com este projeto na tela. */
  onShowInProjects: (project: Project) => void;
  /** Leva à lista da tela Projetos, já filtrada. */
  onOpenWork: (filter: WorkFilter) => void;
  /** O nome de cada tag, para a coluna do relatório. */
  tagName: (id: string) => string | undefined;
};

/**
 * O Dashboard: como o fluxo está indo. A tela Projetos responde "o que eu
 * faço agora"; esta responde "quanto há em cada etapa, com quem, e onde
 * demora". Só números que levam a uma decisão — cada um diz o que mede e
 * abre a lista filtrada. A atividade recente mudou para a tela Projetos.
 */
export function DashboardView({ list, finishedTagId, onShowInProjects, onOpenWork, tagName }: DashboardViewProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>("90");
  const [developer, setDeveloper] = useState(ALL);
  const [sort, setSort] = useState<GanttSort>("recent");
  const [ganttLimit, setGanttLimit] = useState(GANTT_PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  // O "agora" do Dashboard anda com o relógio, e não com a última leitura da
  // lista: o "hoje" do Gantt e o "em aberto há" não atrasam.
  const now = useMinute();
  const rows = useMemo(() => buildRows(list.projects, finishedTagId), [list.projects, finishedTagId]);
  const start = periodStart(period, now);

  // O seletor lista todo mundo, e não só quem tem projeto no período: trocar
  // o período não pode fazer a pessoa escolhida sumir da lista.
  const developers = useMemo(() => byDeveloper(rows), [rows]);
  const byDev = useMemo(
    () => rows.filter((row) => developer === ALL || row.developerKey === developer),
    [rows, developer],
  );
  const scoped = useMemo(() => byDev.filter((row) => inPeriod(row, start)), [byDev, start]);

  const summary = useMemo(() => summarize(byDev, start), [byDev, start]);
  const etapas = useMemo(() => etapaCounts(byDev), [byDev]);
  const stats = useMemo(() => byDeveloper(scoped), [scoped]);
  const ganttRows = useMemo(
    () =>
      [...scoped].sort((a, b) => (sort === "recent" ? b.receivedAt - a.receivedAt : durationOf(b, now) - durationOf(a, now))),
    [scoped, sort, now],
  );
  const ganttStart = useMemo(() => {
    const first = Math.min(...scoped.map((row) => row.receivedAt), now - 86_400_000);
    return start === null ? first : Math.max(start, first);
  }, [scoped, start, now]);

  const opened = openId ? (rows.find((row) => row.project.id === openId) ?? null) : null;
  const noPeriodo = period === "all" ? "desde o início" : `nos últimos ${periodLabels[period]}`;

  const filtros = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={developer} onValueChange={setDeveloper}>
        <SelectTrigger className="w-56" aria-label="Desenvolvedor">
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
      {/* O relatório tem filtros próprios: parte de todos os projetos, e não do recorte da tela. */}
      <Button variant="outline" disabled={list.loading || rows.length === 0} onClick={() => setReportOpen(true)}>
        <FileSpreadsheet />
        Relatório para pagamento
      </Button>
    </div>
  );

  return (
    <div className="space-y-5">
      <PaymentReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        rows={rows}
        developers={developers}
        tagName={tagName}
        now={now}
      />
      <PageHeader
        title="Dashboard"
        description="Quanto há em cada etapa, com quem cada projeto está e quanto tempo leva do recebimento ao site no ar."
        actions={filtros}
      />

      {list.error ? (
        <Card className="py-0">
          <ErrorNotice
            title="Não foi possível carregar os projetos"
            error={list.error}
            onRetry={() => void list.load(true)}
            className="py-14"
          />
        </Card>
      ) : list.loading ? (
        <div className="space-y-5" aria-busy="true" aria-label="Carregando">
          <div className={RESUMO}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
          <PageColumns asideLabel="Carregando" aside={<Skeleton className="h-80 rounded-xl" />}>
            <Skeleton className="h-96 rounded-xl" />
          </PageColumns>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FolderTree />}
          title="Nenhum projeto ainda"
          description="Quando as pastas de coleta chegarem ao Drive, os números aparecem aqui."
        />
      ) : (
        <>
          {/* Os mesmos contadores da faixa "Fazer agora" da tela Projetos; os
              que levam a uma lista abrem a tela Projetos já filtrada. */}
          <section aria-label="Resumo" className={RESUMO}>
            <CounterCard
              // Sites: os projetos só de arquivos, que a aba Ativos também lista, ficam fora.
              label="Sites ativos"
              count={summary.active}
              icon={<Layers />}
              toneClassName={toneClass.geracao.soft}
              detail={`${pluralize(summary.acting, "espera", "esperam")} a equipe agora`}
              hint="Ver os ativos na tela Projetos"
              onClick={() => onOpenWork({})}
            />
            <CounterCard
              label="Com problema"
              count={summary.problems}
              icon={<AlertTriangle />}
              toneClassName={summary.problems > 0 ? toneClass.erro.soft : NEUTRO}
              countClassName={summary.problems > 0 ? "text-destructive" : undefined}
              detail={summary.problems > 0 ? "falhas, links caídos e projetos parados" : "nenhum projeto parado"}
              hint={summary.problems > 0 ? "Ver o que resolver na tela Projetos" : undefined}
              onClick={summary.problems > 0 ? () => onOpenWork({ group: "resolver" }) : undefined}
            />
            <CounterCard
              label="Novos"
              count={summary.received}
              icon={<Inbox />}
              toneClassName={toneClass.material.soft}
              detail={`coletas e projetos criados ${noPeriodo}`}
            />
            <CounterCard
              label="Foram ao ar"
              count={summary.live}
              icon={<Globe />}
              toneClassName={toneClass.publicacao.soft}
              detail={`sites publicados pela primeira vez ${noPeriodo}`}
            />
            <CounterCard
              label="Espera até a geração"
              count={summary.medianToGenerate === null ? "—" : formatSpan(summary.medianToGenerate)}
              icon={<Hourglass />}
              toneClassName={NEUTRO}
              detail="mediana, do recebimento ao início da geração"
            />
            <CounterCard
              label="Tempo até o ar"
              count={summary.medianToLive === null ? "—" : formatSpan(summary.medianToLive)}
              icon={<Timer />}
              toneClassName={NEUTRO}
              detail={summary.live > 0 ? "mediana, do recebimento à primeira publicação" : `nenhum site foi ao ar ${noPeriodo}`}
            />
          </section>

          <PageColumns
            asideLabel="Ao lado do Dashboard"
            aside={
              <SectionCard title="Projetos por etapa" description="Onde cada projeto está hoje. Clique para ver a lista.">
                <EtapaBars etapas={etapas} onOpen={(etapa) => onOpenWork({ etapa })} />
              </SectionCard>
            }
          >
            <SectionCard
              title="Por desenvolvedor"
              description="Quem cuida de cada projeto: o responsável, quando definido, senão quem gerou o site. Clique num nome para ver só os dele."
              bodyClassName="px-0 pb-2"
            >
              <DeveloperTable
                stats={stats}
                selected={developer === ALL ? null : developer}
                onSelect={(key) => setDeveloper(key === developer ? ALL : key)}
              />
            </SectionCard>

            <SectionCard
              title="Linha do tempo dos projetos"
              description="Do recebimento do material ao site no ar. Clique num projeto para ver cada passo."
              actions={
                <Segmented
                  label="Ordenar a linha do tempo"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "recent", label: "Mais recentes" },
                    { value: "longest", label: "Mais demorados" },
                  ]}
                />
              }
              bodyClassName="px-0 pb-0"
            >
              <ul aria-label="Legenda" className="flex flex-wrap gap-x-5 gap-y-1.5 px-5 pb-3 text-xs text-muted-foreground">
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
              {ganttRows.length === 0 ? (
                <EmptyNotice icon={<ChartNoAxesGantt />} title="Nenhum projeto neste recorte" description="Troque o período ou o desenvolvedor." />
              ) : (
                <div className="pb-3">
                  <ProjectsGantt
                    rows={ganttRows.slice(0, ganttLimit)}
                    start={ganttStart}
                    now={now}
                    onOpen={(row) => setOpenId(row.project.id)}
                  />
                  {ganttRows.length > ganttLimit && (
                    <div className="flex justify-center pt-3">
                      <Button variant="outline" size="sm" onClick={() => setGanttLimit(Infinity)}>
                        Mostrar os {ganttRows.length} projetos
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <ListFooter updatedAt={list.fetchedAt && formatTime(list.fetchedAt)}>
                {pluralize(ganttRows.length, "projeto")} {noPeriodo}
                {developer !== ALL && ` · só os de ${developerLabel(developer)}`}
              </ListFooter>
            </SectionCard>
          </PageColumns>
        </>
      )}

      <ProjectTimelineDialog row={opened} onOpenChange={(open) => !open && setOpenId(null)} onShowInProjects={onShowInProjects} />
    </div>
  );
}

/** Barras horizontais: uma por etapa, na ordem do caminho, com o número ao lado. */
function EtapaBars({
  etapas,
  onOpen,
}: {
  etapas: ReturnType<typeof etapaCounts>;
  onOpen: (etapa: Etapa) => void;
}) {
  const max = Math.max(1, ...etapas.map((item) => item.count));
  return (
    <ul className="space-y-1">
      {etapas.map(({ etapa, count }) => {
        const info = ETAPAS[etapa];
        const Icon = info.icon;
        return (
          <li key={etapa}>
            <button
              type="button"
              onClick={() => onOpen(etapa)}
              className="w-full rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
              title={`${info.hint} ${pluralize(count, "projeto")}.`}
            >
              <span className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <Icon className={cn("size-4", toneClass[info.tone].text)} aria-hidden />
                  {info.label}
                </span>
                <span className="font-semibold tabular-nums">{count}</span>
              </span>
              <span className="mt-1 block h-1.5 rounded-full bg-muted">
                {count > 0 && (
                  <span
                    className={cn("block h-full rounded-full", toneClass[info.tone].text, "bg-current")}
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                )}
              </span>
            </button>
          </li>
        );
      })}
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
    return <EmptyNotice icon={<ChartNoAxesGantt />} title="Nenhum projeto neste recorte" description="Troque o período ou o desenvolvedor." />;
  }

  const th = "px-3 py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground";
  const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const span = (ms: number | null) => (ms === null ? "—" : formatSpan(ms));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className={cn(th, "pl-5 text-left")}>Desenvolvedor</th>
            <th className={th}>Projetos</th>
            <th className={th}>Em aberto</th>
            <th className={th}>Enviados ao cliente</th>
            <th className={th}>No ar</th>
            <th className={th} title="Mediana, da geração do site ao envio do link ao cliente">
              Geração → envio
            </th>
            <th className={cn(th, "pr-5")} title="Mediana, do recebimento do material à primeira publicação">
              Recebimento → no ar
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((dev) => (
            <tr key={dev.key} className={cn("border-b last:border-b-0", selected === dev.key && "bg-accent/50")}>
              <th scope="row" className="py-1 pr-3 pl-5 text-left font-medium">
                <button
                  type="button"
                  aria-pressed={selected === dev.key}
                  onClick={() => onSelect(dev.key)}
                  className="-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 whitespace-nowrap outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {dev.name}
                  {selected === dev.key && <X className="size-3.5 text-muted-foreground" aria-label="(filtrando)" />}
                </button>
              </th>
              <td className={td}>{dev.total}</td>
              <td className={td}>{dev.open}</td>
              <td className={td}>{dev.delivered}</td>
              <td className={td}>{dev.live}</td>
              <td className={td}>{span(dev.medianToDeliver)}</td>
              <td className={cn(td, "pr-5")}>{span(dev.medianToLive)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A linha do tempo de um projeto, aberta a partir do Dashboard. */
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
              <DialogDescription>Desenvolvedor: {developerLabel(row.developerKey)}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ProjectTimeline project={row.project} />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button onClick={() => onShowInProjects(row.project)}>
                Abrir em Projetos
                <ArrowRight />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
