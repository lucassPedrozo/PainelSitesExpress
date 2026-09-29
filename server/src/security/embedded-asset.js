/**
 * O painel embute o conteúdo dos arquivos do Drive: a imagem num `<img>`, o PDF
 * e o texto num `<iframe>`. Os cabeçalhos globais proíbem qualquer
 * enquadramento (`X-Frame-Options: DENY` e `frame-ancestors 'none'`), o que faz
 * o Chrome recusar o quadro e mostrar "localhost recusou a conexão" no lugar da
 * pré-visualização. Estas rotas liberam o enquadramento só para a própria
 * origem — e endurecem o resto, porque um arquivo do cliente é conteúdo de
 * terceiro rodando dentro da origem do painel.
 */
const ASSET_POLICY = [
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Tipos que o navegador executaria como página. Servi-los como texto puro tira
 * a chance de um arquivo do Drive rodar script na origem do painel — no preview
 * o interessante é ver o conteúdo, não executá-lo.
 */
const ACTIVE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "application/xhtml",
]);

/** Deixa a resposta ser enquadrada pelo próprio painel. */
export const allowSameOriginFraming = (res) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", ASSET_POLICY);
};

/**
 * O tipo com que a resposta deve sair. `inline` neutraliza o que for ativo;
 * o download preserva o arquivo como ele é, porque aí o navegador não renderiza.
 */
export const safeInlineContentType = (mimeType, { download = false } = {}) => {
  const type = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (download || !ACTIVE_TYPES.has(type)) return mimeType;
  return "text/plain; charset=utf-8";
};
