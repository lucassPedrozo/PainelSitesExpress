import { Router } from "express";
import { config, devAreaConfig, isDevAreaConfigured, runtimeConfig } from "../config.js";
import {
  beginAuthorization,
  completeAuthorization,
  disconnect,
  getStatus,
} from "./oauth.js";
import {
  changeGenerationProject,
  forgetGeneration,
  linkGeneration,
  listGenerations,
  setGenerationDelivered,
  setGenerationRepository,
} from "../store/generations.js";
import {
  attachSharePreview,
  checkAllSharePreviews,
  checkSharePreview,
} from "../preview/service.js";
import { isConfigured as shortlinksConfigured } from "../shortlinks/service.js";
import { checkDevArea, publishDevAreaNow, retireDevAreaRepo } from "../devarea/service.js";
import { assertInsideDriveRoot } from "../drive.js";
import { httpError, publicMessageOf, statusOf } from "../http.js";
import { identityAllows, requirePermission } from "../security/permissions.js";
import { listTools } from "./mcp.js";
import { generateSite, listWorkspaces } from "./generate.js";
import { buildPackage, previewGeneration } from "./package.js";
import { replyToAgent, watchGeneration } from "./progress.js";
import { lovableNameOf, parseLovableProject, planLink } from "./link.js";
import { listRepos } from "../deploy/github/repositories.js";
import { githubConfig } from "../deploy/operations.js";
import { getPublication, recordPublicationConfig, setPublicationRuns } from "../store/publications.js";

export const lovableRouter = Router();

/**
 * Todo `:id` deste router é uma pasta de projeto do Drive: precisa ter formato
 * de id e estar dentro da pasta raiz das coletas.
 */
lovableRouter.param("id", async (_req, _res, next, id) => {
  await assertInsideDriveRoot(id);
  next();
});

/* ------------------------------------------------------------------ *
 * Conexão com a conta do Lovable
 * ------------------------------------------------------------------ */

lovableRouter.get(
  "/lovable/status",
  async (_req, res) => {
    const status = await getStatus();
    res.json({
      ...status,
      generation: {
        enabled: config.lovable.enableGeneration,
        maxAttachments: config.lovable.maxAttachments,
        maxAttachmentBytes: config.lovable.maxAttachmentBytes,
      },
    });
  },
);

/** Registra o painel (se preciso) e devolve a URL de consentimento. */
lovableRouter.post(
  "/lovable/connect",
  requirePermission("gerar"),
  async (_req, res) => {
    res.json({ authorizeUrl: await beginAuthorization() });
  },
);

/** Onde o Lovable devolve o navegador depois do consentimento. */
lovableRouter.get(
  "/lovable/callback",
  async (req, res) => {
    const { code, state, error, error_description: description } = req.query;

    if (error) {
      return res.status(400).send(page("Autorização recusada", description ?? error, false));
    }
    if (!code) {
      return res.status(400).send(page("Faltou o código", "O Lovable não enviou o parâmetro `code`.", false));
    }

    try {
      await completeAuthorization(String(code), state ? String(state) : null);
    } catch (err) {
      console.error("[lovable] retorno do OAuth falhou:", err?.message ?? err);
      // Mesma regra do tratador de erros da API: detalhe interno fica no log.
      const status = statusOf(err);
      return res
        .status(status)
        .send(page("Não deu certo", publicMessageOf(err, status), false));
    }

    res.send(
      page(
        "Painel conectado ao Lovable",
        "Pode fechar esta aba e voltar para o painel.",
        true,
      ),
    );
  },
);

/**
 * O mesmo retorno, colado à mão. O Lovable só aceita devolver o navegador a
 * `http://localhost:<porta>`, então quem conecta pela rede local cai numa aba
 * que não abre — no computador *dela* não há painel nessa porta. O endereço
 * dessa aba carrega o `code` e o `state`; colado aqui, o painel conclui a
 * troca como se o retorno tivesse chegado. O `state` (e o PKCE guardado no
 * servidor) continua valendo: um endereço de outra autorização é recusado.
 */
lovableRouter.post(
  "/lovable/callback/manual",
  requirePermission("gerar"),
  async (req, res) => {
    const bruto = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    let params;
    try {
      params = bruto.includes("?")
        ? new URL(bruto, "http://localhost").searchParams
        : new URLSearchParams(bruto);
    } catch {
      params = new URLSearchParams();
    }
    const error = params.get("error");
    if (error) {
      throw httpError(400, `O Lovable recusou a autorização: ${params.get("error_description") ?? error}`);
    }
    const code = params.get("code");
    if (!code) {
      throw httpError(400, "Esse endereço não tem o código da autorização. Copie o endereço inteiro da aba de retorno.");
    }
    await completeAuthorization(code, params.get("state"));
    res.status(204).end();
  },
);

