/**
 * As regras da configuração de publicação (domínio, FTP, pasta remota e
 * variáveis de build). A API recusa o que não passar (`server/src/deploy/input.js`)
 * e a interface avisa antes de enviar (`web/src/features/deploy/validation.ts`),
 * cada uma com as suas mensagens. A porta fica de fora: as duas não a conferem
 * do mesmo jeito.
 */

/** Só o domínio, sem `https://` nem caminho. */
export const DOMAIN_PATTERN =
  /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Só o host do servidor FTP, sem `ftp://` nem caminho. */
export const HOST_PATTERN = /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;

/** A pasta remota (o `..` é recusado à parte). */
export const SERVER_DIR_PATTERN = /^[a-z0-9._/-]{1,255}$/i;

/** Cada linha das variáveis de build: `CHAVE=valor`. */
export const BUILD_ENV_LINE_PATTERN = /^[A-Z_][A-Z0-9_]*=/i;

export const MAX_FTP_LOGIN = 200;
export const MAX_FTP_PASSWORD = 512;
export const MAX_BUILD_ENV = 16 * 1024;
