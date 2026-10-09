import type { Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { projectStatus, type ProjectStatus } from "@/features/projects/project-status";
import {
  projectTimeline,
  timelineSummary,
  type TimelineEvent,
} from "@/features/projects/project-timeline";

/**
 * Os números do dashboard: cada projeto vira uma linha com os seus marcos
 * (recebido, gerado, enviado ao cliente, no ar), e tudo o mais — resumo,
 * desempenho por desenvolvedor, a linha do tempo de todos — sai dessas linhas.
 *
 * Nada aqui pede dado novo à API: são as mesmas datas que a linha do tempo de
 * um projeto já lê, vistas de uma vez para todos. O que não foi registrado na
 * época continua aparecendo como não registrado, e não como palpite.
 */

/** Em que trecho do fluxo o projeto está — a mesma cor no gráfico e na linha. */
export type Phase = "waiting" | "production" | "client" | "done";

export const PHASES: Phase[] = ["waiting", "production", "client", "done"];

export const phaseLabels: Record<Phase, string> = {
  waiting: "Aguardando geração",
  production: "Em produção",
  client: "Com o cliente",
  done: "Finalizado",
};

/** O site existe, mas é de antes de o painel guardar quem gerou. */
export const UNREGISTERED = "__nao-registrado__";
/** Ninguém gerou o site ainda: o projeto não tem responsável. */
export const UNASSIGNED = "__sem-responsavel__";

export const developerLabel = (key: string) =>
  key === UNREGISTERED ? "Não registrado" : key === UNASSIGNED ? "Ainda sem responsável" : key;

export type Segment = { phase: Exclude<Phase, "done">; from: number; to: number };

export type DashboardRow = {
  project: Project;
  label: string;
  /** Quem gerou (ou vinculou) o site que vale; uma das chaves acima sem nome. */
  developerKey: string;
  /** Quem disparou a publicação mais recente pelo painel. */
  publishedBy: string | null;
  status: ProjectStatus;
  phase: Phase;
  receivedAt: number;
  generatedAt: number | null;
  deliveredAt: number | null;
  /** A primeira vez que o site foi ao ar — o fim do projeto. */
  liveAt: number | null;
  /** No ar, ou marcado com a tag de finalizado. */
  closed: boolean;
  /**
   * Onde a barra termina: a publicação, ou o último marco de um projeto
   * finalizado sem ir ao ar por aqui. `null`: em aberto, vai até agora.
   */
  endAt: number | null;
};

const timeOf = (iso: string | null | undefined) => {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

export function buildRows(projects: Project[], finishedTagId: string | null): DashboardRow[] {
  return projects.flatMap((project) => {
    const receivedAt = timeOf(project.createdTime);
    if (receivedAt === null) return [];

    const site = project.generations.at(-1);
    const publication = project.publication;
    // O primeiro site diz quanto o material esperou; o mais recente é o que
    // foi ao cliente — a mesma leitura da linha do tempo do projeto.
    const generatedAt = timeOf(project.generations[0]?.createdAt);
    const deliveredAt = timeOf(site?.deliveredAt);
    const liveAt = timeOf(publication?.firstDeployAt ?? publication?.lastDeployAt);

    const tagged = Boolean(finishedTagId && project.tagIds.includes(finishedTagId));
    const closed = liveAt !== null || tagged;
    const endAt = closed
      ? (liveAt ?? Math.max(receivedAt, generatedAt ?? 0, deliveredAt ?? 0))
      : null;

    const by = timelineSummary(project).generation?.by;
    const lastDeploy = publication?.deploys?.find((deploy) => !deploy.dryRun);

    return [
      {
        project,
        label: projectIdentity(project).label,
        developerKey: site ? (by ?? UNREGISTERED) : UNASSIGNED,
        publishedBy: lastDeploy?.by ?? publication?.configuredBy ?? null,
        status: projectStatus(project),
        phase: closed
          ? "done"
          : deliveredAt !== null
            ? "client"
            : generatedAt !== null
              ? "production"
              : "waiting",
        receivedAt,
        generatedAt,
        deliveredAt,
        liveAt,
        closed,
        endAt,
      },
    ];
  });
}

/**
 * Os trechos da barra do projeto, do recebimento ao fim (ou até agora).
 * Um marco fora de ordem — site vinculado depois de publicado, por exemplo —
 * é trazido para dentro da barra em vez de desenhar um trecho para trás.
 */
export function segmentsOf(row: DashboardRow, now: number): Segment[] {
  const end = Math.max(row.endAt ?? now, row.receivedAt);
  const clamp = (time: number) => Math.min(Math.max(time, row.receivedAt), end);

  // Publicado sem site registrado: o trabalho foi feito fora do painel, então
  // a barra inteira é produção, e não espera.
  if (row.generatedAt === null) {
    return end > row.receivedAt
      ? [{ phase: row.liveAt !== null ? "production" : "waiting", from: row.receivedAt, to: end }]
      : [];
  }

  const generated = clamp(row.generatedAt);
  const delivered = row.deliveredAt === null ? end : Math.max(generated, clamp(row.deliveredAt));
  const segments: Segment[] = [
    { phase: "waiting", from: row.receivedAt, to: generated },
    { phase: "production", from: generated, to: delivered },
    { phase: "client", from: delivered, to: end },
  ];
  return segments.filter((segment) => segment.to > segment.from);
}

/** Do recebimento ao site no ar; `null` enquanto não foi ao ar. */
export const timeToLive = (row: DashboardRow) =>
  row.liveAt !== null && row.liveAt >= row.receivedAt ? row.liveAt - row.receivedAt : null;

/** Quanto o projeto durou (finalizado) ou já dura (em aberto). */
export const durationOf = (row: DashboardRow, now: number) =>
  Math.max(0, (row.endAt ?? now) - row.receivedAt);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/* ---- Período ---------------------------------------------------------- */

export type PeriodKey = "30" | "90" | "365" | "all";

export const periodLabels: Record<PeriodKey, string> = {
  "30": "30 dias",
  "90": "90 dias",
  "365": "12 meses",
  all: "Tudo",
};

const DAY = 86_400_000;

/** Início do período; `null` para "Tudo". */
export const periodStart = (period: PeriodKey, now: number) =>
  period === "all" ? null : now - Number(period) * DAY;

/**
 * O projeto tem a ver com o período: chegou nele, terminou nele, ou ainda
 * está em aberto. Quem só olhasse a data de recebimento perderia o projeto
 * de quatro meses atrás que foi ao ar na semana passada.
 */
export const inPeriod = (row: DashboardRow, start: number | null) =>
  start === null || !row.closed || row.receivedAt >= start || (row.endAt ?? 0) >= start;

const within = (time: number | null, start: number | null) =>
  time !== null && (start === null || time >= start);

/* ---- Resumo ----------------------------------------------------------- */

export type DashboardSummary = {
  /** Em aberto agora, e quantos deles ainda esperam a geração. */
  open: number;
  waiting: number;
  /** Em aberto e pedindo ação de alguém. */
  attention: number;
  /** Recebidos e postos no ar dentro do período. */
  received: number;
  live: number;
  /** Mediana do recebimento ao ar, dos que foram ao ar no período. */
  medianToLive: number | null;
  /** Mediana da espera do material até a geração, dos gerados no período. */
  medianToGenerate: number | null;
};

export function summarize(rows: DashboardRow[], start: number | null): DashboardSummary {
  const open = rows.filter((row) => !row.closed);
  const live = rows.filter((row) => within(row.liveAt, start));
  return {
    open: open.length,
    waiting: open.filter((row) => row.phase === "waiting").length,
    attention: open.filter((row) => row.status.attention).length,
    received: rows.filter((row) => within(row.receivedAt, start)).length,
    live: live.length,
    medianToLive: median(live.flatMap((row) => timeToLive(row) ?? [])),
    medianToGenerate: median(
      rows
        .filter((row) => within(row.generatedAt, start))
        .map((row) => row.generatedAt! - row.receivedAt)
        .filter((ms) => ms >= 0),
    ),
  };
}

export const phaseCounts = (rows: DashboardRow[]) =>
  PHASES.map((phase) => ({
    phase,
    count: rows.filter((row) => row.phase === phase).length,
  }));

/* ---- Por desenvolvedor ------------------------------------------------ */

export type DeveloperStats = {
  key: string;
  name: string;
  total: number;
  open: number;
  /** Com o link já enviado ao cliente. */
  delivered: number;
  live: number;
  /** Da geração ao envio ao cliente — o trecho que é do desenvolvedor. */
  medianToDeliver: number | null;
  medianToLive: number | null;
};

export function byDeveloper(rows: DashboardRow[]): DeveloperStats[] {
  const groups = new Map<string, DashboardRow[]>();
  for (const row of rows) {
    groups.set(row.developerKey, [...(groups.get(row.developerKey) ?? []), row]);
  }

  const anonymous = (key: string) => (key === UNASSIGNED ? 2 : key === UNREGISTERED ? 1 : 0);

  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      name: developerLabel(key),
      total: items.length,
      open: items.filter((row) => !row.closed).length,
      delivered: items.filter((row) => row.deliveredAt !== null).length,
      live: items.filter((row) => row.liveAt !== null).length,
      medianToDeliver: median(
        items.flatMap((row) => {
          const from = timeOf(row.project.generations.at(-1)?.createdAt);
          return from !== null && row.deliveredAt !== null && row.deliveredAt >= from
            ? [row.deliveredAt - from]
            : [];
        }),
      ),
      medianToLive: median(items.flatMap((row) => timeToLive(row) ?? [])),
    }))
    // As pessoas primeiro, pela carga; o que não tem nome fica no fim.
    .sort(
      (a, b) =>
        anonymous(a.key) - anonymous(b.key) ||
        b.total - a.total ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}

