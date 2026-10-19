import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream";
import { Router } from "express";
import { entryPreviewKind, mimeOfName } from "../archive/entry-type.js";
import { entryContent, readZipDirectory, unreadableReason } from "../archive/zip-reader.js";
import { cached, invalidate } from "../cache.js";
import { isDevAreaConfigured, runtimeConfig } from "../config.js";
import { commitSite, createOrgRepository, getRepository } from "../deploy/github/git-data.js";
import { assertConfigured, assertMutationAllowed } from "../deploy/guards.js";
import { githubConfig } from "../deploy/operations.js";
import { followDevArea, publishDevAreaNow } from "../devarea/service.js";
import { kindOf, previewKindOf } from "../drive.js";
import { httpError, publicMessageOf, statusOf } from "../http.js";
import { EXTERNAL_PREFIX } from "../../../shared/external-site.js";
import { findSiteSources, openSiteSource } from "../local/site-source.js";
import {
  cleanRelativePath,
  listChildren,
  localFileId,
  parseLocalFileId,
  readRange,
  readStream,
  removeEntry,
  removeProjectFiles,
  statFile,
  walkFiles,
  writeFile,
} from "../local/storage.js";
import {
  allowSameOriginFraming,
  safeInlineContentType,
} from "../security/embedded-asset.js";
import { requirePermission } from "../security/permissions.js";
import { sitesDoMotorNoProjeto } from "../engines/claude/adopt.js";
import {
  linkGeneration,
  listGenerations,
  setGenerationDevArea,
  setGenerationRepository,
} from "../store/generations.js";
import {
  createLocalProject,
  deleteLocalProject,
  getLocalProject,
  isLocalProjectId,
  requireLocalProject,
} from "../store/local-projects.js";
import { isValidRepoName, repoNameOf } from "../../../shared/lovable-repo.js";
import { singleByteRange } from "./files-helpers.js";

/**
 * Projetos criados no painel: o registro, os arquivos em disco e o envio do
 * site ao GitHub.
 *
 * As rotas de pasta e de arquivo têm os mesmos endereços das do Drive
 * (`routes/files.js`) e vêm antes delas: reconhecem o id local e respondem;
 * qualquer outro id segue adiante para o Drive. Assim a tela de arquivos é a
 * mesma para os dois tipos de projeto.
 */
export const localProjectsRouter = Router();

/** Estatísticas valem até alguém gravar ou apagar no projeto. */
const statsKey = (projectId) => `local-stats:${projectId}`;
const siteKey = (projectId) => `local-site:${projectId}`;
const touched = (projectId) => {
  invalidate(statsKey(projectId));
  invalidate(siteKey(projectId));
  invalidate(`local-zip:${projectId}`);
};

/**
 * Há um site pronto entre os arquivos do projeto (uma pasta ou um `.zip` com
 * `index.html` ou `package.json`)? É o que separa "Enviar ao GitHub" de
 * "Gerar com o Claude" na lista: um projeto com fotos e textos e nenhum site
 * ainda não tem o que enviar. `null` quando a busca falhou — a lista não cai
 * por isso.
 *
 * @param {string} projectId
 * @returns {Promise<boolean | null>}
 */
export const hasSiteSource = (projectId) =>
  cached(siteKey(projectId), async () => {
    try {
      return (await findSiteSources(projectId)).length > 0;
    } catch (err) {
      console.warn(`[projetos] origem do site de ${projectId}:`, err?.message ?? err);
      return null;
    }
  });

/** As mesmas métricas que o Drive dá a uma coleta, contando as subpastas. */
export const statsForLocalProject = (projectId) =>
  cached(statsKey(projectId), async () => {
    const files = await walkFiles(projectId);
    const stats = {
      fileCount: files.length,
      folderCount: new Set(
        files.flatMap((file) => {
          const parts = file.path.split("/").slice(0, -1);
          return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
        }),
      ).size,
      size: 0,
      lastActivity: null,
      lastAdded: null,
      kinds: {},
      brief: null,
    };
    for (const file of files) {
      stats.size += file.size;
      const kind = kindOf(mimeOfName(file.path), file.path);
      stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
      if (!stats.lastActivity || file.modifiedTime > stats.lastActivity) {
        stats.lastActivity = file.modifiedTime;
      }
      if (!stats.lastAdded || file.createdTime > stats.lastAdded) stats.lastAdded = file.createdTime;
    }
    return stats;
  });

/** `:id` é um projeto do painel — o que não for responde 404. */
const localProject = async (req, _res, next) => {
  req.localProject = await requireLocalProject(String(req.params.id));
  next();
};

