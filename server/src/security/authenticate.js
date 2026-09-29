import { timingSafeEqual } from "node:crypto";
import { runtimeConfig } from "../config.js";
import {
  findAccessUserById,
  findAccessUserByKey,
  listAccessUsers,
  touchAccessUser,
} from "../store/access-users.js";
import {
  createSession,
  credentialFingerprint,
  readSession,
} from "./access.js";
import { ACCESS_PERMISSIONS } from "./permissions.js";
import { AuthThrottle, scheduleThrottlePruning } from "./throttle.js";

/**
 * Quem está falando com a API.
 *
 * A chave chega por `Authorization` na entrada e, depois, por um cookie que
 * guarda **o id da sessão** — não a chave. Antes o cookie carregava a própria
 * chave, então lê-lo era o mesmo que roubá-la.
 */

export const SESSION_COOKIE = "painel_acesso";

/** Sentinela da chave do `.env`: ela não é uma pessoa cadastrada. */
export const ADMIN = "admin";

/**
 * Rotas que o navegador alcança sem poder se autenticar antes: o retorno do
 * OAuth é uma navegação vinda do Lovable, e `/api/gate` é o que diz à
 * interface que existe uma chave a pedir.
 *
 * `/api/health` e `/api/deploy/status` saíram desta lista porque entregavam,
 * sem autenticação, o ID da pasta do Drive, o nome da organização no GitHub e
 * o host de FTP — aceitável quando o painel só escutava em 127.0.0.1,
 * indefensável quando qualquer aparelho do Wi-Fi alcança a porta.
 */
const OPEN_PATHS = new Set(["/api/gate", "/api/lovable/callback"]);

/**
 * Miniaturas e previews entram na página por `<img>` e `<iframe>`, que não têm
 * como mandar o cabeçalho `Authorization`. O cookie de sessão cobre esse caso.
 * @param {import("express").Request} req
 */
export const readSessionCookie = (req) => {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
};

/** @param {import("express").Request} req */
const bearerKey = (req) => {
  const authorization = req.headers.authorization ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
};

/** @param {string} actual @param {string} expected */
const safeCompare = (actual, expected) => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

/**
 * @typedef {object} Identity
 * @property {"admin" | "user"} kind
 * @property {string} id
 * @property {string} name
 * @property {string[]} permissions
 */

/**
 * A chave do `.env` não é uma pessoa cadastrada e não tem lista de permissões
 * gravada: ela pode tudo, por definição. É também a única que a tela de chaves
 * não consegue revogar — o que impede o painel de trancar o próprio dono para
 * fora, por mais que as permissões das outras chaves sejam mexidas.
 * @returns {Identity}
 */
const adminIdentity = () => ({
  kind: ADMIN,
  id: ADMIN,
  name: "Administrador",
  permissions: [...ACCESS_PERMISSIONS],
});

/** @returns {Identity} */
const userIdentity = (user) => ({
  kind: "user",
  id: user.id,
  name: user.name,
  permissions: user.permissions,
});

/**
 * @param {string} key
 * @returns {Promise<Identity | null>}
 */
const identityFromKey = async (key) => {
  const { panelAccessToken } = runtimeConfig();
  if (panelAccessToken && safeCompare(key, panelAccessToken)) {
    return adminIdentity();
  }
  const user = await findAccessUserByKey(key);
  return user ? userIdentity(user) : null;
};

/**
 * @param {ReturnType<typeof readSession>} session
 * @returns {Promise<Identity | null>}
 */
export const identityFromSession = async (session) => {
  if (!session) return null;

  if (session.userId === ADMIN) {
    // A sessão vale para a chave mestra com que foi aberta. Trocada a chave —
    // pela tela ou à mão no `.env` —, as sessões abertas com a antiga caem.
    const atual = credentialFingerprint(runtimeConfig().panelAccessToken);
    return atual && session.credential === atual ? adminIdentity() : null;
  }

  // A chave pode ter sido revogada com a sessão aberta.
  const user = await findAccessUserById(session.userId);
  return user ? userIdentity(user) : null;
};

