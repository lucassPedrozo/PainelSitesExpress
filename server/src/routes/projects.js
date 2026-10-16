import { Router } from "express";
import { loadBrief } from "../brief.js";
import { cached, invalidate } from "../cache.js";
import { config } from "../config.js";
import { servicoClaude } from "../engines/claude/service.js";
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
import { listProjectDetails, updateProjectDetails } from "../store/project-details.js";
import { checkProjectName, listProjectNames, setProjectName } from "../store/project-names.js";
import { lastAttemptOf, listPublications } from "../store/publications.js";
import {
  getFinishedTagId,
  listProjectTags,
  setProjectTags,
} from "../store/tags.js";
import { listLocalProjects } from "../store/local-projects.js";
import { driveScoped, projectScoped } from "./drive-scoped.js";
import { siteOfOtherCollections } from "./projects-helpers.js";
import { hasSiteSource, statsForLocalProject } from "./local-projects.js";

/**
 * Projetos: as pastas de cliente do Drive e os criados no painel, com o que o
 * painel sabe deles.
 */
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
  lastAdded: null,
  kinds: {},
  brief: null,
};

/**
 * O domínio do projeto: o corrigido à mão, quando há; senão o do apelido,
 * quando o apelido é um domínio; senão o do nome da pasta. É por ele que o
 * projeto encontra a sua publicação — o painel grava o domínio ao configurar
 * o repositório, não o id da pasta.
 */