/* ------------------------------------------------------------------ *
 * O projeto
 * ------------------------------------------------------------------ */

localProjectsRouter.post("/projects", requirePermission("organizar"), async (req, res) => {
  const project = await createLocalProject({
    name: req.body?.name,
    kind: req.body?.kind ?? "site",
    by: req.identity?.name ?? null,
  });
  res.status(201).json({ project });
});

/**
 * Exclui o projeto do painel e os arquivos dele. Só os criados aqui: uma
 * coleta do Drive não sai por esta rota (segue adiante e termina em 404).
 */
localProjectsRouter.delete("/projects/:id", requirePermission("organizar"), async (req, res, next) => {
  const id = String(req.params.id);
  if (!isLocalProjectId(id)) return next();
  await deleteLocalProject(id);
  await removeProjectFiles(id);
  touched(id);
  res.status(204).end();
});

/**
 * Sobe um arquivo. O corpo é o conteúdo cru e o caminho vem em `?path=`: um
 * arquivo por pedido, gravado em disco conforme chega — um vídeo não passa
 * pela memória do painel.
 */
localProjectsRouter.put(
  "/projects/:id/files",
  requirePermission("organizar"),
  localProject,
  async (req, res) => {
    const saved = await writeFile(req.params.id, String(req.query.path ?? ""), req);
    touched(req.params.id);
    res.status(201).json(saved);
  },
);

localProjectsRouter.delete(
  "/projects/:id/files",
  requirePermission("organizar"),
  localProject,
  async (req, res) => {
    await removeEntry(req.params.id, String(req.query.path ?? ""));
    touched(req.params.id);
    res.status(204).end();
  },
);

/* ------------------------------------------------------------------ *
 * Pastas e arquivos — os mesmos endereços das rotas do Drive
 * ------------------------------------------------------------------ */

/** O item local do `:id`, com o projeto conferido; `null` se o id é do Drive. */
async function localTarget(req) {
  const target = parseLocalFileId(String(req.params.id));
  if (!target) return null;
  // Id com cara de local mas sem projeto: 404, sem consultar o Drive.
  if (!(await getLocalProject(target.projectId))) throw httpError(404, "Arquivo não encontrado.");
  return target;
}

/** Imagens que o navegador desenha, leves o bastante para servir de miniatura. */
const THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
const isLightImage = (mimeType, size) =>
  entryPreviewKind(mimeType) === "image" && size != null && size <= THUMBNAIL_MAX_BYTES;

localProjectsRouter.get("/folders/:id/files", async (req, res, next) => {
  const target = await localTarget(req);
  if (!target) return next();

  const children = await listChildren(target.projectId, target.path);
  res.json({
    files: children.map((item) => {
      const kind = kindOf(item.mimeType, item.name);
      return {
        id: localFileId(target.projectId, item.path),
        name: item.name,
        mimeType: item.mimeType,
        kind,
        previewKind: item.directory ? "none" : previewKindOf(item.mimeType, kind),
        size: item.size,
        createdTime: item.createdTime,
        modifiedTime: item.modifiedTime,
        // Não há Drive para abrir: o arquivo só existe no painel.
        webViewLink: "",
        webContentLink: null,
        hasThumbnail: !item.directory && isLightImage(item.mimeType, item.size),
        width: null,
        height: null,
        /** O caminho dentro do projeto — é por ele que a tela apaga o item. */
        localPath: item.path,
      };
    }),
  });
});

