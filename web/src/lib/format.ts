import { findDomain, parseCollectionName } from "@shared/domain.js";
import type { FileKind } from "@/lib/api";

/**
 * Os formatos do painel. Uma regra para cada coisa, usada em todas as telas:
 * datas, durações, tamanhos e plurais. Dado ausente vira "—" (ou `null`, para
 * a tela decidir sumir com o campo) — nunca "undefined", "NaN", "0 B" ou
 * "Invalid Date". Testado em format.test.ts.
 */

/**
 * "1 anexo", "3 anexos", "1.240 arquivos". Sem o plural explícito, acrescenta
 * "s" — serve para a maioria das palavras do painel; as irregulares (sessão,
 * ação) passam o plural.
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? singular : plural}`;
}

/** Só a palavra, sem o número: "têm" / "tem", "projetos" / "projeto". */
export const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;

/** "1,5 MB", "640 KB". Zero ou ausente vira "—": quem monta frase confere antes. */
export function formatBytes(bytes: number | null | undefined) {
  if (!bytes || !Number.isFinite(bytes) || bytes < 1) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  const casas = value >= 10 || i === 0 ? 0 : 1;
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })} ${units[i]}`;
}

/** "US$ 0,42" — a moeda que o Claude Code informa, no formato daqui. */
export const formatUsd = (usd: number) =>
  usd.toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** O instante de uma data ISO, ou `null` quando ela falta ou não é válida. */
export function timeOf(iso: string | number | Date | null | undefined): number | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const time = iso instanceof Date ? iso.getTime() : typeof iso === "number" ? iso : Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dayMonthFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "14/10/2026"; "—" sem data (antes, uma data inválida derrubava a tela). */
export function formatDate(iso: string | number | Date | null | undefined) {
  const time = timeOf(iso);
  return time === null ? "—" : dateFmt.format(time);
}

/** "14/10/2026, 10:03" — o formato completo, o do tooltip. */
export function formatDateTime(iso: string | number | Date | null | undefined) {
  const time = timeOf(iso);
  return time === null ? "—" : `${dateFmt.format(time)}, ${timeFmt.format(time)}`;
}

/** "10:03". */
export function formatTime(iso: string | number | Date | null | undefined) {
  const time = timeOf(iso);
  return time === null ? "—" : timeFmt.format(time);
}

const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/**
 * Quando algo aconteceu, do jeito de ler de relance: relativo até 7 dias,
 * absoluto depois. A data completa vai no tooltip (`formatDateTime`).
 *
 * - "agora", "há 12 min", "há 4 h" (até 6 h)
 * - "hoje, 09:59", "ontem, 18:20"
 * - "há 3 dias" (até 7 dias de calendário)
 * - "11/10" no ano corrente, "11/10/2025" em outro ano
 *
 * Dias de calendário, e não períodos de 24 h: às 00h30, o que aconteceu às
 * 23h é "ontem". Uma data no futuro (relógio adiantado) vale como agora até
 * 5 min; depois disso sai absoluta, sem "há -1 dias".
 */
export function formatWhen(iso: string | number | Date | null | undefined, now: number = Date.now()) {
  const time = timeOf(iso);
  if (time === null) return "—";
  const diff = now - time;
  const minutes = Math.floor(diff / 60_000);
  if (diff < 0 && -diff > 5 * 60_000) return absolute(time, now);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 6 * 60) return `há ${Math.floor(minutes / 60)} h`;

  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days === 0) return `hoje, ${timeFmt.format(time)}`;
  if (days === 1) return `ontem, ${timeFmt.format(time)}`;
  if (days <= 7) return `há ${days} dias`;
  return absolute(time, now);
}

const absolute = (time: number, now: number) =>
  new Date(time).getFullYear() === new Date(now).getFullYear() ? dayMonthFmt.format(time) : dateFmt.format(time);

/** Só o dia: "29/09" no ano corrente, "29/09/2025" de outro ano; "—" sem uma data válida. */
export function formatDay(iso: string | number | Date | null | undefined, now: number = Date.now()) {
  const time = timeOf(iso);
  return time === null ? "—" : absolute(time, now);
}

/** "45 s", "3 min 12 s", "1 h 05 min"; "—" sem um número válido. */
export function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  if (horas > 0) return `${horas} h ${String(minutos).padStart(2, "0")} min`;
  if (minutos > 0) return `${minutos} min ${String(segundos).padStart(2, "0")} s`;
  return `${segundos} s`;
}

/**
 * As pastas seguem o padrão "[dd/mm/aaaa] www.dominio.com.br", com o que o
 * cliente digitou depois da data. A limpeza (https://, www., asteriscos) mora
 * em `shared/domain.js`, que a API usa para ligar o projeto à publicação.
 */
export function parseProjectName(raw: string) {
  const { label, domain, collected } = parseCollectionName(raw);
  const collectedAt = collected
    ? new Date(collected.year, collected.month - 1, collected.day)
    : null;
  return { label, domain, collectedAt };
}

/**
 * Como o projeto se chama no painel. O apelido, quando existe, manda no título
 * e na busca; a data continua vindo do nome da pasta, que é onde ela está.
 * Um apelido que é um domínio também alimenta o atalho de publicação. O que a
 * equipe corrigiu à mão (`details`) vence os dois: o domínio e a data.
 */
export function projectIdentity(project: {
  name: string;
  alias: string | null;
  details?: { domain?: string | null; receivedAt?: string | null } | null;
}) {
  const parsed = parseProjectName(project.name);
  const corrigido = project.details ?? null;
  const recebido = timeOf(corrigido?.receivedAt);
  const collectedAt = recebido !== null ? new Date(recebido) : parsed.collectedAt;
  const alias = project.alias?.trim();
  if (!alias) {
    const domain = corrigido?.domain ?? parsed.domain;
    // Sem apelido, o título é o domínio corrigido, quando há um.
    return { label: corrigido?.domain ?? parsed.label, domain, collectedAt, renamed: false };
  }

  const found = findDomain(alias);
  return {
    label: alias,
    domain: corrigido?.domain ?? (found?.exact ? found.domain : parsed.domain),
    collectedAt,
    renamed: true,
  };
}

/**
 * O tamanho da coleta em uma linha só. Serve para conferir o material, não para
 * decidir o próximo passo — por isso vira texto discreto. Subpastas só
 * aparecem quando existem, e o volume só quando há (documentos do Google não
 * têm tamanho).
 */
export function describeMaterial(project: {
  fileCount: number;
  folderCount: number;
  totalSize: number;
}) {
  if (project.fileCount === 0 && project.folderCount === 0) return "Pasta vazia";
  const parts = [pluralize(project.fileCount, "arquivo")];
  if (project.totalSize > 0) parts.push(formatBytes(project.totalSize));
  if (project.folderCount > 0) parts.push(pluralize(project.folderCount, "subpasta"));
  return parts.join(" · ");
}

export const kindLabels: Record<FileKind, string> = {
  folder: "Pasta",
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  pdf: "PDF",
  sheet: "Planilha",
  slides: "Apresentação",
  doc: "Documento",
  archive: "Compactado",
  other: "Outro",
};
