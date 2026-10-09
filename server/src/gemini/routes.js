import { Router } from "express";
import { assertInsideDriveRoot } from "../drive.js";
import { httpError } from "../http.js";
import { requirePermission } from "../security/permissions.js";
import { RateLimiter, scheduleThrottlePruning } from "../security/throttle.js";
import { analyzeBriefing, parseAnalysisInput } from "./briefing.js";
import { candidateModels, geminiPreferredModel, isGeminiConfigured, NOT_CONFIGURED } from "./client.js";

/**
 * Rotas do assistente (Gemini): o que a tela de geração pede ao modelo.
 *
 * Nada aqui gasta crédito do Lovable nem toca no site. A chave do Gemini fica
 * no servidor; o navegador recebe só se o assistente está configurado e os
 * modelos que o painel tenta.
 */
export const assistantRouter = Router();

/** Todo `:id` é uma pasta de projeto do Drive, dentro da raiz das coletas. */
assistantRouter.param("id", async (_req, _res, next, id) => {
  await assertInsideDriveRoot(id);
  next();
});

/**
 * A cota gratuita é por chave, e a chave é uma só para o painel inteiro: o
 * limite vale para todo mundo junto. O cache de 24 h não passa por aqui —
 * só a chamada real conta.
 */
const analises = new RateLimiter({ limit: 8, windowMs: 60_000 });
scheduleThrottlePruning(analises);

const assertQuota = () => {
  const decisao = analises.consume("gemini");
  if (!decisao.allowed) {
    throw httpError(
      429,
      "Muitas análises em sequência. Para a chave do Gemini continuar no nível gratuito, aguarde alguns segundos.",
      { "Retry-After": String(decisao.retryAfterSeconds) },
    );
  }
};

/** Se o assistente está configurado — para a tela saber se mostra o botão. */
assistantRouter.get("/assistant/status", (_req, res) => {
  res.json({
    configured: isGeminiConfigured(),
    preferredModel: geminiPreferredModel() || null,
    models: candidateModels(),
  });
});

/**
 * Analisa o briefing como está na tela (editável), mais as observações e os
 * nomes dos arquivos do projeto. Tudo sugestão: nada entra no envio sem a
 * pessoa inserir.
 */
assistantRouter.post(
  "/projects/:id/assistant/briefing",
  requirePermission("gerar"),
  async (req, res) => {
    if (!isGeminiConfigured()) throw httpError(409, NOT_CONFIGURED);
    const input = parseAnalysisInput(req.body);
    res.json(await analyzeBriefing(input, { beforeCall: assertQuota }));
  },
);