/* ---- Atividade recente ------------------------------------------------ */

export type ActivityEvent = TimelineEvent & { row: DashboardRow };

/** Os acontecimentos de todos os projetos, do mais recente ao mais antigo. */
export function recentActivity(
  rows: DashboardRow[],
  start: number | null,
  limit: number,
): ActivityEvent[] {
  return rows
    .flatMap((row) => projectTimeline(row.project).map((event) => ({ ...event, row })))
    .filter((event) => within(Date.parse(event.at), start))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/* ---- Eixo do tempo ---------------------------------------------------- */

export type AxisTick = { at: number; label: string };

const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short" });

/** Marcas do eixo: dias em janelas curtas, meses nas longas — no máximo ~8. */
export function axisTicks(start: number, end: number): AxisTick[] {
  const days = (end - start) / DAY;
  const ticks: AxisTick[] = [];

  if (days <= 62) {
    const step = days <= 14 ? 2 : days <= 35 ? 7 : 14;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    if (cursor.getTime() < start) cursor.setDate(cursor.getDate() + 1);
    for (; cursor.getTime() <= end; cursor.setDate(cursor.getDate() + step)) {
      ticks.push({ at: cursor.getTime(), label: dayFmt.format(cursor) });
    }
    return ticks;
  }

  const months = Math.ceil(days / 30);
  const step = Math.max(1, Math.ceil(months / 8));
  const cursor = new Date(start);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < start) cursor.setMonth(cursor.getMonth() + 1);
  for (; cursor.getTime() <= end; cursor.setMonth(cursor.getMonth() + step)) {
    const month = monthFmt.format(cursor).replace(".", "");
    // O ano aparece na virada, e na primeira marca de uma janela longa.
    const year = cursor.getMonth() < step || (!ticks.length && days > 300);
    ticks.push({
      at: cursor.getTime(),
      label: year ? `${month}/${String(cursor.getFullYear()).slice(2)}` : month,
    });
  }
  return ticks;
}