lovableRouter.post(
  "/lovable/disconnect",
  requirePermission("gerar"),
  async (_req, res) => {
    await disconnect();
    res.status(204).end();
  },
);

/** Conferência da conexão: `tools/list` não consome crédito. */
lovableRouter.get(
  "/lovable/tools",
  async (_req, res) => {
    res.json({ tools: await listTools() });
  },
);

/** Workspaces da conta — chamada gratuita. */
lovableRouter.get(
  "/lovable/workspaces",
  async (_req, res) => {
    res.json({ workspaces: await listWorkspaces() });
  },
);

/* ------------------------------------------------------------------ *
 * Geração do site
 * ------------------------------------------------------------------ */

/** Prompt do briefing + arquivos do projeto classificados. Só lê o Drive. */
lovableRouter.get(
  "/projects/:id/build-package",
  async (req, res) => {
    res.json(
      await buildPackage(req.params.id, { refresh: req.query.refresh === "1" }),
    );
  },
);

/** Ensaio: mostra o que seria enviado sem tocar no Lovable. */
lovableRouter.post(
  "/projects/:id/generate/preview",
  requirePermission("gerar"),
  async (req, res) => {
    const { prompt, fileIds } = req.body ?? {};
    res.json(await previewGeneration(req.params.id, { prompt, fileIds }));
  },
);

/**
 * Dispara a criação no Lovable. CONSOME CRÉDITO.
 *
 * Três travas antes de gastar: `confirm` explícito no corpo, a chave
 * LOVABLE_ENABLE_GENERATION no .env (conferida dentro de generateSite) e a
 * confirmação na interface.
 */
lovableRouter.post(
  "/projects/:id/generate",
  requirePermission("gerar"),
  async (req, res) => {
    const { prompt, fileIds, workspaceId, workspaceName, confirm } =
      req.body ?? {};

    if (confirm !== true) {
      return res.status(428).json({
        error: "Envie confirm: true para autorizar uma chamada que gasta crédito",
      });
    }

    const result = await generateSite(req.params.id, {
      prompt,
      fileIds,
      workspaceId,
      workspaceName,
    });
    // O site ainda vai ser construído: o painel acompanha e o card mostra.
    if (result.generation?.id) {
      watchGeneration(req.params.id, result.generation.id);
    }
    res.status(201).json(result);
  },
);

/**
 * Responde ao agente que parou esperando alguém. CONSOME CRÉDITO: exige
 * `confirm: true`, como a geração, e a mesma chave do `.env`.
 */
lovableRouter.post(
  "/projects/:id/generations/:lovableId/reply",
  requirePermission("gerar"),
  async (req, res) => {
    const { message, confirm } = req.body ?? {};
    if (confirm !== true) {
      return res.status(428).json({
        error: "Envie confirm: true para autorizar uma mensagem que gasta crédito",
      });
    }
    const generation = await replyToAgent(req.params.id, req.params.lovableId, message);
    res.json({ generation });
  },
);

/* ------------------------------------------------------------------ *
 * Link público do cliente
 *
 * O preview do Lovable (`id-preview--<id>.lovable.app`) exige sessão e devolve
 * 401 a qualquer visitante — nem marcar o projeto como `public` abre. O que
 * abre é o link do botão "Share preview", que o MCP do Lovable não sabe criar.
 * Então o operador cola aqui, e o painel mascara e vigia.
 * ------------------------------------------------------------------ */

/** Estado do encurtador, para a tela saber se pode oferecer o recurso. */
lovableRouter.get("/shortlinks/status", (_req, res) => {
  res.json({ configured: shortlinksConfigured() });
});

/** Registra o link de share e garante o link curto estável que o mascara. */
lovableRouter.put(
  "/projects/:id/generations/:lovableId/share-link",
  requirePermission("gerar"),
  async (req, res) => {
    res.json(
      await attachSharePreview(
        req.params.id,
        req.params.lovableId,
        req.body?.sharePreviewUrl,
      ),
    );
  },
);

/**
 * Reconfere um link — é a sonda que decide se ele pode ir ao cliente. Site na
 * área de desenvolvimento é conferido pela pasta, não pelo Share preview.
 */
