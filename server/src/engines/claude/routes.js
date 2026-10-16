import { createReadStream } from "node:fs";
import express, { Router } from "express";
import { assertProjectId } from "../../routes/drive-scoped.js";
import { activeEngineId } from "../index.js";
import { identityAllows, requirePermission } from "../../security/permissions.js";
import { MAX_BYTES_DO_ANEXO } from "./attachments.js";
import { servicoClaude } from "./service.js";

/**
 * As rotas do motor Claude: o briefing, a geração, o acompanhamento e a fila.
 *
 * Ficam atrás do que protege o resto do painel — política de rede, sessão — e
 * cada uma que muda alguma coisa pede a permissão `gerar`. As que disparam o
 * `claude -p` consomem a assinatura do Claude Code e respondem, nesta ordem,
 * como as do Lovable:
 *
 *   403  a chave não pode gerar
 *   428  faltou `confirm: true` no corpo
 *   409  o projeto já tem um pedido em andamento
 *   400  o pedido não passa na conferência
 *   423  a trava do `.env` está desligada
 *
 * O ensaio (`/preview`) confere tudo e mostra o comando que rodaria, sem
 * gastar — funciona com a trava desligada.
 */
export const claudeRouter = Router();

/** Todo `:id` deste router é um projeto: uma pasta do Drive ou um criado no painel. */
claudeRouter.param("id", async (_req, _res, next, id) => {
  await assertProjectId(id);
  next();
});

const podeGerar = requirePermission("gerar");

/**
 * A segunda trava: quem chama diz com todas as letras que sabe que vai gastar.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
const confirmado = (req, res, next) => {
  if (req.body?.confirm === true) return next();
  res.status(428).json({
    error: "Envie confirm: true para autorizar uma execução que consome a assinatura do Claude",
  });
};

/**
 * Quem pediu, e se pode publicar: o site só segue sozinho para o GitHub
 * quando quem pediu a geração também poderia enviá-lo.
 * @param {import("express").Request} req
 */
const autor = (req) => ({
  quem: req.identity?.name ?? null,
  publicar: identityAllows(req.identity, "publicar"),
});

const id = (req) => String(req.params.id);

/* ------------------------------------------------------------------ *
 * O motor e a fila
 * ------------------------------------------------------------------ */

/** Instalado, liberado e o que há na fila. Não consulta o motor. */
claudeRouter.get("/claude/status", async (_req, res) => {
  // O motor que a tela de geração traz marcado; cada geração escolhe o seu.
  res.json({ ...(await servicoClaude().estado()), defaultEngine: activeEngineId() });
});

/**
 * O que a execução em andamento escreveu depois do cursor da tela. A tela
 * repete a consulta: não há conexão aberta, e nada se perde ao reconectar.
 */
claudeRouter.get("/claude/events", async (req, res) => {
  res.json(await servicoClaude().eventos(req.query.cursor, req.query.item));
});

/**
 * Cancela uma execução em andamento — a de `?item=`, ou a principal. Não
 * gasta: interrompe o gasto.
 */
claudeRouter.post("/claude/queue/cancel", podeGerar, async (req, res) => {
  res.json(await servicoClaude().cancelar(req.query.item));
});

/** Libera a fila que voltou pausada de um reinício. CONSOME A ASSINATURA. */
claudeRouter.post("/claude/queue/resume", podeGerar, confirmado, async (_req, res) => {
  res.json(await servicoClaude().retomarFila());
});

/** Retoma uma execução interrompida. CONSOME A ASSINATURA. */
claudeRouter.post(
  "/claude/queue/interrupted/:itemId/resume",
  podeGerar,
  confirmado,
  async (req, res) => {
    res.json(await servicoClaude().retomarInterrompida(req.params.itemId, autor(req)));
  },
);

claudeRouter.delete("/claude/queue/interrupted/:itemId", podeGerar, async (req, res) => {
  res.json(await servicoClaude().descartarInterrompida(req.params.itemId));
});

/** Tira da fila um pedido que ainda não começou. */
claudeRouter.delete("/claude/queue/:itemId", podeGerar, async (req, res) => {
  res.json(await servicoClaude().remover(req.params.itemId));
});

/* ------------------------------------------------------------------ *
 * O projeto no motor
 * ------------------------------------------------------------------ */

/** Briefing, revisão, site e execuções do projeto. */
claudeRouter.get("/projects/:id/claude", async (req, res) => {
  res.json(await servicoClaude().detalhe(id(req)));
});

/** O material do projeto, classificado, para a tela de geração. Só lê. */
claudeRouter.get("/projects/:id/claude/material", async (req, res) => {
  res.json(await servicoClaude().material(id(req), { refresh: req.query.refresh === "1" }));
});

/** O log legível de uma execução. */
claudeRouter.get("/projects/:id/claude/runs/:runId/log", async (req, res) => {
  res.json(await servicoClaude().log(id(req), req.params.runId));
});

/**
 * Uma imagem da pasta de trabalho: tela do site, foto do material do cliente,
 * miniatura de foto de banco proposta. Só imagem, com o tipo fixado pela
 * extensão — o site gerado nunca é servido por aqui.
 */
