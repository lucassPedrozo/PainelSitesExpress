import { Router } from "express";
import { HttpError } from "../http.js";
import { runtimeConfig } from "../config.js";
import { AI_PROVIDERS, aiConfig } from "../ai/providers.js";
import { engineStatuses } from "../engines/index.js";
import { checkAccess } from "../deploy/github/access-check.js";
import { getGitHubConfig } from "../deploy/github/client.js";
import { assertCanConfigure } from "../deploy/guards.js";
import { dropSessionsOfUser } from "../security/access.js";
import { RateLimiter, scheduleThrottlePruning } from "../security/throttle.js";
import { readSettings, validateSettings, writeSettings } from "./service.js";

/**
 * Rotas /api/settings: a tela de configuração do `.env`.
 *
 * Só para chaves com a permissão `configurar`: a tela grava tokens e senhas
 * em disco. Vale igual no localhost e na rede local — quem decide é a chave,
 * não o endereço. Segredos nunca voltam ao navegador.
 */
export const settingsRouter = Router();

const testes = new RateLimiter({ limit: 10, windowMs: 60_000 });
scheduleThrottlePruning(testes);

const assertAdmin = assertCanConfigure;

const assertTestAllowed = (req) => {
  const decisao = testes.consume(req.socket.remoteAddress ?? "desconhecido");
  if (!decisao.allowed) {
    throw new HttpError(429, "Muitos testes em sequência. Aguarde alguns segundos.", {
      "Retry-After": String(decisao.retryAfterSeconds),
    });
  }
};

settingsRouter.get("/settings", async (req, res) => {
  assertAdmin(req);
  res.json({ ...readSettings(), engines: await engineStatuses() });
});

settingsRouter.put("/settings", async (req, res) => {
  assertAdmin(req);
  const resultado = validateSettings(req.body?.updates);
  if ("errors" in resultado) {
    res.status(400).json({
      error: resultado.errors._ ?? "Confira os campos destacados.",
      fieldErrors: resultado.errors,
    });
    return;
  }

  const chaveAnterior = runtimeConfig().panelAccessToken;
  const { saved, restartRequired } = writeSettings(resultado.values);
  console.log(`[config] gravado no .env: ${saved.join(", ")}`);

  // Trocar a chave mestra tem de valer para quem já estava dentro.
  let sessionsClosed = 0;
  if ("PANEL_ACCESS_TOKEN" in resultado.values && resultado.values.PANEL_ACCESS_TOKEN !== chaveAnterior) {
    sessionsClosed = dropSessionsOfUser("admin");
  }

  res.json({
    ...readSettings(),
    engines: await engineStatuses(),
    saved,
    restartRequired,
    sessionsClosed,
  });
});

/** Confere o token do GitHub — o informado, ou o gravado. */
settingsRouter.post("/settings/check/github", async (req, res) => {
  assertAdmin(req);
  assertTestAllowed(req);
  const gravado = runtimeConfig();
  const token = typeof req.body?.token === "string" && req.body.token.trim() ? req.body.token.trim() : gravado.githubToken;
  const organization =
    typeof req.body?.organization === "string" && req.body.organization.trim()
      ? req.body.organization.trim()
      : gravado.organization;
  if (!token) throw new HttpError(400, "Informe o token do GitHub para testar.");
  if (!organization) throw new HttpError(400, "Informe a organização do GitHub para testar.");
  res.json(await checkAccess(getGitHubConfig({ token }), { organization }));
});

/**
 * Confere a chave do modelo de IA listando os modelos — sem gerar nada e sem
 * custo. Aceita a chave digitada (antes de gravar) ou usa a gravada.
 */
settingsRouter.post("/settings/check/ai", async (req, res) => {
  assertAdmin(req);
  assertTestAllowed(req);
  const gravado = aiConfig();
  const providerId =
    typeof req.body?.provider === "string" && req.body.provider ? req.body.provider : gravado.providerId;
  const provedor = AI_PROVIDERS[providerId];
  if (!provedor) throw new HttpError(400, "Provedor desconhecido.");
  const apiKey = typeof req.body?.apiKey === "string" && req.body.apiKey.trim() ? req.body.apiKey.trim() : gravado.apiKey;
  if (!apiKey) throw new HttpError(400, "Informe a chave de API para testar.");
  if (!provedor.keyPattern.test(apiKey)) {
    res.json({ ok: false, reason: `A chave não tem o formato esperado (${provedor.keyHint}).` });
    return;
  }

  const resultado = await provedor.verifyKey(apiKey);
  if (!resultado.ok) {
    res.json(resultado);
    return;
  }
  // O modelo escolhido precisa estar entre os que a chave alcança.
  const modelo = (typeof req.body?.model === "string" && req.body.model) || gravado.model || provedor.defaultModel;
  res.json({
    ok: true,
    models: resultado.models,
    model: modelo,
    modelAvailable: resultado.models.includes(modelo),
  });
});
