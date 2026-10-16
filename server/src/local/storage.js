import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { mimeOfName } from "../archive/entry-type.js";
import { renameWithRetry } from "../atomic-write.js";
import { config } from "../config.js";
import { httpError } from "../http.js";
import { isLocalProjectId } from "../store/local-projects.js";

/**
 * Os arquivos dos projetos criados no painel.
 *
 * O Drive é somente leitura para o painel, então o que entra por aqui mora em
 * disco, numa pasta por projeto dentro da pasta de dados
 * (`server/data/projetos/<id>/`). Os arquivos aparecem na mesma tela das
 * coletas: as rotas de pasta e de arquivo reconhecem o id e leem daqui.
 *
 * Todo caminho vem do navegador e é conferido antes de tocar o disco — é o
 * único lugar do painel em que um pedido escolhe onde gravar.
 */

/** 500 MB por arquivo: cabe um vídeo de cliente; mais que isso não é material de site. */
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_SEGMENT_LENGTH = 180;
/** Teto das varreduras: um projeto com mais arquivos que isto não é um site. */
const MAX_WALK_FILES = 20_000;

const projectsRoot = () => path.join(config.dataDir, "projetos");

/** A pasta do projeto em disco. */
const projectDir = (projectId) => {
  if (!isLocalProjectId(projectId)) throw httpError(404, "Projeto não encontrado.");
  return path.join(projectsRoot(), projectId);
};

// Caracteres que o Windows recusa em nome de arquivo, e os de controle.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"|?*\u0000-\u001f]/;
/** Nomes que o Windows reserva a dispositivos, com ou sem extensão. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * O caminho relativo, limpo: partes separadas por `/`, sem `..`, sem nome que
 * o sistema de arquivos recuse. Vazio é a raiz do projeto.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanRelativePath(raw) {
  const text = typeof raw === "string" ? raw : "";
  const parts = text.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.length > MAX_DEPTH) throw httpError(400, "Caminho com pastas demais.");

  for (const part of parts) {
    if (
      part === ".." ||
      part.length > MAX_SEGMENT_LENGTH ||
      FORBIDDEN.test(part) ||
      RESERVED.test(part) ||
      // O Windows descarta ponto e espaço finais: "a." e "a" seriam o mesmo arquivo.
      /[. ]$/.test(part)
    ) {
      throw httpError(400, `Nome de arquivo ou pasta inválido: “${part.slice(0, 60)}”.`);
    }
  }
  return parts.join("/");
}

/** O caminho em disco de um item do projeto — sempre dentro da pasta dele. */
function resolveInProject(projectId, relativePath) {
  const root = projectDir(projectId);
  const clean = cleanRelativePath(relativePath);
  const absolute = path.resolve(root, ...clean.split("/").filter(Boolean));
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw httpError(400, "Caminho fora do projeto.");
  }
  return { root, relative: clean, absolute };
}

/* ------------------------------------------------------------------ *
 * Ids de arquivo
 *
 * A tela pede pastas e arquivos por id, como no Drive. O id de um item local
 * é `<projeto>~<caminho em base64url>`: o `~` não existe em id do Drive, então
 * um não se passa pelo outro, e o caminho volta a ser conferido a cada uso.
 * ------------------------------------------------------------------ */

const SEPARATOR = "~";

export const localFileId = (projectId, relativePath) =>
  relativePath
    ? `${projectId}${SEPARATOR}${Buffer.from(relativePath, "utf8").toString("base64url")}`
    : projectId;

/**
 * @param {unknown} id
 * @returns {{ projectId: string, path: string } | null} `null` quando não é local
 */
export function parseLocalFileId(id) {
  if (typeof id !== "string") return null;
  const at = id.indexOf(SEPARATOR);
  const projectId = at < 0 ? id : id.slice(0, at);
  if (!isLocalProjectId(projectId)) return null;
  if (at < 0) return { projectId, path: "" };
  const encoded = id.slice(at + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  return { projectId, path: Buffer.from(encoded, "base64url").toString("utf8") };
}

/* ------------------------------------------------------------------ *
 * Leitura
 * ------------------------------------------------------------------ */

const isMissing = (err) => err?.code === "ENOENT" || err?.code === "ENOTDIR";

/** Itens diretos de uma pasta do projeto; pasta que não existe é pasta vazia na raiz. */
export async function listChildren(projectId, relativePath = "") {
  const { relative, absolute } = resolveInProject(projectId, relativePath);
  let names;
  try {
    names = await fs.readdir(absolute, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err) && !relative) return [];
    if (isMissing(err)) throw httpError(404, "Pasta não encontrada.");
    throw err;
  }

  const items = await Promise.all(
    names
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map(async (entry) => {
        const childPath = relative ? `${relative}/${entry.name}` : entry.name;
        const stat = await fs.stat(path.join(absolute, entry.name));
        return {
          path: childPath,
          name: entry.name,
          directory: entry.isDirectory(),
          size: entry.isDirectory() ? null : stat.size,
          createdTime: stat.birthtime.toISOString(),
          modifiedTime: stat.mtime.toISOString(),
          mimeType: entry.isDirectory() ? "application/vnd.google-apps.folder" : mimeOfName(entry.name),
        };
      }),
  );
  return items.sort(
    (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, "pt-BR"),
  );
}

