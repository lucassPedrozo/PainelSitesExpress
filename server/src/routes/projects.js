import { Router } from "express";
import { loadBrief } from "../brief.js";
import { cached, invalidate } from "../cache.js";
import { config } from "../config.js";
import {
  listProjectFolders,
  mapWithConcurrency,
  rememberInsideDriveRoot,
  statsForFolder,
} from "../drive.js";
import {
  findDomain,
  normalizeDomain,
  parseCollectionName,
} from "../../../shared/domain.js";
import { requirePermission } from "../security/permissions.js";
import { listGenerations } from "../store/generations.js";
import { listProjectNames, setProjectName } from "../store/project-names.js";
import { lastAttemptOf, listPublications } from "../store/publications.js";
import {
  getFinishedTagId,
  listProjectTags,
  setProjectTags,
} from "../store/tags.js";
import { driveScoped } from "./drive-scoped.js";

/** Projetos: as pastas de cliente do Drive, com o que o painel sabe delas. */
export const projectsRouter = Router();

/**
 * Projeto finalizado não recebe material novo, então as estatísticas dele
 * podem esperar bem mais para serem refeitas. Era aqui que a lista pesava:
 * uma consulta ao Drive por pasta a cada minuto, inclusive das dezenas de
 * pastas que ninguém mais toca. "Atualizar" continua refazendo todas.
 */
export const FINISHED_STATS_TTL_MS = 6 * 60 * 60_000;

const STATS_CONCURRENCY = 8;

const emptyStats = {
  fileCount: 0,
  folderCount: 0,
  size: 0,
  lastActivity: null,
  kinds: {},
  brief: null,
};

/**
 * O domínio do projeto: o do apelido, quando o apelido é um domínio, senão o
 * do nome da pasta. É por ele que o projeto encontra a sua publicação — o
 * painel grava o domínio ao configurar o repositório, não o id da pasta.
 */
function projectDomain(folderName, alias) {
  const fromAlias = findDomain(alias);
  if (fromAlias?.exact) return fromAlias.domain;
  return parseCollectionName(folderName).domain;
}

/** Publicações por domínio normalizado — com e sem `www.` casam. */
async function publicationsByDomain() {
  const byDomain = new Map();
  for (const publication of await listPublications()) {
    const domain = normalizeDomain(publication.domain);
    // A lista vem do envio mais recente para o mais antigo: o primeiro vence.
    if (domain && !byDomain.has(domain)) byDomain.set(domain, publication);
  }
  return byDomain;
}

/** Lista os projetos (pastas de cliente) com métricas agregadas. */
projectsRouter.get("/projects", async (req, res) => {
  if (req.query.refresh === "1") {
    invalidate("projects");
    invalidate("stats:");
  }

  const folders = await cached("projects", () => listProjectFolders());
  rememberInsideDriveRoot(folders.map((folder) => folder.id));

  const projectTags = await listProjectTags();
  const finishedTagId = await getFinishedTagId();

  const stats = await mapWithConcurrency(folders, STATS_CONCURRENCY, (folder) => {
    const finished = Boolean(
      finishedTagId && projectTags[folder.id]?.includes(finishedTagId),
    );
    return cached(
      `stats:${folder.id}`,
      () => statsForFolder(folder.id),
      finished ? FINISHED_STATS_TTL_MS : config.cacheTtlMs,
    );
  });

  const generations = await listGenerations();
  const names = await listProjectNames();
  const publications = await publicationsByDomain();

  // O mesmo cliente às vezes preenche o formulário duas vezes (a primeira
  // incompleta). Cada envio vira uma pasta; contar as do mesmo domínio deixa o
  // card avisar que existe outra coleta.
  const domains = folders.map((folder) =>
    projectDomain(folder.name, names[folder.id] ?? null),
  );
  const collectionsByDomain = new Map();
  for (const domain of domains) {
    if (domain) {
      collectionsByDomain.set(domain, (collectionsByDomain.get(domain) ?? 0) + 1);
    }
  }

  const projects = folders.map((folder, index) => {
    const s = stats[index] ?? emptyStats;
    const alias = names[folder.id] ?? null;
    const domain = domains[index];
    const publication = domain ? publications.get(domain) : undefined;
    return {
      id: folder.id,
      name: folder.name,
      description: folder.description ?? null,
      createdTime: folder.createdTime,
      modifiedTime: folder.modifiedTime,
      webViewLink: folder.webViewLink,
      owner: folder.owners?.[0]?.displayName ?? null,
      fileCount: s.fileCount,
      folderCount: s.folderCount,
      totalSize: s.size,
      kinds: s.kinds,
      lastActivity: s.lastActivity ?? folder.modifiedTime,
      brief: s.brief,
      tagIds: projectTags[folder.id] ?? [],
      generations: generations[folder.id] ?? [],
      // `name` continua sendo o da pasta no Drive; o apelido é do painel.
      alias,
      domain,
      domainCollections: domain ? collectionsByDomain.get(domain) : 0,
      publication: publication
        ? {
            domain: publication.domain,
            repoFullName: publication.repoFullName,
            configuredAt: publication.configuredAt ?? null,
            lastDeployAt: publication.lastDeployAt ?? null,
            lastAttempt: lastAttemptOf(publication),
          }
        : null,
    };
  });

  res.json({ projects, fetchedAt: new Date().toISOString() });
});

/** Texto do briefing do projeto — o prompt que vai para o Lovable. */
projectsRouter.get("/projects/:id/brief", driveScoped, async (req, res) => {
  const brief = await loadBrief(req.params.id, {
    refresh: req.query.refresh === "1",
  });

  if (!brief.found) {
    return res
      .status(404)
      .json({ error: "Nenhum arquivo de informações do site nesta pasta" });
  }

  res.json(brief);
});

projectsRouter.put(
  "/projects/:id/tags",
  driveScoped,
  requirePermission("organizar"),
  async (req, res) => {
    const tagIds = Array.isArray(req.body?.tagIds) ? req.body.tagIds : [];
    res.json({ tagIds: await setProjectTags(req.params.id, tagIds) });
  },
);

/**
 * Apelido do projeto no painel. A pasta do Drive não é renomeada — o acesso é
 * somente leitura — então isto vale só aqui dentro. Enviar vazio volta ao nome
 * original da pasta.
 */
projectsRouter.put(
  "/projects/:id/name",
  driveScoped,
  requirePermission("organizar"),
  async (req, res) => {
    res.json({ alias: await setProjectName(req.params.id, req.body?.name) });
  },
);
