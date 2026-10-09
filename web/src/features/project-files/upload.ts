import { uploadProjectFile } from "@/lib/api";

/**
 * Envio de arquivos do computador para um projeto criado no painel — os soltos,
 * uma pasta inteira (com as subpastas) ou a pasta de um site.
 */

export type UploadItem = {
  /** Caminho relativo ao destino, com `/`. */
  path: string;
  file: File;
};

/**
 * Pastas que o navegador lista junto com o resto e que não servem para nada
 * no painel: as dependências instaladas somam dezenas de milhares de arquivos,
 * e subir tudo levaria minutos para depois ser descartado no envio ao GitHub.
 */
const NEVER_UPLOADED = new Set(["node_modules", ".git"]);

/**
 * Os arquivos escolhidos num `<input type="file">`. Numa escolha de pasta, o
 * navegador dá o caminho a partir dela (`meu-site/src/App.tsx`);
 * `dropTopFolder` tira esse primeiro nível, para o conteúdo cair direto no
 * destino.
 */
export function itemsFromInput(
  files: FileList | File[],
  { dropTopFolder = false }: { dropTopFolder?: boolean } = {},
): UploadItem[] {
  const items: UploadItem[] = [];
  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
    if (parts.some((part) => NEVER_UPLOADED.has(part))) continue;
    const kept = dropTopFolder && parts.length > 1 ? parts.slice(1) : parts;
    if (kept.length) items.push({ path: kept.join("/"), file });
  }
  return items;
}

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join("/");

const CONCURRENCY = 3;

/**
 * Sobe os itens para `base`, três por vez. Para no primeiro erro: um envio
 * pela metade é dito, em vez de terminar "com sucesso" faltando arquivo.
 */
export async function uploadItems(
  projectId: string,
  base: string,
  items: UploadItem[],
  onProgress?: (done: number, total: number) => void,
) {
  let cursor = 0;
  let done = 0;
  let failure: unknown = null;

  const worker = async () => {
    while (cursor < items.length && !failure) {
      const item = items[cursor++];
      try {
        await uploadProjectFile(projectId, joinPath(base, item.path), item.file);
        done += 1;
        onProgress?.(done, items.length);
      } catch (error) {
        failure = error instanceof Error ? new Error(`${item.path}: ${error.message}`) : error;
      }
    }
  };

  onProgress?.(0, items.length);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  if (failure) throw failure;
}