claudeRouter.get("/projects/:id/claude/images/:tipo", async (req, res) => {
  const { arquivo, contentType } = await servicoClaude().imagem(
    id(req),
    /** @type {any} */ (req.params.tipo),
    String(req.query.path ?? ""),
  );
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Content-Disposition", "inline");
  createReadStream(arquivo)
    .on("error", () => res.destroy())
    .pipe(res);
});

/* ----- briefing ---------------------------------------------------- */

/** Ensaio: o que seria copiado e o comando que rodaria. Não gasta. */
claudeRouter.post("/projects/:id/claude/briefing/preview", podeGerar, async (req, res) => {
  res.json(await servicoClaude().ensaiarBriefing(id(req), req.body ?? {}, autor(req).quem));
});

/** Copia o material e pede o briefing ao Claude. CONSOME A ASSINATURA. */
claudeRouter.post("/projects/:id/claude/briefing", podeGerar, confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().pedirBriefing(id(req), req.body ?? {}, autor(req)));
});

/** Grava o briefing corrigido na tela; a conferência volta na resposta. */
claudeRouter.put("/projects/:id/claude/briefing", podeGerar, async (req, res) => {
  res.json(await servicoClaude().gravarBriefing(id(req), req.body?.briefing, autor(req).quem));
});

/**
 * As opções do projeto: o modelo e o esforço das execuções dele, o que vale
 * no lugar do que ele não escolheu e as opções do site. Só lê.
 */
claudeRouter.get("/projects/:id/claude/options", async (req, res) => {
  res.json(await servicoClaude().opcoes(id(req)));
});

/**
 * Grava as opções do projeto: `modelo` e `esforco` no banco do painel, `site`
 * no briefing, pelo motor. Não gasta; o que não vem no corpo fica como está.
 */
claudeRouter.put("/projects/:id/claude/options", podeGerar, async (req, res) => {
  res.json(await servicoClaude().gravarOpcoes(id(req), req.body, autor(req).quem));
});

/* ----- site -------------------------------------------------------- */

/** Ensaio da geração: a conferência do briefing e o comando. Não gasta. */
claudeRouter.post("/projects/:id/claude/generate/preview", podeGerar, async (req, res) => {
  res.json(await servicoClaude().ensaiarSite(id(req), req.body ?? {}));
});

/** Gera o site a partir do briefing. CONSOME A ASSINATURA. */
claudeRouter.post("/projects/:id/claude/generate", podeGerar, confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().pedirSite(id(req), req.body ?? {}, autor(req)));
});

/** Pede um ajuste no site gerado. CONSOME A ASSINATURA. */
claudeRouter.post("/projects/:id/claude/adjust", podeGerar, confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().pedirAjuste(id(req), req.body ?? {}, autor(req)));
});

/**
 * Sobe uma imagem para acompanhar o próximo pedido de ajuste. O corpo é a
 * imagem crua; o nome vem em `?name=` e o rascunho, depois da primeira, em
 * `?draft=`. Não usa o Claude: só guarda o arquivo na pasta do site.
 */
claudeRouter.put(
  "/projects/:id/claude/adjust/attachments",
  podeGerar,
  express.raw({ type: () => true, limit: MAX_BYTES_DO_ANEXO }),
  async (req, res) => {
    const salvo = await servicoClaude().anexar(id(req), {
      rascunho: req.query.draft === undefined ? undefined : String(req.query.draft),
      nome: String(req.query.name ?? ""),
      corpo: req.body,
    });
    res.status(201).json(salvo);
  },
);

claudeRouter.delete("/projects/:id/claude/adjust/attachments", podeGerar, async (req, res) => {
  await servicoClaude().desanexar(id(req), { rascunho: req.query.draft, arquivo: req.query.file });
  res.status(204).end();
});

/**
 * "Continuar": põe na fila o passo que o motor indica para o site — continuar
 * uma etapa aberta, criticar ou refinar. CONSOME A ASSINATURA.
 */
claudeRouter.post("/projects/:id/claude/continue", podeGerar, confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().pedirContinuacao(id(req), req.body ?? {}, autor(req)));
});

/** Aprova a direção criativa e segue para a geração. CONSOME A ASSINATURA. */
claudeRouter.post("/projects/:id/claude/approve", podeGerar, confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().aprovar(id(req), autor(req)));
});

/**
 * Escolhe outra rota criativa entre as propostas (`rota`: o número dela) e
 * segue para a direção ser refeita com ela. CONSOME A ASSINATURA.
 */
claudeRouter.post("/projects/:id/claude/route", podeGerar, confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().escolherRota(id(req), req.body?.rota, autor(req)));
});

/** Fecha como falha a etapa que ficou aberta. */
claudeRouter.post("/projects/:id/claude/abort", podeGerar, async (req, res) => {
  res.json(await servicoClaude().abortar(id(req), req.body?.motivo));
});

