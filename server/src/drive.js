import path from "node:path";
import { google } from "googleapis";
import { pickBrief } from "./brief-file.js";
import { cached, remember } from "./cache.js";
import { config } from "./config.js";
import { httpError } from "./http.js";
import { isDescendantOf, isValidDriveId } from "./security/drive-scope.js";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

const auth = new google.auth.GoogleAuth({
  keyFile: path.resolve(config.credentialsPath),
  scopes: SCOPES,
});

export const drive = google.drive({ version: "v3", auth });

export async function getAccessToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

const PROJECT_FIELDS =
  "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, webViewLink, description, owners(displayName, emailAddress))";

const FILE_FIELDS =
  "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, iconLink, thumbnailLink, fileExtension, parents, imageMediaMetadata(width, height), videoMediaMetadata(width, height, durationMillis))";

/** Percorre todas as páginas de um files.list. */
async function listAll(params) {
  const files = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      ...params,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

/** Pastas de primeiro nível da pasta raiz = "projetos". */
export async function listProjectFolders(rootId = config.rootFolderId) {
  return listAll({
    q: `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: PROJECT_FIELDS,
    orderBy: "name",
  });
}

/** Conteúdo direto de uma pasta. */
export async function listFolderChildren(folderId) {
  return listAll({
    q: `'${folderId}' in parents and trashed = false`,
    fields: FILE_FIELDS,
    orderBy: "folder,name",
  });
}

/** Executa `worker` sobre os itens com um teto de chamadas simultâneas. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Estatísticas de uma pasta de projeto: contagens, volume, tipos, última
 * atividade e o arquivo de briefing, se houver.
 *
 * Uma consulta por pasta, e não um `OR` de vários `parents`: a busca do Drive
 * devolve resultados incompletos para essas consultas combinadas — arquivos
 * existentes simplesmente não vinham, e a contagem do card saía menor que a
 * realidade. Quem chama controla a concorrência e o cache de cada pasta.
 */
export async function statsForFolder(folderId) {
  const entry = {
    fileCount: 0,
    folderCount: 0,
    size: 0,
    lastActivity: null,
    kinds: {},
    brief: null,
  };

  const files = await listAll({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
  });

  for (const file of files) {
    if (file.mimeType === FOLDER_MIME) entry.folderCount += 1;
    else {
      entry.fileCount += 1;
      entry.size += Number(file.size ?? 0);
      const kind = kindOf(file.mimeType, file.name);
      entry.kinds[kind] = (entry.kinds[kind] ?? 0) + 1;
    }
    if (!entry.lastActivity || file.modifiedTime > entry.lastActivity) {
      entry.lastActivity = file.modifiedTime;
    }
  }

  const { file: brief, count } = pickBrief(files);
  if (brief) {
    entry.brief = {
      id: brief.id,
      name: brief.name,
      mimeType: brief.mimeType,
      // Mais de um: a tela avisa qual foi usado.
      count,
    };
  }

  return entry;
}

/**
 * Todos os arquivos do projeto, subpastas incluídas, com o caminho relativo —
 * é a lista que alimenta a seleção de anexos da geração.
 *
 * A profundidade tem teto porque a coleta do cliente é rasa e porque um atalho
 * circular dentro do Drive faria a varredura passear para sempre.
 */
export async function walkProjectFiles(rootId, { maxDepth = 4 } = {}) {
  const files = [];
  let level = [{ id: rootId, trail: [] }];

  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const visited = await mapWithConcurrency(level, 8, async (folder) => ({
      folder,
      children: await listFolderChildren(folder.id),
    }));

    const next = [];
    for (const { folder, children } of visited) {
      for (const file of children) {
        if (file.mimeType === FOLDER_MIME) {
          next.push({ id: file.id, trail: [...folder.trail, file.name] });
        } else {
          files.push({ ...file, trail: folder.trail });
        }
      }
    }
    level = next;
  }

  return files;
}

/** Texto puro do briefing, seja ele PDF, documento do Google ou texto. */
export async function extractDocumentText(fileId, mimeType) {
  if (mimeType === "application/vnd.google-apps.document") {
    const { data } = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" },
    );
    return String(data);
  }

  if (mimeType === "application/pdf") {
    const { data } = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const { extractText, getDocumentProxy } = await import("unpdf");
    // Com `responseType: "arraybuffer"` o `data` é o binário, embora o tipo
    // do googleapis diga que é o metadado do arquivo.
    const bytes = /** @type {ArrayBuffer} */ (/** @type {unknown} */ (data));
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    const { data } = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    return String(data);
  }

  throw httpError(
    415,
    `Não sei extrair texto de um arquivo ${mimeType}. Abra-o no Drive e copie manualmente.`,
  );
}

/** Categoria simplificada usada na UI. */
export function kindOf(mimeType = "", name = "") {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType === FOLDER_MIME) return "folder";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("spreadsheet") || ["xlsx", "xls", "csv"].includes(ext))
    return "sheet";
  if (mimeType.includes("presentation") || ["pptx", "ppt"].includes(ext))
    return "slides";
  if (
    mimeType.includes("document") ||
    mimeType.startsWith("text/") ||
    ["doc", "docx", "txt", "md", "rtf"].includes(ext)
  )
    return "doc";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "other";
}

export function getFileMeta(fileId) {
  return drive.files
    .get({
      fileId,
      fields:
        "id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, thumbnailLink, iconLink, parents",
      supportsAllDrives: true,
    })
    .then((r) => r.data);
}

/** Formatos nativos do Google não têm binário: precisam ser exportados. */
export const GOOGLE_NATIVE_PDF = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.drawing",
  "application/vnd.google-apps.spreadsheet",
]);

/** Como o arquivo pode ser exibido no painel. */
export function previewKindOf(mimeType = "", kind = "other") {
  if (kind === "image" || kind === "video" || kind === "audio") return kind;
  if (kind === "pdf" || GOOGLE_NATIVE_PDF.has(mimeType)) return "pdf";
  if (mimeType.startsWith("text/") || mimeType === "application/json")
    return "text";
  return "none";
}

/**
 * Conteúdo do arquivo. Documentos nativos do Google são convertidos em PDF
 * para poderem ser visualizados dentro do painel.
 *
 * `range` (`bytes=início-fim`) é repassado ao Drive para arquivos binários — é
 * o que deixa o `<video>` avançar sem baixar o arquivo inteiro. A exportação
 * de nativos gera o PDF na hora e não aceita faixa.
 *
 * @param {string} fileId
 * @param {string} mimeType
 * @param {{ range?: string }} [options]
 */
export function streamFile(fileId, mimeType, { range } = {}) {
  if (GOOGLE_NATIVE_PDF.has(mimeType)) {
    return drive.files.export(
      { fileId, mimeType: "application/pdf" },
      { responseType: "stream" },
    );
  }
  return drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream", ...(range ? { headers: { Range: range } } : {}) },
  );
}

/* ------------------------------------------------------------------ *
 * Alcance: só o que está dentro da pasta raiz das coletas
 * ------------------------------------------------------------------ */

/** Mover arquivo para fora da raiz é raro; 10 min de cache poupa a cota. */
const SCOPE_TTL_MS = 10 * 60_000;

const parentsOf = (fileId) =>
  cached(
    `parents:${fileId}`,
    async () => {
      try {
        const { data } = await drive.files.get({
          fileId,
          fields: "parents",
          supportsAllDrives: true,
        });
        return data.parents ?? [];
      } catch (err) {
        // Arquivo que a service account não enxerga: não tem pai conhecido.
        if (err?.code === 404 || err?.status === 404) return [];
        throw err;
      }
    },
    SCOPE_TTL_MS,
  );

/**
 * Recusa id malformado ou fora da pasta raiz. Responde 404, e não 403, de
 * propósito: "existe mas é proibido" já contaria algo sobre o Drive.
 */
export async function assertInsideDriveRoot(fileId) {
  const inside =
    isValidDriveId(fileId) &&
    (await cached(
      `scope:${fileId}`,
      () => isDescendantOf(fileId, config.rootFolderId, parentsOf),
      SCOPE_TTL_MS,
    ));
  if (!inside) throw httpError(404, "Arquivo não encontrado.");
}

/**
 * Filhos de uma pasta já autorizada estão dentro da raiz por definição —
 * registrar isso evita uma consulta de pais por miniatura na tela.
 */
export function rememberInsideDriveRoot(fileIds) {
  for (const id of fileIds) remember(`scope:${id}`, true, SCOPE_TTL_MS);
}