/**
 * Todos os arquivos abaixo de um caminho, com o caminho relativo a ele.
 *
 * @param {string} projectId
 * @param {string} [relativePath]
 * @returns {Promise<Array<{ path: string, absolute: string, size: number, modifiedTime: string, createdTime: string }>>}
 */
export async function walkFiles(projectId, relativePath = "") {
  const { absolute: start } = resolveInProject(projectId, relativePath);
  const files = [];

  const visit = async (dir, prefix, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(absolute, relative, depth + 1);
      else if (entry.isFile()) {
        if (files.length >= MAX_WALK_FILES) {
          throw httpError(422, `Esta pasta tem mais de ${MAX_WALK_FILES.toLocaleString("pt-BR")} arquivos.`);
        }
        const stat = await fs.stat(absolute);
        files.push({
          path: relative,
          absolute,
          size: stat.size,
          modifiedTime: stat.mtime.toISOString(),
          createdTime: stat.birthtime.toISOString(),
        });
      }
    }
  };

  await visit(start, "", 0);
  return files;
}

/** Tipo e tamanho de um arquivo do projeto, ou 404. */
export async function statFile(projectId, relativePath) {
  const { relative, absolute } = resolveInProject(projectId, relativePath);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    if (isMissing(err)) throw httpError(404, "Arquivo não encontrado.");
    throw err;
  }
  if (!relative || !stat.isFile()) throw httpError(404, "Arquivo não encontrado.");
  return {
    path: relative,
    absolute,
    name: path.basename(absolute),
    size: stat.size,
    mimeType: mimeOfName(absolute),
    modifiedTime: stat.mtime.toISOString(),
  };
}

/**
 * Um trecho do arquivo — `end` inclusive, como no cabeçalho `Range`.
 * @param {string} absolute
 * @param {{ start?: number, end?: number }} [range]
 */
export const readStream = (absolute, range) => createReadStream(absolute, range);

/** Um trecho do arquivo em memória — o índice de um `.zip` fica no fim. */
export async function readRange(absolute, start, end) {
  const handle = await fs.open(absolute, "r");
  try {
    const buffer = Buffer.alloc(end - start + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/* ------------------------------------------------------------------ *
 * Escrita
 * ------------------------------------------------------------------ */

/**
 * Grava o que chega pelo fluxo. Vai para um temporário e só toma o lugar do
 * arquivo quando chegou inteiro: um envio interrompido não deixa metade de um
 * arquivo com o nome do bom.
 *
 * @param {string} projectId
 * @param {string} relativePath
 * @param {import("node:stream").Readable} source
 * @param {{ maxBytes?: number }} [options]
 */
export async function writeFile(projectId, relativePath, source, { maxBytes = MAX_FILE_BYTES } = {}) {
  const { relative, absolute } = resolveInProject(projectId, relativePath);
  if (!relative) throw httpError(400, "Informe o nome do arquivo.");

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const existing = await fs.stat(absolute).catch(() => null);
  if (existing?.isDirectory()) {
    throw httpError(409, `Já existe uma pasta chamada “${path.basename(absolute)}” aqui.`);
  }

  let size = 0;
  const limit = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) {
        done(httpError(413, `Arquivo grande demais (máx. ${Math.round(maxBytes / 1024 / 1024)} MB).`));
        return;
      }
      done(null, chunk);
    },
  });

  // Fora da pasta do projeto: um envio que morre no meio não vira arquivo dele.
  const staging = path.join(projectsRoot(), ".envios");
  await fs.mkdir(staging, { recursive: true });
  const temporary = path.join(staging, randomBytes(8).toString("hex"));
  try {
    await pipeline(source, limit, createWriteStream(temporary));
    await renameWithRetry(temporary, absolute);
  } catch (err) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    // A pasta do meio é um arquivo: "a/b.txt" quando "a" já é arquivo.
    if (err?.code === "ENOTDIR" || err?.code === "EEXIST") {
      throw httpError(409, "Já existe um arquivo com o nome de uma das pastas do caminho.");
    }
    throw err;
  }
  return { path: relative, size };
}

/** Apaga um arquivo ou uma pasta inteira do projeto. A raiz não sai por aqui. */
export async function removeEntry(projectId, relativePath) {
  const { relative, absolute } = resolveInProject(projectId, relativePath);
  if (!relative) throw httpError(400, "Informe o arquivo ou a pasta a apagar.");
  await fs.rm(absolute, { recursive: true, force: true, maxRetries: 3 });
}

/** Apaga a pasta do projeto — junto com o registro dele. */
export async function removeProjectFiles(projectId) {
  await fs.rm(projectDir(projectId), { recursive: true, force: true, maxRetries: 3 });
}
