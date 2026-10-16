import type { Project } from "@/lib/api";
import { projectIdentity, timeOf } from "@/lib/format";
import { liveSinceOf, projectStatus, type ProjectStatus } from "@/features/projects/project-status";
import { timelineSummary } from "@/features/projects/project-timeline";
import { ETAPA_ORDER, STAGES, WORK_GROUPS, tabOf, type Etapa } from "@/features/projects/stage";

/**
 * Os números do dashboard: cada projeto vira uma linha com os seus marcos
 * (recebido, gerado, enviado ao cliente, no ar), e tudo o mais — resumo,
 * desempenho por desenvolvedor, a linha do tempo de todos — sai dessas linhas.
 *
 * Nada aqui pede dado novo à API: são as mesmas datas que a linha do tempo de
 * um projeto já lê, vistas de uma vez para todos. O que não foi registrado na
 * época continua aparecendo como não registrado, e não como palpite.
 *
 * As contas que a tela Projetos também mostra ("ativos", "com problema", a
 * etapa de cada um) saem da mesma fonte dela (`stage.ts`): antes o Dashboard
 * tinha regras próprias, e os números das duas telas não batiam.
 */

/** Em que trecho do fluxo o projeto está — a mesma cor no gráfico e na linha. */
export type Phase = "waiting" | "production" | "client" | "done";

export const phaseLabels: Record<Phase, string> = {
  waiting: "Aguardando geração",
  production: "Em produção",
  client: "Com o cliente",
  done: "Finalizado",
};

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
  /** A etapa de hoje, a mesma do selo. */
  etapa: Etapa;
  /** Está na aba Ativos da tela Projetos (nem no ar, nem finalizado). */
  active: boolean;
  /** Tem a tag "Finalizado". */
  finished: boolean;
  phase: Phase;
  receivedAt: number;
  /**
   * Quando a geração começou: o clique em "Gerar" do Lovable, ou o material
   * indo para o Claude. O site do Claude só entra na lista quando é entregue,
   * e antes o Dashboard dava como "aguardando geração" o que o Claude já fazia.
   */
  generatedAt: number | null;
  /** O site foi vinculado de fora: as datas dele não medem trabalho no painel. */
  linked: boolean;
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

export function buildRows(projects: Project[], finishedTagId: string | null): DashboardRow[] {
  return projects.flatMap((project) => {
    // Oculto pela equipe: pasta de teste, coleta que não vira site — fora das contas.
    if (project.details?.hidden) return [];
    const receivedAt = timeOf(project.createdTime);
    if (receivedAt === null) return [];
    const status = projectStatus(project);
    // Projeto só de arquivos não é um site, e a coleta repetida de um domínio
    // que já tem site não é outro: nenhum dos dois entra no fluxo.
    if (status.stage === "storage" || status.stage === "other-collection") return [];

    const site = project.generations.at(-1);
    const first = project.generations[0];
    const publication = project.publication;
    // O primeiro site diz quanto o material esperou; o mais recente é o que
    // foi ao cliente — a mesma leitura da linha do tempo do projeto.
    const generatedAt =
      timeOf(project.claude?.material?.copiedAt) ??
      (first?.engine === "claude" ? null : timeOf(first?.createdAt)) ??
      timeOf(first?.createdAt);
    const deliveredAt = timeOf(site?.deliveredAt);
    const liveAt = timeOf(liveSinceOf(project));

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
        // O responsável definido na tela Projetos vence quem gerou o site.
        developerKey: project.details?.responsible ?? (site ? (by ?? UNREGISTERED) : UNASSIGNED),
        publishedBy: lastDeploy?.by ?? publication?.configuredBy ?? null,
        status,
        etapa: STAGES[status.stage].etapa,
        active: tabOf(project, finishedTagId) === "ativos",
        finished: tagged,
        phase: closed
          ? "done"
          : deliveredAt !== null
            ? "client"
            : generatedAt !== null
              ? "production"
              : "waiting",
        receivedAt,
        generatedAt,
        linked: first?.origin === "linked",
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
  /** Na aba Ativos da tela Projetos. */
  active: number;
  /** Ativos esperando alguém da equipe (os cinco primeiros contadores). */
  acting: number;
  /** Com problema: o contador "Resolver". */
  problems: number;
  /** Recebidos e postos no ar dentro do período (cada domínio uma vez). */
  received: number;
  /** Dos recebidos, quantos foram criados no painel (o resto são coletas do Drive). */
  receivedInPanel: number;
  /** Sites cuja geração começou no período — vinculados de fora não contam. */
  generated: number;
  /** Links enviados ao cliente no período. */
  delivered: number;
  live: number;
  /** Mediana do recebimento ao ar, dos que foram ao ar no período. */
  medianToLive: number | null;
  /** Mediana da espera do material até a geração, dos gerados no período. */
  medianToGenerate: number | null;
};

/** Os grupos que pedem alguém da equipe agora: os mesmos de `WORK_GROUPS`. */
const ACTING = new Set<string>(WORK_GROUPS.filter((g) => g.acting).map((g) => g.key));

/**
 * Uma recoleta do mesmo domínio herda a publicação dele (é o mesmo site do
 * cliente): no ar, ele conta uma vez só — antes "Foram ao ar" contava duas.
 */
const byDomain = (rows: DashboardRow[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const domain = row.project.publication?.domain?.replace(/^www\./, "").toLowerCase();
    if (!domain) return true;
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
};

export function summarize(rows: DashboardRow[], start: number | null): DashboardSummary {
  const active = rows.filter((row) => row.active);
  const live = byDomain(rows.filter((row) => within(row.liveAt, start)));
  const received = rows.filter((row) => within(row.receivedAt, start));
  const group = (row: DashboardRow) => STAGES[row.status.stage].group;
  return {
    active: active.length,
    acting: active.filter((row) => ACTING.has(group(row) ?? "")).length,
    problems: active.filter((row) => group(row) === "resolver").length,
    received: received.length,
    receivedInPanel: received.filter((row) => row.project.source === "panel").length,
    generated: rows.filter((row) => !row.linked && within(row.generatedAt, start)).length,
    delivered: rows.filter((row) => within(row.deliveredAt, start)).length,
    live: live.length,
    medianToLive: median(live.flatMap((row) => timeToLive(row) ?? [])),
    // Um site vinculado tem a "geração" no clique do vínculo: não mede espera.
    medianToGenerate: median(
      rows
        .filter((row) => !row.linked && within(row.generatedAt, start))
        .map((row) => row.generatedAt! - row.receivedAt)
        .filter((ms) => ms >= 0),
    ),
  };
}

/** Quantos estão em cada etapa hoje — as mesmas do selo, fora os finalizados. */
export const etapaCounts = (rows: DashboardRow[]) =>
  ETAPA_ORDER.filter((etapa) => etapa !== "arquivos").map((etapa) => ({
    etapa,
    count: rows.filter((row) => !row.finished && row.etapa === etapa).length,
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
      // O vinculado nasce já entregue: geração e envio no mesmo clique.
      medianToDeliver: median(
        items.flatMap((row) => {
          if (row.linked) return [];
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
