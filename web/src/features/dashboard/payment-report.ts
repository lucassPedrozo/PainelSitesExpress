import { formatDate } from "@/lib/format";
import { normalizeDomain } from "@shared/domain.js";
import { timelineSummary } from "@/features/projects/project-timeline";
import { ETAPAS, ETAPA_ORDER, type Etapa } from "@/features/projects/stage";
import { developerLabel, type DashboardRow } from "./dashboard-metrics";

/**
 * O relatório que paga os desenvolvedores: os sites que estão nas etapas
 * escolhidas, com quem fez cada um e as datas de cada passo.
 *
 * Um erro aqui vira pagamento errado, então:
 * - a etapa é a mesma do selo e do Dashboard (`buildRows` → `stage.ts`);
 * - o desenvolvedor é o mesmo do "Por desenvolvedor" (o responsável definido,
 *   senão quem gerou o site), e as duas fontes vêm em colunas próprias;
 * - um domínio coletado duas vezes é o mesmo site: por padrão entra uma vez só,
 *   e quantas repetições ficaram de fora é dito na tela;
 * - a etapa escolhida à mão vem marcada, para ninguém pagar por um selo sem
 *   conferir.
 */

/** As etapas que entram no relatório — as do caminho até o domínio. */
export const REPORT_ETAPAS: Etapa[] = ETAPA_ORDER.filter((etapa) => etapa !== "arquivos");

/** Pela data de qual passo o período filtra. */
export type ReportDateField = "received" | "generated" | "delivered" | "live";

export const reportDateLabels: Record<ReportDateField, string> = {
  received: "Recebimento",
  generated: "Geração",
  delivered: "Envio ao cliente",
  live: "No ar desde",
};

export type ReportFilters = {
  etapas: Etapa[];
  /** A chave do desenvolvedor (`developerKey`), ou `null` para todos. */
  developer: string | null;
  /** O período, em dias "aaaa-mm-dd" (inclusivos); vazio = sem período. */
  from: string;
  to: string;
  dateField: ReportDateField;
  /** Um site por domínio (o padrão): coletas repetidas do mesmo domínio ficam de fora. */
  onePerDomain: boolean;
  /**
   * Os marcados com a tag "Finalizado" entram também. Desligado por padrão:
   * um site finalizado em geral já foi pago, e sem período ele entraria de novo.
   */
  includeFinished: boolean;
};

export type ReportRow = {
  id: string;
  domain: string;
  project: string;
  etapa: Etapa;
  etapaLabel: string;
  /** A situação fina: "Pronto para enviar", "Com o cliente", "Publicação falhou"… */
  situation: string;
  manual: boolean;
  developer: string;
  responsible: string | null;
  generatedBy: string | null;
  engine: string;
  receivedAt: number;
  generatedAt: number | null;
  deliveredAt: number | null;
  deliveredBy: string | null;
  liveAt: number | null;
  lastDeployAt: number | null;
  publishedBy: string | null;
  repository: string | null;
  clientUrl: string | null;
  tags: string[];
  finished: boolean;
  note: string | null;
};

export type ReportResult = {
  rows: ReportRow[];
  /** Coletas repetidas do mesmo domínio que ficaram de fora (`onePerDomain`). */
  duplicates: number;
  /** Fora por não ter a data escolhida para o período (um site ainda não enviado, por exemplo). */
  withoutDate: number;
  /** Finalizados nas etapas escolhidas que ficaram de fora (`includeFinished` desligado). */
  finished: number;
};

