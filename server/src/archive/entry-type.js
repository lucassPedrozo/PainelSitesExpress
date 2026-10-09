/**
 * O tipo de um arquivo de dentro do zip. O Drive informa o tipo dos arquivos
 * soltos; dentro do compactado só há o nome, então a extensão decide.
 *
 * A lista cobre o que o painel exibe ou classifica. O resto sai como binário
 * genérico e é oferecido para download — a categoria (documento, planilha…)
 * continua vindo da extensão, em `kindOf`.
 */
const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  xml: "text/xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

/** @param {string} name */
export const mimeOfName = (name) =>
  TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Imagens que o navegador desenha num `<img>`; HEIC e TIFF ele não abre. */
const INLINE_IMAGES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/**
 * Como a entrada pode ser exibida no painel. Vídeo e áudio ficam de fora: o
 * player precisa saltar dentro do arquivo, e um fluxo descomprimido na hora
 * não tem como atender a um salto — esses são oferecidos para download.
 *
 * @param {string} mimeType
 * @returns {"image" | "pdf" | "text" | "none"}
 */
export function entryPreviewKind(mimeType) {
  if (INLINE_IMAGES.has(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";
  return "none";
}
