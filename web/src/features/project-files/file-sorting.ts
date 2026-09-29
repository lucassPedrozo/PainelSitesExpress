import type { DriveFile } from "@/lib/api";
import { kindLabels } from "@/lib/format";

/** Ordenação e busca da lista de arquivos — regra pura, testável sem tela. */

export type FileSort = "name" | "modified" | "size" | "kind";

export const fileSortLabels: Record<FileSort, string> = {
  name: "Nome",
  modified: "Modificação",
  size: "Tamanho",
  kind: "Tipo",
};

export type FileSorting = {
  query: string;
  sort: FileSort;
  asc: boolean;
};

/**
 * Filtra pela busca e ordena. Pastas vêm sempre antes dos arquivos,
 * independentemente da ordenação escolhida: elas são caminho, não conteúdo, e
 * misturá-las à lista faz perder a noção de onde se está.
 */
export function sortFiles(
  files: DriveFile[],
  { query, sort, asc }: FileSorting,
): DriveFile[] {
  const term = query.trim().toLowerCase();
  const filtered = term
    ? files.filter((file) => file.name.toLowerCase().includes(term))
    : files;

  const direction = asc ? 1 : -1;

  return [...filtered].sort((a, b) => {
    const aFolder = a.kind === "folder";
    const bFolder = b.kind === "folder";
    if (aFolder !== bFolder) return aFolder ? -1 : 1;

    switch (sort) {
      case "size":
        return ((a.size ?? 0) - (b.size ?? 0)) * direction;
      case "modified":
        return (
          (new Date(a.modifiedTime).getTime() -
            new Date(b.modifiedTime).getTime()) *
          direction
        );
      case "kind":
        return (
          (kindLabels[a.kind].localeCompare(kindLabels[b.kind]) ||
            a.name.localeCompare(b.name, "pt-BR")) * direction
        );
      default:
        return (
          a.name.localeCompare(b.name, "pt-BR", { numeric: true }) * direction
        );
    }
  });
}

/** Soma o tamanho do que está visível — o rodapé do diálogo mostra isso. */
export const totalBytes = (files: DriveFile[]) =>
  files.reduce((total, file) => total + (file.size ?? 0), 0);
