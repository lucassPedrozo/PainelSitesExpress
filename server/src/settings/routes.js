import { Router } from "express";
import { HttpError } from "../http.js";
import { runtimeConfig } from "../config.js";
import { engineStatuses } from "../engines/index.js";
import { servicoClaude } from "../engines/claude/service.js";
import {
  candidateModels,
  createGeminiClient,
  flashTextModels,
  geminiKey,
  geminiPreferredModel,
} from "../gemini/client.js";
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
 *
 * Os testes desta tela não gastam nada, com uma exceção: "Testar Claude"
 * dispara o Claude Code de verdade. Ele responde como as rotas que geram —
 * 403 sem a permissão, 428 sem `confirm: true`, 409 com algo em andamento e
 * 423 com a trava desligada — e nunca roda sem o clique de alguém.
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
 * O motor Claude nesta máquina: o pacote, a versão do Claude Code, o navegador
 * das capturas, o modelo e o comando de uma geração. Não dispara o Claude Code.
 */
settingsRouter.get("/settings/claude", async (req, res) => {
  assertAdmin(req);
  res.json(await servicoClaude().diagnostico());
});

/**
 * "Testar Claude": um `claude -p` mínimo, que só responde "ok", para saber se
 * o login da assinatura funciona. CONSOME UM POUCO DA ASSINATURA.
 */
settingsRouter.post("/settings/check/claude", async (req, res) => {
  assertAdmin(req);
  if (req.body?.confirm !== true) {
    throw new HttpError(428, "Envie confirm: true para autorizar um teste que consome a assinatura do Claude");
  }
  assertTestAllowed(req);
  res.json(await servicoClaude().testar());
});

/**
 * Confere a chave do Gemini listando os modelos — sem gerar nada e sem custo.
 * Diz quais dos modelos que o painel tenta a chave alcança.
 */
settingsRouter.post("/settings/check/gemini", async (req, res) => {
  assertAdmin(req);
  assertTestAllowed(req);
  const apiKey =
    typeof req.body?.apiKey === "string" && req.body.apiKey.trim() ? req.body.apiKey.trim() : geminiKey();
  if (!apiKey) throw new HttpError(400, "Informe a chave do Gemini para testar.");
  if (!/^[A-Za-z0-9._~-]{20,200}$/.test(apiKey)) {
    res.json({ ok: false, reason: "A chave não tem o formato de um token (letras, números, ponto, hífen e sublinhado, sem espaços)." });
    return;
  }
  const preferido =
    typeof req.body?.model === "string" && req.body.model.trim() ? req.body.model.trim() : geminiPreferredModel();

  const cliente = createGeminiClient({ apiKey: () => apiKey, preferredModel: () => preferido });
  let models;
  try {
    models = await cliente.listModels();
  } catch (err) {
    // Chave recusada, sem permissão, sem rede: o motivo vai como resultado
    // do teste, não como erro da tela.
    if (err instanceof HttpError && err.status >= 500) {
      res.json({ ok: false, reason: err.message });
      return;
    }
    throw err;
  }

  const candidatos = candidateModels(preferido);
  res.json({
    ok: true,
    models,
    available: candidatos.filter((modelo) => models.includes(modelo)),
    // Os Flash de texto que o painel pode usar se os padrão envelhecerem.
    flash: flashTextModels(models).slice(0, 8),
    preferredModel: preferido || null,
    preferredAvailable: preferido ? models.includes(preferido) : null,
  });
});
