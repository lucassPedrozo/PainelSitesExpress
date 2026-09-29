/**
 * Erros HTTP e o tratador que os transforma em resposta.
 *
 * Um único lugar para isso: antes havia uma função `httpError` por módulo e
 * uma classe `HttpError` própria do deploy, cada uma com seu jeito de levar
 * status e cabeçalhos. O `asyncRoute` que também se repetia em cada router
 * saiu de vez — o Express 5 já encaminha ao tratador a rejeição de qualquer
 * handler `async`, inclusive middleware e `router.param`.
 */

/**
 * Erro com status HTTP e mensagem feita para a pessoa que usa o painel.
 *
 * `expose` segue a convenção do `http-errors` (que o próprio Express usa): o
 * tratador só devolve ao navegador a mensagem de erro marcado assim. Qualquer
 * outra exceção — do Node, do googleapis, de um bug — pode carregar caminho de
 * arquivo, id interno ou detalhe de biblioteca, e fica só no log.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, string>} [headers] cabeçalhos extras da resposta
   */
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
    this.expose = true;
  }
}

/**
 * @param {number} status
 * @param {string} message
 * @param {Record<string, string>} [headers]
 */
export const httpError = (status, message, headers) =>
  new HttpError(status, message, headers);

/**
 * Status HTTP de um erro qualquer — o do googleapis vem em `code`.
 * @param {any} err
 */
export const statusOf = (err) => {
  const status = Number(err?.status ?? (err?.code === 404 ? 404 : 500));
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
};

export const INTERNAL_ERROR_MESSAGE =
  "Erro interno do painel. Os detalhes ficaram no log do servidor.";

/**
 * O que o navegador pode ler de um erro. Mensagem escrita para a interface
 * (`expose`) vai como está; erro de cliente (4xx) também, porque descreve o
 * pedido e não o servidor. Qualquer outra falha fica só no log.
 * @param {any} err
 * @param {number} status
 */
export const publicMessageOf = (err, status) =>
  err?.expose === true || (status < 500 && err?.message)
    ? err.message
    : INTERNAL_ERROR_MESSAGE;

/**
 * Último middleware da API.
 * @param {any} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} _next
 */
export const errorHandler = (err, req, res, _next) => {
  const status = statusOf(err);
  console.error(`[api] ${req.method} ${req.path} -> ${status}:`, err?.message ?? err);
  if (err?.headers && typeof err.headers === "object") res.set(err.headers);
  res.status(status).json({ error: publicMessageOf(err, status) });
};
