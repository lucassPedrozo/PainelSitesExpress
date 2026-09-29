import { HttpError } from "../http.js";
import { runtimeConfig } from "../config.js";
import { identityAllows } from "../security/permissions.js";
import { RateLimiter, scheduleThrottlePruning } from "../security/throttle.js";
import { assertIdentifier } from "./input.js";

/* Condições que uma rota de deploy confere antes de agir. */

const mutationLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 });
scheduleThrottlePruning(mutationLimiter);

const clientKey = (req) => req.socket.remoteAddress ?? "desconhecido";

export const assertMutationAllowed = (req) => {
  // A permissão é conferida aqui, e não rota a rota: toda mutação de deploy já
  // passa por este ponto, então uma rota nova nasce protegida em vez de depender
  // de alguém lembrar do middleware. Vem antes do limitador de propósito — uma
  // chamada recusada não deve gastar a cota de quem nem podia fazê-la.
  if (!identityAllows(req.identity, "publicar")) {
    throw new HttpError(
      403,
      "Esta chave de acesso não tem permissão para publicar sites.",
    );
  }

  const decision = mutationLimiter.consume(clientKey(req));
  if (!decision.allowed) {
    throw new HttpError(
      429,
      "Muitas operações em sequência. Aguarde alguns segundos.",
      { "Retry-After": String(decision.retryAfterSeconds) },
    );
  }
};

/** As rotas de repositório só fazem sentido com token e organização definidos. */
export const assertConfigured = () => {
  const { githubToken, organization } = runtimeConfig();
  if (!githubToken) {
    throw new HttpError(
      503,
      "O token do GitHub ainda não foi configurado. Abra as configurações do painel.",
    );
  }
  if (!organization) {
    throw new HttpError(
      503,
      "A organização do GitHub ainda não foi configurada. Abra as configurações do painel.",
    );
  }
};

/**
 * As telas de configuração gravam tokens e senhas no `.env`. Quem pode é
 * decidido pela chave de acesso (permissão `configurar`), não por onde a
 * pessoa está: o painel é o mesmo no localhost e na rede local. Fora da LAN
 * nada chega aqui — o `localNetworkOnly` barra antes.
 */
export const assertCanConfigure = (req) => {
  if (!identityAllows(req.identity, "configurar")) {
    throw new HttpError(
      403,
      "Esta chave de acesso não tem permissão para configurar o painel.",
    );
  }
};

/** Resolve e valida `:owner/:repo`, limitando o alcance à organização. */
export const repoParams = (req) => {
  const owner = assertIdentifier(req.params.owner, "Organização");
  const repo = assertIdentifier(req.params.repo, "Repositório");
  const { organization } = runtimeConfig();
  if (!organization || owner.toLowerCase() !== organization.toLowerCase()) {
    throw new HttpError(403, "O repositório está fora da organização configurada.");
  }
  return { owner, repo };
};
