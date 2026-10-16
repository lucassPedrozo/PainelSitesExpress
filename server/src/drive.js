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

const STATS_FIELDS = "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)";

/** Documentos, planilhas e apresentações do Google: editados no próprio Drive. */
const isGoogleNative = (mimeType = "") =>
  mimeType.startsWith("application/vnd.google-apps.") && mimeType !== FOLDER_MIME;

/**
 * As métricas de uma coleta a partir dos itens dela: os da raiz e os das
 * subpastas. Pura, para ser testada sem o Drive.
 *
 * - Arquivos, volume e tipos contam as subpastas: o cliente costuma mandar as
 *   fotos numa pasta própria, e contar só a raiz dava "Pasta vazia" para uma
 *   coleta cheia — e um número menor que o da tela de geração, que já descia.
 * - A última atividade é quando o item mais recente **entrou** na pasta
 *   (`createdTime`). O `modifiedTime` de um upload é a data do arquivo no
 *   computador do cliente: uma coleta de hoje aparecia com "atividade há 3
 *   anos". Nos documentos nativos do Google ele é real (a edição foi no Drive)
 *   e também conta.
 * - O briefing é procurado só na raiz, como sempre foi.
 *
 * @typedef {{ id?: string, name?: string, mimeType?: string, size?: string | number, createdTime?: string, modifiedTime?: string }} StatsItem
 * @param {StatsItem[]} rootFiles
 * @param {StatsItem[]} [nestedFiles]
 */
export function summarizeFolderFiles(rootFiles, nestedFiles = []) {
  const entry = {
    fileCount: 0,
    folderCount: 0,
    size: 0,
    /** @type {string | null} */
    lastActivity: null,
    /** @type {string | null} Quando o último item entrou na pasta. */
    lastAdded: null,
    /** @type {Record<string, number>} */
    kinds: {},
    /** @type {{ id: string | undefined, name: string | undefined, mimeType: string | undefined, createdTime: string | null, count: number } | null} */
    brief: null,
  };
  const later = (current, candidate) => (candidate && (!current || candidate > current) ? candidate : current);

  for (const file of [...rootFiles, ...nestedFiles]) {
    entry.lastAdded = later(entry.lastAdded, file.createdTime);
    entry.lastActivity = later(entry.lastActivity, file.createdTime);
    if (isGoogleNative(file.mimeType)) entry.lastActivity = later(entry.lastActivity, file.modifiedTime);

    if (file.mimeType === FOLDER_MIME) entry.folderCount += 1;
    else {
      entry.fileCount += 1;
      entry.size += Number(file.size ?? 0);
      const kind = kindOf(file.mimeType, file.name);
      entry.kinds[kind] = (entry.kinds[kind] ?? 0) + 1;
    }
  }

  const { file: brief, count } = pickBrief(rootFiles);
  if (brief) {
    entry.brief = {
      id: brief.id,
      name: brief.name,
      mimeType: brief.mimeType,
      // Quando o briefing chegou — um marco da linha do tempo do projeto.
      createdTime: brief.createdTime ?? null,
      // Mais de um: a tela avisa qual foi usado.
      count,
    };
  }

  return entry;
}

/**
 * Estatísticas de uma pasta de projeto: contagens, volume, tipos, última
 * atividade e o arquivo de briefing, se houver — ver `summarizeFolderFiles`.
 *
 * Uma consulta por pasta, e não um `OR` de vários `parents`: a busca do Drive
 * devolve resultados incompletos para essas consultas combinadas — arquivos
 * existentes simplesmente não vinham, e a contagem do card saía menor que a
 * realidade. As subpastas descem com a mesma profundidade da tela de geração
 * (`walkProjectFiles`), uma consulta por subpasta. Quem chama controla a
 * concorrência entre projetos e o cache de cada um.
 */
export async function statsForFolder(folderId, { maxDepth = 4 } = {}) {
  const listChildren = (id) =>
    listAll({ q: `'${id}' in parents and trashed = false`, fields: STATS_FIELDS });

  const rootFiles = await listChildren(folderId);
  const nested = [];
  // Um atalho circular faria a descida passear para sempre: cada pasta, uma vez.
  const seen = new Set([folderId]);
  let level = rootFiles.filter((file) => file.mimeType === FOLDER_MIME).map((file) => file.id);

  for (let depth = 1; depth < maxDepth && level.length; depth++) {
    const fresh = level.filter((id) => !seen.has(id));
    for (const id of fresh) seen.add(id);
    const children = (await mapWithConcurrency(fresh, 4, listChildren)).flat();
    nested.push(...children);
    level = children.filter((file) => file.mimeType === FOLDER_MIME).map((file) => file.id);
  }

  return summarizeFolderFiles(rootFiles, nested);
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

/**
 * Um trecho do arquivo, em memória — o índice de um `.zip` fica nos últimos
 * bytes, e lê-lo assim dispensa baixar o compactado inteiro.
 *
 * @param {string} fileId
 * @param {number} start primeiro byte
 * @param {number} end último byte, inclusive
 */
export async function readFileRange(fileId, start, end) {
  const { data } = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer", headers: { Range: `bytes=${start}-${end}` } },
  );
  // Como na extração do briefing: com `arraybuffer`, `data` é o binário.
  return Buffer.from(/** @type {ArrayBuffer} */ (/** @type {unknown} */ (data)));
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