lovableRouter.post(
  "/projects/:id/generations/:lovableId/share-link/check",
  async (req, res) => {
    const { id, lovableId } = req.params;
    const geracao = ((await listGenerations())[id] ?? []).find(
      (item) => item.id === lovableId,
    );
    if (geracao?.devArea?.repoFullName) {
      res.json({ generation: await checkDevArea(id, lovableId) });
      return;
    }
    res.json(await checkSharePreview(id, lovableId));
  },
);

/* ------------------------------------------------------------------ *
 * Área de desenvolvimento
 * ------------------------------------------------------------------ */

/** Se a área está configurada, e onde — para a tela saber o que oferecer. */
lovableRouter.get("/dev-area/status", (_req, res) => {
  res.json({
    configured: isDevAreaConfigured(),
    url: isDevAreaConfigured() ? devAreaConfig().url : null,
  });
});

/**
 * Publica o site na área agora. O painel já faz isso sozinho com os sites
 * novos; o botão serve para os que não entram sozinhos (com link curto antigo)
 * e para não esperar a próxima varredura.
 */
lovableRouter.post(
  "/projects/:id/generations/:lovableId/dev-area",
  requirePermission("publicar"),
  async (req, res) => {
    const generation = await publishDevAreaNow(
      req.params.id,
      req.params.lovableId,
      req.identity?.name ?? null,
    );
    res.json({ generation });
  },
);

/** Varredura geral: acha os clientes que estão com link quebrado agora. */
lovableRouter.post(
  "/share-links/check",
  async (_req, res) => {
    res.json(await checkAllSharePreviews());
  },
);

/**
 * Registra a entrega ao cliente. Guarda quem entregou — só possível agora que
 * cada pessoa tem a sua chave.
 */
lovableRouter.post(
  "/projects/:id/generations/:lovableId/delivered",
  requirePermission("gerar"),
  async (req, res) => {
    const generation = await setGenerationDelivered(
      req.params.id,
      req.params.lovableId,
      {
        delivered: req.body?.delivered !== false,
        by: req.identity?.name ?? null,
      },
    );
    res.json({ generation });
  },
);

/**
 * Liga o site ao repositório em que ele é publicado. Com isso o painel para
 * de adivinhar: da próxima vez, o repositório já vem certo.
 */
lovableRouter.put(
  "/projects/:id/generations/:lovableId/repository",
  requirePermission("publicar"),
  async (req, res) => {
    const repoFullName = String(req.body?.repoFullName ?? "").trim();
    const [owner, name, ...resto] = repoFullName.split("/");
    if (!owner || !name || resto.length || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) {
      throw httpError(400, "Repositório inválido — use organização/nome");
    }
    const organizacao = runtimeConfig().organization;
    if (organizacao && owner.toLowerCase() !== organizacao.toLowerCase()) {
      throw httpError(400, `O repositório precisa ser da organização ${organizacao}`);
    }
    const generation = await setGenerationRepository(
      req.params.id,
      req.params.lovableId,
      repoFullName,
    );
    res.json({ generation });
  },
);

/**
 * Vincula um site feito fora do painel: um projeto do Lovable criado à mão,
 * um repositório da organização, ou os dois. Nasce na etapa que a pessoa
 * declarar — pronto, já enviado ao cliente ou já no ar — e, se pedido, vai
 * direto para a área de aprovação.
 */