/** Envia o arquivo, inteiro ou a faixa pedida (o `<video>` salta por faixas). */
function sendLocalFile(req, res, file, { download }) {
  allowSameOriginFraming(res);
  res.setHeader("Content-Type", safeInlineContentType(file.mimeType, { download }));
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  );
  res.setHeader("Accept-Ranges", "bytes");

  const range = singleByteRange(req.headers.range);
  let start = 0;
  let end = file.size - 1;
  if (range && file.size > 0) {
    const [from, to] = range.replace("bytes=", "").split("-");
    start = Number(from);
    end = to ? Math.min(Number(to), file.size - 1) : file.size - 1;
    if (start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${file.size}`);
      return res.end();
    }
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
  }
  res.setHeader("Content-Length", String(file.size === 0 ? 0 : end - start + 1));
  if (file.size === 0) return res.end();

  pipeline(readStream(file.absolute, { start, end }), res, (err) => {
    if (err) res.destroy();
  });
}

localProjectsRouter.get("/files/:id/raw", async (req, res, next) => {
  const target = await localTarget(req);
  if (!target) return next();
  const file = await statFile(target.projectId, target.path);
  sendLocalFile(req, res, file, { download: req.query.download === "1" });
});

/** Não há quem gere miniatura: vai a própria imagem, quando é leve. */
localProjectsRouter.get("/files/:id/thumbnail", async (req, res, next) => {
  const target = await localTarget(req);
  if (!target) return next();
  const file = await statFile(target.projectId, target.path);
  if (!isLightImage(file.mimeType, file.size)) return res.status(404).end();
  sendLocalFile(req, res, file, { download: false });
});

/** O índice de um `.zip` do projeto, relido quando o arquivo muda. */
const localZipOf = async (target) => {
  const file = await statFile(target.projectId, target.path);
  const directory = await cached(
    `local-zip:${target.projectId}:${target.path}:${file.size}:${file.modifiedTime}`,
    () => readZipDirectory(file.size, (start, end) => readRange(file.absolute, start, end)),
  );
  return { file, directory };
};

localProjectsRouter.get("/files/:id/archive", async (req, res, next) => {
  const target = await localTarget(req);
  if (!target) return next();
  const { directory } = await localZipOf(target);
  res.json({
    total: directory.total,
    truncated: directory.truncated,
    entries: directory.entries.map((entry, index) => {
      const mimeType = mimeOfName(entry.path);
      const blocked = unreadableReason(entry);
      return {
        index,
        path: entry.path,
        size: entry.size,
        modifiedTime: entry.modifiedTime,
        mimeType,
        kind: kindOf(mimeType, entry.path),
        previewKind: blocked ? "none" : entryPreviewKind(mimeType),
        blocked,
      };
    }),
  });
});

localProjectsRouter.get("/files/:id/archive/:index", async (req, res, next) => {
  const target = await localTarget(req);
  if (!target) return next();
  const { file, directory } = await localZipOf(target);
  const entry = /^\d+$/.test(String(req.params.index))
    ? directory.entries[Number(req.params.index)]
    : undefined;
  if (!entry) throw httpError(404, "Arquivo não encontrado dentro do compactado.");
  const blocked = unreadableReason(entry);
  if (blocked) throw httpError(422, blocked);

  const download = req.query.download === "1";
  allowSameOriginFraming(res);
  res.setHeader("Content-Type", safeInlineContentType(mimeOfName(entry.path), { download }));
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Content-Length", String(entry.size));
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(entry.path.split("/").pop() ?? "arquivo")}`,
  );
  pipeline(
    entryContent(readStream(file.absolute, { start: entry.offset, end: entry.end - 1 }), entry),
    res,
    (err) => {
      if (err) res.destroy();
    },
  );
});

/* ------------------------------------------------------------------ *
 * O site do projeto no GitHub
 * ------------------------------------------------------------------ */

/** O repositório do site mais recente do projeto, se ele já tem um. */
async function siteOf(projectId) {
  const site = ((await listGenerations())[projectId] ?? []).at(-1) ?? null;
  const area = site?.devArea?.state === "retired" ? null : site?.devArea;
  return { site, repoFullName: area?.repoFullName ?? site?.repoFullName ?? null };
}

/**
 * Onde há um site nos arquivos do projeto, e para onde ele iria: o
 * repositório que o projeto já tem, ou o nome sugerido para um novo.
 */
localProjectsRouter.get("/projects/:id/site-sources", localProject, async (req, res) => {
  const { repoFullName } = await siteOf(req.params.id);
  res.json({
    sources: await findSiteSources(req.params.id),
    // Há um site do motor entre os arquivos: o caminho dele é a aba Claude.
    engineSite: (await sitesDoMotorNoProjeto(req.params.id)).length > 0,
    repoFullName,
    suggestedRepoName: repoNameOf(req.localProject.name).slice(0, 80),
    organization: runtimeConfig().organization || null,
  });
});

/**
 * A pasta de um site feito pelo motor Claude (ou pelo Joinvixable, a
 * ferramenta de antes): tem a sessão de trabalho dele. Enviada como está, não
 * constrói no GitHub — o `package.json` desses sites não declara dependência —
 * e leva junto o briefing e a direção criativa. Quem a envia é o motor, com a
 * configuração do template.
 * @param {Array<{ path: string }>} files
 */
const isEngineSite = (files) => {
  const paths = new Set(files.map((file) => file.path));
  return paths.has(".session/session.json") && paths.has("content.json");
};
const ENGINE_SITE_MESSAGE =
  "Esta pasta é de um site feito com o motor Claude (Joinvixable). Enviada como está, ela não constrói no GitHub. Abra a aba Claude do projeto e use “Trazer para o motor Claude”: o envio passa a levar a configuração certa, e o site aceita ajustes pelo painel.";