/**
 * Emite o cookie de sessão. `SameSite=Strict` impede que outro site o utilize,
 * e `httpOnly` o deixa fora do alcance do JavaScript da página.
 * @param {import("express").Response} res
 * @param {Identity} identity
 */
export const issueSessionCookie = (res, identity) => {
  const credential =
    identity.kind === ADMIN
      ? credentialFingerprint(runtimeConfig().panelAccessToken)
      : null;
  res.cookie(SESSION_COOKIE, createSession(identity.id, { credential }), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
};

/** O painel pede chave quando existe a do `.env` ou alguma cadastrada. */
export const authenticationRequired = async () =>
  Boolean(runtimeConfig().panelAccessToken) ||
  (await listAccessUsers()).length > 0;

/**
 * Permissões de quem fala. Painel sem chave nenhuma não tem identidade: ali
 * tudo é permitido.
 * @param {import("express").Request} req
 */
export const identityPermissions = (req) =>
  req.identity ? req.identity.permissions : [...ACCESS_PERMISSIONS];

/**
 * Middleware que identifica quem chama a API e barra quem não se identifica.
 *
 * A chave é opcional enquanto o painel escuta só em 127.0.0.1 e ninguém a
 * definiu — qualquer processo local já leria o `.env`. Ela passa a valer quando
 * existe a do `.env` ou alguma chave pessoal.
 *
 * @param {{ throttle?: AuthThrottle }} [options]
 * @returns {import("express").RequestHandler}
 */
export function createAuthentication({ throttle } = {}) {
  const authThrottle = throttle ?? new AuthThrottle();
  if (!throttle) scheduleThrottlePruning(authThrottle);

  return async (req, res, next) => {
    if (OPEN_PATHS.has(req.path)) return next();
    // O bundle da interface não guarda segredo nenhum, e barrá-lo tornaria a
    // própria tela que pede a chave inalcançável. Só a API é protegida.
    if (!req.path.startsWith("/api/")) return next();
    if (!(await authenticationRequired())) return next();

    const key = bearerKey(req);
    const cookieSession = readSession(readSessionCookie(req));
    let identity;

    if (key) {
      // Só quem apresenta uma chave está tentando adivinhá-la, então só isso
      // conta para o bloqueio. Um cookie vencido não conta: depois de
      // reiniciar a API, cinco miniaturas com o cookie antigo bastavam para
      // bloquear a própria pessoa.
      const origem = req.socket.remoteAddress ?? "desconhecido";
      const blocked = authThrottle.check(origem);
      if (!blocked.allowed) {
        return res
          .status(429)
          .set("Retry-After", String(blocked.retryAfterSeconds))
          .json({
            error:
              "Muitas tentativas de acesso. Aguarde antes de tentar novamente.",
          });
      }

      identity = await identityFromKey(key);
      if (!identity) {
        authThrottle.registerFailure(origem);
        return res
          .status(401)
          .json({ error: "Chave de acesso inválida ou ausente." });
      }
      authThrottle.reset(origem);

      // A chave vale, mas o cookie não: renovar aqui faz as `<img>` e
      // `<iframe>` seguintes voltarem a carregar sem recarregar a página.
      if (!cookieSession && req.path !== "/api/session") {
        issueSessionCookie(res, identity);
      }
    } else {
      // Sem chave, só o cookie identifica. Um id de sessão tem 192 bits
      // aleatórios: não há o que adivinhar, e não há por que bloquear.
      identity = await identityFromSession(cookieSession);
      if (!identity) {
        return res.status(401).json({
          error: "Sessão expirada. Informe a chave de acesso novamente.",
          code: "session-expired",
        });
      }
    }

    req.identity = identity;
    // Quem usou o painel e quando. Falhar ao registrar não pode derrubar a
    // requisição, e muito menos o processo: sem o `.catch`, a rejeição não
    // tratada encerraria a API.
    if (identity.kind === "user") {
      touchAccessUser(identity.id).catch((err) => {
        console.error(`[acesso] não foi possível registrar o uso: ${err.message}`);
      });
    }
    next();
  };
}
