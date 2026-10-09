import type { ArchiveEntry, DriveFile } from "@/lib/api";

/**
 * O conteúdo de um `.zip` como se fosse uma pasta — regra pura, testável sem
 * tela. A API devolve a lista corrida, com o caminho de cada arquivo; aqui
 * ela vira os itens de um nível, no mesmo formato dos arquivos do Drive, para
 * a grade, a tabela, a ordenação e a pré-visualização servirem aos dois.
 */

/**
 * Dentro do zip a miniatura é a própria imagem, descomprimida a cada pedido.
 * Acima disto o card mostra o ícone, e a imagem abre na pré-visualização.
 */
const THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Só `.zip` é aberto: é o formato que dá para ler sem baixar inteiro. Um zip
 * dentro de outro não abre — o de dentro não está no Drive para ser lido por
 * faixa.
 */
export const isZipFile = (file: Pick<DriveFile, "name" | "mimeType" | "archive">) =>
  !file.archive &&
  (/\.zip$/i.test(file.name) ||
    /^application\/(zip|x-zip-compressed)$/.test(file.mimeType));

/** O caminho de uma subpasta do zip a partir da pasta aberta. */
export const archivePath = (prefix: string, name: string) =>
  prefix ? `${prefix}/${name}` : name;

/**
 * Os itens de um nível do zip: as subpastas (deduzidas dos caminhos, porque
 * nem todo zip registra as pastas) e os arquivos.
 *
 * @param fileId o `.zip` no Drive
 * @param prefix a pasta aberta dentro dele; vazio na raiz
 */
export function archiveChildren(
  fileId: string,
  entries: ArchiveEntry[],
  prefix: string,
): DriveFile[] {
  const inside = prefix ? `${prefix}/` : "";
  const folders = new Map<string, DriveFile>();
  const files: DriveFile[] = [];

  for (const entry of entries) {
    if (!entry.path.startsWith(inside)) continue;
    const rest = entry.path.slice(inside.length);
    const slash = rest.indexOf("/");
    const modified = entry.modifiedTime ?? "";

    if (slash >= 0) {
      const name = rest.slice(0, slash);
      const folder = folders.get(name);
      if (!folder) {
        folders.set(name, {
          id: `zip:${fileId}/${inside}${name}`,
          name,
          mimeType: FOLDER_MIME,
          kind: "folder",
          previewKind: "none",
          size: null,
          createdTime: modified,
          modifiedTime: modified,
          webViewLink: "",
          webContentLink: null,
          hasThumbnail: false,
          width: null,
          height: null,
        });
        // A data da pasta é a do item mais recente dentro dela.
      } else if (modified > folder.modifiedTime) {
        folder.modifiedTime = modified;
      }
      continue;
    }

    files.push({
      id: `zip:${fileId}#${entry.index}`,
      name: rest,
      mimeType: entry.mimeType,
      kind: entry.kind,
      previewKind: entry.previewKind,
      size: entry.size,
      createdTime: modified,
      modifiedTime: modified,
      webViewLink: "",
      webContentLink: null,
      hasThumbnail:
        entry.previewKind === "image" && entry.size <= THUMBNAIL_MAX_BYTES,
      width: null,
      height: null,
      archive: { fileId, index: entry.index, blocked: entry.blocked },
    });
  }

  return [...folders.values(), ...files];
}