/**
 * O site já gerado passa a aceitar várias páginas, ou volta a ser de página
 * única. Não usa o Claude: só muda o que o próximo ajuste pode fazer.
 */
claudeRouter.put("/projects/:id/claude/site/type", podeGerar, async (req, res) => {
  res.json(await servicoClaude().mudarTipoDoSite(id(req), req.body ?? {}));
});

/** Recusa uma foto de banco proposta, antes de aprovar a direção. */
claudeRouter.post("/projects/:id/claude/stock-photos/refuse", podeGerar, async (req, res) => {
  res.json(await servicoClaude().recusarFoto(id(req), req.body?.ref));
});

/* ----- GitHub ------------------------------------------------------ */

/** Há, nos arquivos do projeto, um site feito na ferramenta antiga para trazer ao motor? Só lê. */
claudeRouter.get("/projects/:id/claude/adopt", async (req, res) => {
  res.json(await servicoClaude().planoDaAdocao(id(req)));
});

/**
 * Traz para o motor um site feito na ferramenta antiga, a partir da pasta dele
 * enviada ao projeto. Não dispara o Claude: só copia e registra.
 */
claudeRouter.post("/projects/:id/claude/adopt", podeGerar, async (req, res) => {
  res.status(201).json(await servicoClaude().adotar(id(req), { origem: req.body?.sourcePath, quem: req.identity?.name ?? null }));
});

/** Para onde o site iria, quantos arquivos e o que impede o envio. Só lê. */
claudeRouter.get("/projects/:id/claude/repository", async (req, res) => {
  res.json(await servicoClaude().planoDoEnvio(id(req)));
});

/**
 * Manda o site validado ao GitHub: cria o repositório na organização (ou
 * atualiza o que o site já tem) e segue para a área de aprovação. É uma
 * publicação — pede a permissão `publicar`, como o resto do caminho do GitHub.
 */
claudeRouter.post("/projects/:id/claude/repository", requirePermission("publicar"), async (req, res) => {
  const resultado = await servicoClaude().enviarAoGitHub(id(req), {
    quem: req.identity?.name ?? null,
    repoName: req.body?.repoName,
    privado: req.body?.private !== false,
  });
  res.status(resultado.repository.created ? 201 : 200).json(resultado);
});

/** Roda o build e a validação do site. Não usa o Claude. */
claudeRouter.post("/projects/:id/claude/validate", podeGerar, async (req, res) => {
  res.json(await servicoClaude().validar(id(req)));
});

/** Fotografa o site (`telas`, o único tipo de captura). Não usa o Claude. */
claudeRouter.post("/projects/:id/claude/captures/:tipo", podeGerar, async (req, res) => {
  res.json(await servicoClaude().capturar(id(req), req.params.tipo));
});

/* ------------------------------------------------------------------ *
 * Edição livre: ajustes pelo Claude em sites de repositório (Lovable)
 * ------------------------------------------------------------------ */

/** A aba "Ajustes": se o projeto pode, o repositório, o pedido em andamento e a memória. Só lê. */
claudeRouter.get("/projects/:id/edits", async (req, res) => {
  res.json(await servicoClaude().edicoes(id(req)));
});

/**
 * A última versão do site no GitHub e quem fez as alterações recentes
 * (Lovable, Claude, outra pessoa). Atualiza o clone do painel; não usa o Claude.
 */
claudeRouter.get("/projects/:id/edits/version", async (req, res) => {
  res.json(await servicoClaude().versaoDaEdicao(id(req)));
});

/**
 * Pede um ajuste pelo Claude no site de repositório. CONSOME A ASSINATURA, e
 * o resultado vai ao GitHub (e daí à área de aprovação do cliente): pede as
 * permissões `gerar` e `publicar`.
 */
claudeRouter.post("/projects/:id/edits", podeGerar, requirePermission("publicar"), confirmado, async (req, res) => {
  res.status(201).json(await servicoClaude().pedirEdicao(id(req), req.body ?? {}, { quem: req.identity?.name ?? null }));
});

/** Sobe uma imagem para o próximo pedido de ajuste do site de repositório. Não usa o Claude. */
claudeRouter.put(
  "/projects/:id/edits/attachments",
  podeGerar,
  express.raw({ type: () => true, limit: MAX_BYTES_DO_ANEXO }),
  async (req, res) => {
    const salvo = await servicoClaude().anexarNaEdicao(id(req), {
      rascunho: req.query.draft === undefined ? undefined : String(req.query.draft),
      nome: String(req.query.name ?? ""),
      corpo: req.body,
    });
    res.status(201).json(salvo);
  },
);

claudeRouter.delete("/projects/:id/edits/attachments", podeGerar, async (req, res) => {
  await servicoClaude().desanexarDaEdicao(id(req), { rascunho: req.query.draft, arquivo: req.query.file });
  res.status(204).end();
});

/** O log de um ajuste, refeito do stream guardado. */
claudeRouter.get("/projects/:id/edits/:editId/log", async (req, res) => {
  res.json(await servicoClaude().logDaEdicao(id(req), String(req.params.editId)));
});
