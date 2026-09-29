/**
 * Regras puras das rotas de arquivo — separadas do router para poderem ser
 * testadas sem Drive nem Express.
 */

const THUMBNAIL_DEFAULT = 400;
const THUMBNAIL_MIN = 32;
const THUMBNAIL_MAX = 1600;

/**
 * Tamanho da miniatura pedido ao Drive. Sem validação, `?size=abc` virava
 * `=sNaN` na URL e `?size=99999` pedia uma imagem enorme para o proxy
 * carregar na memória; agora vale um inteiro dentro de uma faixa útil.
 * @param {unknown} raw
 */
export const thumbnailSize = (raw) => {
  const size = Number(raw ?? THUMBNAIL_DEFAULT);
  if (!Number.isFinite(size)) return THUMBNAIL_DEFAULT;
  return Math.min(THUMBNAIL_MAX, Math.max(THUMBNAIL_MIN, Math.round(size)));
};

/**
 * Só uma faixa simples (`bytes=100-` ou `bytes=100-199`) é repassada ao Drive.
 * Faixas múltiplas viram multipart, que o `<video>` não pede e não vale
 * suportar; qualquer outra coisa é ignorada e o arquivo sai inteiro.
 * @param {unknown} header
 * @returns {string | undefined}
 */
export const singleByteRange = (header) =>
  typeof header === "string" && /^bytes=\d+-\d*$/.test(header.trim())
    ? header.trim()
    : undefined;

/**
 * Lê um cabeçalho da resposta do googleapis, que já os entregou como objeto
 * simples e como `Headers`, conforme a versão.
 * @param {any} headers
 * @param {string} name
 * @returns {string | undefined}
 */
export const headerOf = (headers, name) => {
  const value =
    typeof headers?.get === "function" ? headers.get(name) : headers?.[name];
  return value == null ? undefined : String(value);
};
