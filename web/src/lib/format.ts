import { findDomain, parseCollectionName } from "@shared/domain.js";
import type { FileKind } from "@/lib/api";

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso?: string | null) =>
  iso ? dateFmt.format(new Date(iso)) : "—";

export const formatDateTime = (iso?: string | null) =>
  iso ? dateTimeFmt.format(new Date(iso)) : "—";

export function relativeTime(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(months / 12);
  return `há ${years} ${years === 1 ? "ano" : "anos"}`;
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
 * Um apelido que é um domínio também alimenta o atalho de publicação.
 */
export function projectIdentity(project: {
  name: string;
  alias: string | null;
}) {
  const parsed = parseProjectName(project.name);
  const alias = project.alias?.trim();
  if (!alias) return { ...parsed, renamed: false };

  const found = findDomain(alias);
  return {
    label: alias,
    domain: found?.exact ? found.domain : parsed.domain,
    collectedAt: parsed.collectedAt,
    renamed: true,
  };
}

/**
 * O tamanho da coleta em uma linha só. Serve para conferir o material, não para
 * decidir o próximo passo — por isso vira texto discreto, e não um painel de
 * números. Subpastas só aparecem quando existem.
 */
export function describeMaterial(project: {
  fileCount: number;
  folderCount: number;
  totalSize: number;
}) {
  const parts = [
    `${project.fileCount} ${project.fileCount === 1 ? "arquivo" : "arquivos"}`,
  ];
  if (project.totalSize > 0) parts.push(formatBytes(project.totalSize));
  if (project.folderCount > 0) {
    parts.push(
      `${project.folderCount} ${project.folderCount === 1 ? "subpasta" : "subpastas"}`,
    );
  }
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