function projectDomain(folderName, alias, override = null) {
  if (override) return override;
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

  // Cópia: a lista ganha os projetos do painel logo abaixo, e a do cache é
  // só do Drive.
  /** @type {any[]} */
  const folders = [...(await cached("projects", () => listProjectFolders()))];
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

  // Os criados no painel entram na mesma lista, com o mesmo formato: o que
  // muda é de onde vêm os arquivos (`source`).
  const locals = await listLocalProjects();
  const localStats = await Promise.all(locals.map((project) => statsForLocalProject(project.id)));
  // Só os de site perguntam: num projeto de arquivos não há o que procurar.
  const localSites = await Promise.all(
    locals.map((project) => ((project.kind ?? "site") === "site" ? hasSiteSource(project.id) : null)),
  );
  for (const [index, project] of locals.entries()) {
    folders.push({
      id: project.id,
      name: project.name,
      createdTime: project.createdAt,
      modifiedTime: localStats[index].lastActivity ?? project.createdAt,
      webViewLink: "",
      owners: project.createdBy ? [{ displayName: project.createdBy }] : [],
      source: "panel",
      purpose: project.kind ?? "site",
      hasSite: localSites[index],
    });
    stats.push(localStats[index]);
  }

  const generations = await listGenerations();
  const names = await listProjectNames();
  const details = await listProjectDetails();
  const publications = await publicationsByDomain();
  // O que o motor Claude tem de cada projeto. Vem do banco do painel, sem
  // consultar o motor — e uma falha aqui não derruba a lista.
  const claude = await servicoClaude()
    .resumos()
    .catch((err) => {
      console.warn("[claude] resumo dos projetos:", err?.message ?? err);
      return {};
    });

  // O mesmo cliente às vezes preenche o formulário duas vezes (a primeira
  // incompleta). Cada envio vira uma pasta; contar as do mesmo domínio deixa o
  // card avisar que existe outra coleta.
  const domains = folders.map((folder) =>
    projectDomain(folder.name, names[folder.id] ?? null, details[folder.id]?.domain ?? null),
  );
  const collectionsByDomain = new Map();
  for (const domain of domains) {
    if (domain) {
      collectionsByDomain.set(domain, (collectionsByDomain.get(domain) ?? 0) + 1);
    }
  }

  const domainSites = siteOfOtherCollections(folders, domains, generations);

  const projects = folders.map((folder, index) => {
    const s = stats[index] ?? emptyStats;
    const alias = names[folder.id] ?? null;
    const corrigido = details[folder.id] ?? null;
    const domain = domains[index];
    const publication = domain ? publications.get(domain) : undefined;
    return {
      id: folder.id,
      /** `drive`: pasta de coleta. `panel`: criado aqui, com os arquivos em disco. */
      source: folder.source ?? "drive",
      /** Só nos do painel: `site` (para publicar) ou `files` (só material). */
      purpose: folder.purpose ?? null,
      /** Só nos do painel de site: há um site pronto entre os arquivos. */
      hasSite: folder.hasSite ?? null,
      name: folder.name,
      description: folder.description ?? null,
      // A data corrigida à mão vale em todo lugar: ordem, faixas, Dashboard.
      createdTime: corrigido?.receivedAt ?? folder.createdTime,
      modifiedTime: folder.modifiedTime,
      webViewLink: folder.webViewLink,
      owner: folder.owners?.[0]?.displayName ?? null,
      fileCount: s.fileCount,
      folderCount: s.folderCount,
      totalSize: s.size,
      kinds: s.kinds,
      // Pasta vazia: a criação dela é tudo o que aconteceu. O `modifiedTime`
      // da pasta muda com uma renomeação, que não é atividade do projeto.
      lastActivity: s.lastActivity ?? corrigido?.receivedAt ?? folder.createdTime,
      lastAdded: s.lastAdded ?? null,
      brief: s.brief,
      tagIds: projectTags[folder.id] ?? [],
      generations: generations[folder.id] ?? [],
      /** O briefing, a fila e o site do projeto no motor Claude; `null` se nunca passou por ele. */
      claude: claude[folder.id] ?? null,
      // `name` continua sendo o da pasta no Drive; o apelido é do painel.
      alias,
      domain,
      /**
       * O que a equipe corrigiu à mão — para a tela marcar o campo e oferecer
       * a volta ao cálculo. `domain` e `createdTime` acima já vêm corrigidos.
       */
      details: corrigido
        ? {
            domain: corrigido.domain ?? null,
            receivedAt: corrigido.receivedAt ?? null,
            responsible: corrigido.responsible ?? null,
            note: corrigido.note ?? null,
            stage: corrigido.stage ?? null,
            hidden: corrigido.hidden ?? null,
          }
        : null,
      domainCollections: domain ? collectionsByDomain.get(domain) : 0,
      /**
       * Só nas coletas sem site: o site do mesmo domínio registrado em outra
       * coleta — ver `siteOfOtherCollections`.
       */
      domainSite: domainSites[index],
      publication: publication
        ? {
            domain: publication.domain,
            repoFullName: publication.repoFullName,
            configuredAt: publication.configuredAt ?? null,
            configuredBy: publication.configuredBy ?? null,
            lastDeployAt: publication.lastDeployAt ?? null,
            // Quando o site foi ao ar pela primeira vez — o fim do projeto.
            firstDeployAt:
              publication.firstDeployAt ?? publication.lastDeployAt ?? null,
            lastAttempt: lastAttemptOf(publication),
            // Quem disparou cada publicação — a linha do tempo do projeto.
            deploys: (publication.deploys ?? []).map((deploy) => ({
              at: deploy.at,
              by: deploy.by ?? null,
              dryRun: Boolean(deploy.dryRun),
            })),
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
  projectScoped,
  requirePermission("organizar"),
  async (req, res) => {
    const tagIds = Array.isArray(req.body?.tagIds) ? req.body.tagIds : [];
    res.json({ tagIds: await setProjectTags(req.params.id, tagIds) });
  },
);

/**
 * Corrige à mão o que o painel calcula — domínio, data de recebimento, etapa —
 * e guarda o responsável e a observação interna. Só os campos enviados mudam;
 * vazio volta ao cálculo. O nome (`name`) é o apelido, o mesmo da rota abaixo.
 */
projectsRouter.patch(
  "/projects/:id/details",
  projectScoped,
  requirePermission("organizar"),
  async (req, res) => {
    const id = String(req.params.id);
    const body = req.body ?? {};
    const { name, ...patch } = body;
    // Tudo é conferido antes de gravar: nada fica pela metade.
    const temNome = Object.prototype.hasOwnProperty.call(body, "name");
    if (temNome) checkProjectName(name);
    const details = await updateProjectDetails(id, patch, { by: req.identity?.name ?? null });
    const alias = temNome
      ? await setProjectName(id, name)
      : ((await listProjectNames())[id] ?? null);
    res.json({ alias, details });
  },
);

/**
 * Apelido do projeto no painel. A pasta do Drive não é renomeada — o acesso é
 * somente leitura — então isto vale só aqui dentro. Enviar vazio volta ao nome
 * original da pasta.
 */
projectsRouter.put(
  "/projects/:id/name",
  projectScoped,
  requirePermission("organizar"),
  async (req, res) => {
    res.json({ alias: await setProjectName(req.params.id, req.body?.name) });
  },
);
