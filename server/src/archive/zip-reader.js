import { pipeline, Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { httpError } from "../http.js";

/**
 * Leitura de um `.zip` sem baixá-lo inteiro.
 *
 * As fotos do cliente costumam chegar num compactado, e até aqui só dava para
 * saber o que havia nele baixando o arquivo. O formato ajuda: o índice (o
 * "diretório central") fica no fim, e cada entrada diz onde os seus bytes
 * começam. Então bastam duas leituras por faixa — o fim do arquivo para listar
 * e o trecho de uma entrada para abri-la —, e um zip de 300 MB custa uns
 * poucos KB para mostrar o que tem dentro.
 *
 * Quem chama entrega as leituras (`readRange`, e o fluxo da entrada), então
 * este módulo não conhece o Drive e é testado com um zip em memória.
 *
 * Fora do alcance, com mensagem clara em vez de lista errada: ZIP64 (mais de
 * 4 GB ou de 65.535 arquivos), entradas com senha e compressões que não sejam
 * "store" ou "deflate" — as duas que os compactadores comuns usam.
 */

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** O registro de fim tem 22 bytes mais um comentário de até 65.535. */
const END_MIN_BYTES = 22;
/** Cobre o registro de fim com folga e, quase sempre, o índice inteiro. */
const TAIL_BYTES = 128 * 1024;
/** Um índice maior que isto não é uma coleta de cliente. */
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;
/** Teto do que vai para a tela; o total verdadeiro segue na resposta. */
export const MAX_ENTRIES = 5000;

const notZip = () =>
  httpError(422, "Este arquivo não é um .zip que o painel consiga abrir. Baixe-o para ver o conteúdo.");

/**
 * Página de código 850 (DOS, Europa ocidental), metade de cima. É como o
 * Windows grava "Fotos da inauguração" num zip sem a marca de UTF-8; lido como
 * latin1, o nome sairia com os acentos trocados.
 */
const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * O nome de uma entrada. Com a marca de UTF-8 não há dúvida; sem ela, o macOS
 * grava UTF-8 do mesmo jeito e o Windows grava CP850 — tenta-se o primeiro, que
 * falha de forma detectável quando o texto não é UTF-8.
 *
 * @param {Buffer} raw
 * @param {boolean} utf8
 */
export function decodeEntryName(raw, utf8) {
  if (utf8) return raw.toString("utf8");
  try {
    return strictUtf8.decode(raw);
  } catch {
    let name = "";
    for (const byte of raw) {
      name += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
    }
    return name;
  }
}

/** Data e hora do MS-DOS (hora local, passos de 2 s) em ISO; `null` se inválida. */
function dosDateTime(date, time) {
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  if (!day || !month) return null;
  const moment = new Date(
    (date >> 9) + 1980,
    month - 1,
    day,
    time >> 11,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}

/** O que os sistemas põem no zip por conta própria — não é material do cliente. */
const isJunk = (path) =>
  path.startsWith("__MACOSX/") || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path);

/**
 * Acha o registro de fim nos últimos bytes do arquivo.
 *
 * @param {Buffer} tail
 * @returns {{ count: number, size: number, offset: number } | null}
 */
export function findEndOfCentralDirectory(tail) {
  for (let at = tail.length - END_MIN_BYTES; at >= 0; at--) {
    if (tail.readUInt32LE(at) !== END_SIGNATURE) continue;
    // O comentário tem de caber no que sobra: descarta a assinatura que é só
    // coincidência no meio dos dados.
    if (at + END_MIN_BYTES + tail.readUInt16LE(at + 20) > tail.length) continue;
    return {
      count: tail.readUInt16LE(at + 10),
      size: tail.readUInt32LE(at + 12),
      offset: tail.readUInt32LE(at + 16),
    };
  }
  return null;
}

/**
 * @typedef {object} ZipEntry
 * @property {string} path caminho dentro do zip, com `/` e sem `..`
 * @property {number} size tamanho original
 * @property {number} compressedSize
 * @property {number} method 0 = store, 8 = deflate
 * @property {boolean} encrypted
 * @property {string | null} modifiedTime
 * @property {number} offset onde começa o cabeçalho local
 * @property {number} end onde a entrada termina (o começo da seguinte)
 */

/**
 * As entradas de arquivo do diretório central. Pastas ficam de fora — a tela
 * as deduz dos caminhos, porque nem todo zip as registra.
 *
 * @param {Buffer} directory
 * @returns {Omit<ZipEntry, "end">[]}
 */
export function parseCentralDirectory(directory) {
  const entries = [];
  let at = 0;

  while (at + 46 <= directory.length && directory.readUInt32LE(at) === CENTRAL_SIGNATURE) {
    const flags = directory.readUInt16LE(at + 8);
    const nameLength = directory.readUInt16LE(at + 28);
    const next =
      at + 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
    if (next > directory.length) break;

    const name = decodeEntryName(
      directory.subarray(at + 46, at + 46 + nameLength),
      Boolean(flags & 0x0800),
    );
    // Só para exibir e montar as pastas: nada é gravado em disco. Ainda assim
    // `..` e a barra inicial saem, para o caminho não mentir sobre onde está.
    const path = name
      .split(/[\\/]+/)
      .filter((part) => part && part !== "." && part !== "..")
      .join("/");

    if (path && !/[\\/]$/.test(name) && !isJunk(path)) {
      entries.push({
        path,
        size: directory.readUInt32LE(at + 24),
        compressedSize: directory.readUInt32LE(at + 20),
        method: directory.readUInt16LE(at + 10),
        encrypted: Boolean(flags & 0x0001),
        modifiedTime: dosDateTime(
          directory.readUInt16LE(at + 14),
          directory.readUInt16LE(at + 12),
        ),
        offset: directory.readUInt32LE(at + 42),
      });
    }
    at = next;
  }

  return entries;
}

/**
 * Lista o conteúdo de um zip lendo só o fim do arquivo.
 *
 * @param {number} size tamanho do zip
 * @param {(start: number, end: number) => Promise<Buffer>} readRange faixa inclusiva
 * @param {{ tailBytes?: number }} [options]
 * @returns {Promise<{ entries: ZipEntry[], total: number, truncated: boolean }>}
 */
export async function readZipDirectory(size, readRange, { tailBytes = TAIL_BYTES } = {}) {
  if (!Number.isFinite(size) || size < END_MIN_BYTES) throw notZip();

  const tailStart = Math.max(0, size - tailBytes);
  const tail = await readRange(tailStart, size - 1);
  const end = findEndOfCentralDirectory(tail);
  if (!end) throw notZip();

  if (end.count === 0xffff || end.size === 0xffffffff || end.offset === 0xffffffff) {
    throw httpError(
      422,
      "Este .zip é grande demais para abrir no painel (formato ZIP64). Baixe-o para ver o conteúdo.",
    );
  }
  if (end.size > MAX_DIRECTORY_BYTES || end.offset + end.size > size) throw notZip();

  const directory =
    end.size === 0
      ? Buffer.alloc(0)
      : end.offset >= tailStart
        ? tail.subarray(end.offset - tailStart, end.offset - tailStart + end.size)
        : await readRange(end.offset, end.offset + end.size - 1);

  const parsed = parseCentralDirectory(directory);

  // Cada entrada vai até o começo da próxima (ou do índice). Pedir essa faixa
  // traz o cabeçalho local e os dados numa leitura só; o tamanho do cabeçalho
  // só se conhece lendo-o, e ele nem sempre repete o do índice.
  const starts = [...new Set(parsed.map((entry) => entry.offset))].sort((a, b) => a - b);
  const nextStart = new Map(
    starts.map((start, index) => [start, starts[index + 1] ?? end.offset]),
  );

  const entries = parsed
    .slice(0, MAX_ENTRIES)
    .map((entry) => ({ ...entry, end: nextStart.get(entry.offset) ?? end.offset }));

  return { entries, total: parsed.length, truncated: parsed.length > entries.length };
}

/**
 * Por que a entrada não pode ser aberta, ou `null` se pode.
 * @param {Pick<ZipEntry, "encrypted" | "method">} entry
 */
export function unreadableReason(entry) {
  if (entry.encrypted) return "Este arquivo está protegido por senha dentro do .zip.";
  if (entry.method !== 0 && entry.method !== 8) {
    return "Este arquivo usa uma compressão que o painel não abre. Baixe o .zip para vê-lo.";
  }
  return null;
}

/**
 * Os bytes comprimidos de uma entrada, a partir de um fluxo que começa no
 * cabeçalho local dela: pula o cabeçalho e para no fim dos dados.
 *
 * @param {AsyncIterable<Buffer>} source
 * @param {Pick<ZipEntry, "compressedSize">} entry
 */
export async function* entryBytes(source, entry) {
  let header = Buffer.alloc(0);
  let started = false;
  let remaining = entry.compressedSize;

  for await (const chunk of source) {
    let data = chunk;
    if (!started) {
      header = Buffer.concat([header, chunk]);
      if (header.length < 30) continue;
      if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw notZip();
      const length = 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (header.length < length) continue;
      started = true;
      data = header.subarray(length);
    }
    if (data.length > remaining) data = data.subarray(0, remaining);
    remaining -= data.length;
    if (data.length) yield data;
    if (remaining === 0) return;
  }

  if (remaining > 0) throw notZip();
}

/**
 * O conteúdo original de uma entrada, descomprimido conforme chega.
 *
 * O tamanho declarado é o teto: um zip montado para estourar na descompressão
 * (poucos KB que viram GB) é cortado em vez de ser despejado no navegador.
 *
 * @param {AsyncIterable<Buffer>} source fluxo do zip a partir de `entry.offset`
 * @param {Pick<ZipEntry, "compressedSize" | "size" | "method" | "encrypted">} entry
 * @returns {Readable}
 */
export function entryContent(source, entry) {
  const reason = unreadableReason(entry);
  if (reason) throw httpError(422, reason);

  const raw = Readable.from(entryBytes(source, entry));
  // O `pipeline` repassa ao último fluxo a falha de qualquer um dos anteriores.
  const data = entry.method === 8 ? pipeline(raw, createInflateRaw(), () => {}) : raw;

  return Readable.from(
    (async function* capped() {
      let total = 0;
      for await (const chunk of data) {
        total += chunk.length;
        if (total > entry.size) throw notZip();
        yield chunk;
      }
    })(),
  );
}
