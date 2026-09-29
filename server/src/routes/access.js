import { Router } from "express";
import { config } from "../config.js";
import { dropSession, dropSessionsOfUser, readSession } from "../security/access.js";
import {
  authenticationRequired,
  identityFromSession,
  identityPermissions,
  issueSessionCookie,
  readSessionCookie,
  SESSION_COOKIE,
} from "../security/authenticate.js";
import { canAdministerAccessKeys } from "../security/network.js";
import { identityAllows } from "../security/permissions.js";
import {
  createAccessUser,
  listAccessUsers,
  revokeAccessUser,
  setAccessUserPermissions,
} from "../store/access-users.js";

/** Entrada no painel, identidade de quem usa e administração das chaves. */
export const accessRouter = Router();

/**
 * Porteiro: a única resposta que o painel precisa antes de se autenticar.
 * Diz se há chave a pedir e se *este navegador* já tem sessão válida — nada
 * sobre o painel em si. É o que permite à interface não guardar a chave: ao
 * abrir, ela pergunta aqui em vez de reapresentar a chave.
 */
accessRouter.get("/gate", async (req, res) => {
  const required = await authenticationRequired();
  const authenticated = required
    ? Boolean(await identityFromSession(readSession(readSessionCookie(req))))
    : true;
  res.json({ authenticationRequired: required, authenticated });
});

/**
 * Troca a chave por um cookie de sessão. Chamada uma vez, na entrada do painel:
 * a partir daí toda a interface — inclusive `<img>` e `<iframe>` — se
 * autentica pelo cookie, e a chave não precisa ficar guardada no navegador.
 */
accessRouter.post("/session", async (req, res) => {
  if (!(await authenticationRequired())) {
    return res.json({ authenticationRequired: false, user: null });
  }

  issueSessionCookie(res, req.identity);
  res.json({
    authenticationRequired: true,
    user: { name: req.identity.name, kind: req.identity.kind },
  });
});

/** Encerra a sessão deste navegador. */
accessRouter.post("/session/logout", (req, res) => {
  dropSession(readSessionCookie(req));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

/**
 * Duas perguntas somadas: *o que* a chave pode e *de onde* ela fala.
 *
 * Quem pode: qualquer chave com a permissão `administrar` — a chave mestra do
 * `.env` a tem sempre; uma chave pessoal, só se ela foi concedida. Isso vale
 * também na própria máquina: sentar no loopback não dispensa a permissão.
 * De onde: loopback ou rede local; endereço fora da LAN não passa nem com a
 * permissão. (Painel sem chave nenhuma não tem identidade, e ali tudo é
 * permitido — ver `identityAllows`.)
 * @param {import("express").Request} req
 */
const canManageAccessKeys = (req) =>
  identityAllows(req.identity, "administrar") &&
  canAdministerAccessKeys({
    remoteAddress: req.socket.remoteAddress,
    isAdmin: true,
  });

/** Quem está usando o painel — o cabeçalho mostra o nome. */
accessRouter.get("/me", (req, res) => {
  res.json({
    user: req.identity
      ? { name: req.identity.name, kind: req.identity.kind }
      : null,
    // A tela só oferece o botão de chaves quando ele vai funcionar.
    canManageAccess: canManageAccessKeys(req),
    // A interface desabilita o que esta chave não pode fazer. É conveniência,
    // não defesa: cada rota confere de novo, porque esconder um botão não
    // impede ninguém de chamar a API na mão.
    permissions: identityPermissions(req),
  });
});

accessRouter.get("/health", (_req, res) => {
  res.json({ ok: true, rootFolderId: config.rootFolderId });
});

/* ------------------------------------------------------------------ *
 * Chaves de acesso — administração restrita a quem tem `administrar`
 *
 * Distribuir e revogar acesso é a operação mais sensível do painel. Exige a
 * permissão `administrar` (a chave mestra do `.env` sempre a tem), vinda da
 * própria máquina ou da rede local. A chave mestra continua sendo a única que
 * a tela não cria nem revoga, então ninguém tranca o dono do painel para fora.
 *
 * A tela de configuração do deploy continua exclusiva do loopback: ela grava o
 * token do GitHub em disco, e isso é outro grau de exposição.
 * ------------------------------------------------------------------ */

/** @type {import("express").RequestHandler} */
const accessAdminOnly = (req, res, next) => {
  if (canManageAccessKeys(req)) return next();
  res.status(403).json({
    error:
      "Esta chave de acesso não tem permissão para administrar chaves de acesso.",
  });
};

accessRouter.get("/access-keys", accessAdminOnly, async (_req, res) => {
  res.json({ users: await listAccessUsers() });
});

accessRouter.post("/access-keys", accessAdminOnly, async (req, res) => {
  const { user, key } = await createAccessUser(
    req.body?.name,
    req.body?.permissions ?? [],
  );
  // `key` aparece só aqui: o painel guarda apenas o hash.
  res.status(201).json({ user, key });
});

/**
 * Troca as permissões de uma chave já distribuída. A chave em si continua
 * valendo: mudar o que alguém pode fazer não deveria obrigar a reenviar uma
 * chave nova para a pessoa.
 */
accessRouter.put(
  "/access-keys/:id/permissions",
  accessAdminOnly,
  async (req, res) => {
    const user = await setAccessUserPermissions(
      req.params.id,
      req.body?.permissions,
    );
    res.json({ user });
  },
);

accessRouter.delete("/access-keys/:id", accessAdminOnly, async (req, res) => {
  await revokeAccessUser(req.params.id);
  // Revogar precisa cortar as sessões abertas na hora, senão a chave
  // continuaria valendo até o cookie expirar.
  const encerradas = dropSessionsOfUser(req.params.id);
  res.json({ revoked: true, sessionsClosed: encerradas });
});