/** Um envio por projeto de cada vez: o segundo clique não cria outro repositório. */
const sending = new Set();

/**
 * Manda o site ao GitHub: cria o repositório na organização (ou atualiza o que
 * o projeto já tem) e grava o código num commit só. Daí em diante o site segue
 * o caminho de todos — prévia na área de aprovação, envio ao cliente e
 * publicação no domínio.
 */
localProjectsRouter.post("/projects/:id/repository", localProject, async (req, res) => {
  assertMutationAllowed(req);
  assertConfigured();
  const projectId = String(req.params.id);
  const body = req.body ?? {};
  const by = req.identity?.name ?? null;
  const { organization } = runtimeConfig();

  if (sending.has(projectId)) {
    throw httpError(409, "Este projeto já está sendo enviado ao GitHub. Aguarde terminar.");
  }
  sending.add(projectId);
  try {
    const source = await openSiteSource(projectId, cleanRelativePath(body.sourcePath));
    if (isEngineSite(source.files)) throw httpError(422, ENGINE_SITE_MESSAGE);
    const { site, repoFullName: known } = await siteOf(projectId);

    let repo;
    let created = false;
    let generation = site;

    if (known) {
      const [owner, name] = known.split("/");
      repo = await getRepository(githubConfig(), { owner, repo: name });
      if (!repo) {
        throw httpError(
          409,
          `O repositório ${known} não foi encontrado (ou o token do GitHub não o enxerga). Confira-o no GitHub, ou vincule outro repositório ao projeto.`,
        );
      }
    } else {
      const name = typeof body.repoName === "string" ? body.repoName.trim() : "";
      if (!isValidRepoName(name)) {
        throw httpError(400, "Nome de repositório inválido — use letras, números, hífen, ponto e sublinhado.");
      }
      if (await getRepository(githubConfig(), { owner: organization, repo: name })) {
        throw httpError(
          409,
          `Já existe o repositório ${organization}/${name}. Escolha outro nome — ou, se ele é deste site, use “Vincular site existente”.`,
        );
      }
      repo = await createOrgRepository(githubConfig(), {
        organization,
        name,
        isPrivate: body.private !== false,
        description: `Site ${req.localProject.name} — enviado pelo painel Sites Express`,
      });
      created = true;
      // Gravado já: se o envio dos arquivos falhar, tentar de novo atualiza
      // este repositório em vez de esbarrar no nome que agora existe.
      generation = site?.id
        ? await setGenerationRepository(projectId, site.id, repo.full_name)
        : await linkGeneration(projectId, {
            id: `${EXTERNAL_PREFIX}${randomBytes(6).toString("hex")}`,
            repoFullName: repo.full_name,
            displayName: repo.name,
            by,
          });
    }

    const [owner, name] = repo.full_name.split("/");
    const branch = repo.default_branch || "main";
    const commit = await commitSite({
      config: githubConfig(),
      owner,
      repo: name,
      branch,
      message: created ? "Site enviado pelo painel Sites Express" : "Atualizar o site pelo painel Sites Express",
      files: source.files,
    });

    // O push publica sozinho onde o workflow já está; o painel só precisa
    // saber que há uma execução a acompanhar. Sem workflow ainda, a prévia é
    // um passo à parte — o envio fica valendo mesmo se ela falhar.
    let warning = null;
    const area = generation?.devArea?.state === "retired" ? null : generation?.devArea;
    if (generation?.id && area?.repoFullName) {
      if (commit.changed) {
        const agora = new Date().toISOString();
        generation = await setGenerationDevArea(projectId, generation.id, {
          state: "publishing",
          lastRun: { at: agora, status: "pending", runUrl: null, sha: null },
          detail: null,
        });
        followDevArea(projectId, generation.id);
      }
    } else if (generation?.id && body.publishPreview === true) {
      if (!isDevAreaConfigured()) {
        warning = "A área de aprovação não está configurada (Configurações → Área de aprovação).";
      } else {
        try {
          generation = await publishDevAreaNow(projectId, generation.id, by);
        } catch (err) {
          warning = publicMessageOf(err, statusOf(err));
        }
      }
    }

    res.status(created ? 201 : 200).json({
      generation,
      repository: { fullName: repo.full_name, url: repo.html_url ?? `https://github.com/${repo.full_name}`, created },
      commit: { sha: commit.sha, changed: commit.changed, files: commit.total, uploaded: commit.uploaded },
      kind: source.kind,
      skipped: source.skipped,
      warning,
    });
  } finally {
    sending.delete(projectId);
  }
});