lovableRouter.post(
  "/projects/:id/generations/link",
  requirePermission("gerar"),
  async (req, res) => {
    const body = req.body ?? {};
    const querPrevia = body.publishApproval === true;
    if ((querPrevia || body.state === "live") && !identityAllows(req.identity, "publicar")) {
      throw httpError(403, "Esta chave de acesso não tem permissão para publicar sites.");
    }

    let repos;
    if (typeof body.repoFullName === "string" && body.repoFullName.trim()) {
      const { githubToken, organization } = runtimeConfig();
      if (!githubToken || !organization) {
        throw httpError(409, "Configure o token e a organização do GitHub em Configurações → GitHub e publicação.");
      }
      repos = new Set(
        (await listRepos(githubConfig(), { organization, perPage: 100 })).map((repo) =>
          repo.full_name.toLowerCase(),
        ),
      );
    }
    const plano = planLink(body, repos);

    let dominio = null;
    if (plano.state === "live") {
      dominio = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
      if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio)) {
        throw httpError(400, "Informe o domínio em que o site está no ar (ex.: cliente.com.br).");
      }
      // O registro de publicação é um por repositório: marcar este domínio
      // num repositório que já publica outro trocaria o domínio dele.
      const existente = await getPublication(/** @type {string} */ (plano.repoFullName));
      if (existente?.domain && existente.domain.toLowerCase() !== dominio) {
        throw httpError(
          409,
          `O repositório ${plano.repoFullName} já publica ${existente.domain}. Escolha o repositório deste site.`,
        );
      }
    }

    const quem = req.identity?.name ?? null;
    let generation = await linkGeneration(req.params.id, {
      id: plano.id,
      url: plano.url,
      repoFullName: plano.repoFullName,
      lovableName: plano.lovableId ? await lovableNameOf(plano.lovableId) : null,
      displayName: plano.repoFullName?.split("/")[1] ?? null,
      by: quem,
      delivered: plano.state === "delivered",
    });

    // "Já está no ar": o domínio passa a constar como publicado por este
    // repositório. O acompanhamento do deploy segue valendo daqui em diante.
    if (plano.state === "live" && plano.repoFullName) {
      await recordPublicationConfig(plano.repoFullName, { domain: dominio, branch: null, settings: null, by: quem });
      await setPublicationRuns(plano.repoFullName, { lastSuccessAt: new Date().toISOString() });
    }

    // A área de aprovação é um passo à parte: o vínculo fica gravado mesmo se
    // ela falhar, e a tela diz o motivo.
    let aviso = null;
    if (querPrevia) {
      try {
        generation = await publishDevAreaNow(req.params.id, generation.id, quem);
      } catch (err) {
        aviso = publicMessageOf(err, statusOf(err));
      }
    }

    res.status(201).json({ generation, warning: aviso });
  },
);

/**
 * Troca o projeto do Lovable de um site já registrado — o site foi refeito
 * num projeto novo. O link do cliente e a pasta de aprovação continuam; o que
 * era do projeto antigo é zerado (ver `changeGenerationProject`).
 */
lovableRouter.put(
  "/projects/:id/generations/:lovableId/lovable-project",
  requirePermission("gerar"),
  async (req, res) => {
    const novoId = parseLovableProject(req.body?.lovable);
    if (!novoId) {
      throw httpError(400, "Cole o link do projeto novo no Lovable (lovable.dev/projects/…).");
    }
    if (novoId === req.params.lovableId) {
      throw httpError(400, "Este já é o projeto do site.");
    }
    const querPrevia = req.body?.publishApproval === true;
    if (querPrevia && !identityAllows(req.identity, "publicar")) {
      throw httpError(403, "Esta chave de acesso não tem permissão para publicar sites.");
    }

    const { generation: trocada, previousRepo, previousBranch } = await changeGenerationProject(
      req.params.id,
      req.params.lovableId,
      {
        id: novoId,
        url: `https://lovable.dev/projects/${novoId}`,
        lovableName: await lovableNameOf(novoId),
      },
    );
    let generation = trocada;

    const avisos = [];
    if (previousRepo) {
      const aviso = await retireDevAreaRepo(previousRepo, previousBranch);
      if (aviso) avisos.push(aviso);
    }
    if (querPrevia) {
      try {
        generation = await publishDevAreaNow(req.params.id, novoId, req.identity?.name ?? null);
      } catch (err) {
        avisos.push(publicMessageOf(err, statusOf(err)));
      }
    }

    res.json({ generation, previousId: req.params.lovableId, warning: avisos.join(" ") || null });
  },
);

/** Remove um site da lista do projeto — não mexe no projeto lá no Lovable. */
lovableRouter.delete(
  "/projects/:id/generations/:lovableId",
  requirePermission("gerar"),
  async (req, res) => {
    await forgetGeneration(req.params.id, req.params.lovableId);
    res.status(204).end();
  },
);

/** Página simples do retorno do OAuth — sem recurso externo. */
function page(title, message, ok) {
  const escape = (text) =>
    String(text).replace(
      /[&<>"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );

  return `<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<title>${escape(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.5 system-ui, sans-serif; background: #0b0b0c; color: #fafafa; }
  .card { max-width: 28rem; padding: 2rem; text-align: center; }
  .dot { width: 2.5rem; height: 2.5rem; margin: 0 auto 1rem; border-radius: 50%;
         background: ${ok ? "#10b981" : "#ef4444"}; }
  p { color: #a1a1aa; }
</style>
<div class="card">
  <div class="dot"></div>
  <h1>${escape(title)}</h1>
  <p>${escape(message)}</p>
</div>`;
}