const timeOf = (iso: string | null | undefined) => {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

/** O começo ou o fim do dia "aaaa-mm-dd", no fuso de quem opera. */
const dayBound = (day: string, end: boolean) => {
  const [ano, mes, dia] = day.split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  return end ? new Date(ano, mes - 1, dia, 23, 59, 59, 999).getTime() : new Date(ano, mes - 1, dia).getTime();
};

const dateOf = (row: DashboardRow, field: ReportDateField) =>
  field === "received"
    ? row.receivedAt
    : field === "generated"
      ? row.generatedAt
      : field === "delivered"
        ? row.deliveredAt
        : row.liveAt;

/** O domínio que identifica o site: o da publicação, senão o do projeto. */
const siteDomain = (row: DashboardRow) =>
  normalizeDomain(row.project.publication?.domain ?? "") ?? normalizeDomain(row.project.domain ?? "") ?? null;

/**
 * Das coletas de um mesmo domínio, a que fica: a que tem site gerado (é nela
 * que alguém trabalhou), e entre elas a mais recente.
 */
const keepFirst = (a: DashboardRow, b: DashboardRow) =>
  Number(b.project.generations.length > 0) - Number(a.project.generations.length > 0) || b.receivedAt - a.receivedAt;

function engineOf(row: DashboardRow) {
  const site = row.project.generations.at(-1);
  if (!site) return "—";
  if (site.origin === "linked") return "Vinculado";
  return site.engine === "claude" ? "Claude" : "Lovable";
}

export function buildReport(
  rows: DashboardRow[],
  filters: ReportFilters,
  tagName: (id: string) => string | undefined = () => undefined,
): ReportResult {
  const etapas = new Set(filters.etapas);
  let candidatos = rows.filter(
    (row) => etapas.has(row.etapa) && (filters.developer === null || row.developerKey === filters.developer),
  );

  let finished = 0;
  if (!filters.includeFinished) {
    finished = candidatos.filter((row) => row.finished).length;
    candidatos = candidatos.filter((row) => !row.finished);
  }

  // Um domínio, um site: as recoletas herdam a publicação e apareceriam
  // de novo — e seriam pagas de novo.
  let duplicates = 0;
  if (filters.onePerDomain) {
    const porDominio = new Map<string, DashboardRow[]>();
    const semDominio: DashboardRow[] = [];
    for (const row of candidatos) {
      const dominio = siteDomain(row);
      if (!dominio) semDominio.push(row);
      else porDominio.set(dominio, [...(porDominio.get(dominio) ?? []), row]);
    }
    const ficam = [...porDominio.values()].map((grupo) => {
      duplicates += grupo.length - 1;
      return [...grupo].sort(keepFirst)[0];
    });
    candidatos = [...ficam, ...semDominio];
  }

  let withoutDate = 0;
  const inicio = filters.from ? dayBound(filters.from, false) : null;
  const fim = filters.to ? dayBound(filters.to, true) : null;
  if (inicio !== null || fim !== null) {
    candidatos = candidatos.filter((row) => {
      const data = dateOf(row, filters.dateField);
      if (data === null) {
        withoutDate += 1;
        return false;
      }
      return (inicio === null || data >= inicio) && (fim === null || data <= fim);
    });
  }

  const linhas = candidatos.map((row): ReportRow => {
    const project = row.project;
    const site = project.generations.at(-1);
    const publicacao = project.publication;
    const ultimoEnvio = publicacao?.deploys?.find((deploy) => !deploy.dryRun);
    return {
      id: project.id,
      domain: siteDomain(row) ?? "",
      project: row.label,
      etapa: row.etapa,
      etapaLabel: ETAPAS[row.etapa].label,
      situation: row.status.label,
      manual: row.status.stage.startsWith("manual-"),
      developer: developerLabel(row.developerKey),
      responsible: project.details?.responsible ?? null,
      generatedBy: timelineSummary(project).generation?.by ?? null,
      engine: engineOf(row),
      receivedAt: row.receivedAt,
      generatedAt: row.generatedAt,
      deliveredAt: row.deliveredAt,
      deliveredBy: site?.deliveredBy ?? null,
      liveAt: row.liveAt,
      lastDeployAt: timeOf(publicacao?.lastDeployAt),
      publishedBy: ultimoEnvio?.by ?? null,
      repository: publicacao?.repoFullName ?? site?.repoFullName ?? null,
      clientUrl: site?.clientUrl ?? site?.shortUrl ?? null,
      tags: project.tagIds.map((id) => tagName(id)).filter((name): name is string => Boolean(name)),
      finished: row.finished,
      note: project.details?.note ?? null,
    };
  });

  // Por desenvolvedor, na ordem do caminho, e do mais recente para o mais antigo.
  const ordem = (etapa: Etapa) => ETAPA_ORDER.indexOf(etapa);
  linhas.sort(
    (a, b) =>
      a.developer.localeCompare(b.developer, "pt-BR") ||
      ordem(a.etapa) - ordem(b.etapa) ||
      (dateValue(b, filters.dateField) ?? 0) - (dateValue(a, filters.dateField) ?? 0) ||
      a.domain.localeCompare(b.domain, "pt-BR"),
  );
  return { rows: linhas, duplicates, withoutDate, finished };
}

const dateValue = (row: ReportRow, field: ReportDateField) =>
  field === "received" ? row.receivedAt : field === "generated" ? row.generatedAt : field === "delivered" ? row.deliveredAt : row.liveAt;

/** Quantos sites cada desenvolvedor tem no relatório, e em cada etapa — o que se confere antes de pagar. */
export function reportTotals(rows: ReportRow[]) {
  const porDev = new Map<string, { developer: string; total: number; etapas: Map<Etapa, number> }>();
  for (const row of rows) {
    const atual = porDev.get(row.developer) ?? { developer: row.developer, total: 0, etapas: new Map() };
    atual.total += 1;
    atual.etapas.set(row.etapa, (atual.etapas.get(row.etapa) ?? 0) + 1);
    porDev.set(row.developer, atual);
  }
  return [...porDev.values()].sort((a, b) => b.total - a.total || a.developer.localeCompare(b.developer, "pt-BR"));
}

/* ------------------------------------------------------------------ *
 * A planilha
 * ------------------------------------------------------------------ */

const COLUNAS: Array<[string, (row: ReportRow) => string]> = [
  ["Domínio", (row) => row.domain],
  ["Projeto", (row) => row.project],
  ["Etapa", (row) => row.etapaLabel],
  ["Situação", (row) => row.situation],
  ["Etapa definida à mão", (row) => (row.manual ? "Sim" : "Não")],
  ["Desenvolvedor", (row) => row.developer],
  ["Responsável", (row) => row.responsible ?? ""],
  ["Gerado por", (row) => row.generatedBy ?? ""],
  ["Motor", (row) => row.engine],
  ["Recebido em", (row) => dia(row.receivedAt)],
  ["Geração em", (row) => dia(row.generatedAt)],
  ["Enviado ao cliente em", (row) => dia(row.deliveredAt)],
  ["Enviado por", (row) => row.deliveredBy ?? ""],
  ["No ar desde", (row) => dia(row.liveAt)],
  ["Última publicação", (row) => dia(row.lastDeployAt)],
  ["Publicado por", (row) => row.publishedBy ?? ""],
  ["Repositório", (row) => row.repository ?? ""],
  ["Link do cliente", (row) => row.clientUrl ?? ""],
  ["Tags", (row) => row.tags.join(", ")],
  ["Finalizado", (row) => (row.finished ? "Sim" : "Não")],
  ["Observação interna", (row) => row.note ?? ""],
  ["Id do projeto", (row) => row.id],
];

const dia = (time: number | null) => (time === null ? "" : formatDate(time));

/**
 * Um campo da planilha. Com ";" (o separador que o Excel em português abre
 * direto), aspas ou quebra de linha, vai entre aspas. Um texto que começa com
 * "=", "+", "-" ou "@" ganha um apóstrofo: senão o Excel o rodaria como
 * fórmula — e a observação ou o nome vêm de quem preenche.
 */
export function csvField(value: string) {
  const seguro = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** A planilha inteira: com a marca de UTF-8 (o Excel acerta os acentos) e linhas em CRLF. */
export function reportCsv(rows: ReportRow[]) {
  const linhas = [
    COLUNAS.map(([titulo]) => csvField(titulo)).join(";"),
    ...rows.map((row) => COLUNAS.map(([, valor]) => csvField(valor(row))).join(";")),
  ];
  return `\uFEFF${linhas.join("\r\n")}\r\n`;
}

/** "relatorio-cliente-publicacao-2026-10-14.csv" */
export function reportFileName(filters: ReportFilters, now: number) {
  const data = new Date(now);
  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  const hoje = `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
  const etapas = REPORT_ETAPAS.filter((etapa) => filters.etapas.includes(etapa)).join("-") || "nenhuma";
  return `relatorio-${etapas}-${hoje}.csv`;
}
