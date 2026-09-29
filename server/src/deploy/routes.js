import { Router } from "express";
import { HttpError } from "../http.js";
import { runtimeConfig } from "../config.js";
import { dropSessionsOfUser } from "../security/access.js";
import { identityAllows } from "../security/permissions.js";
import {
  listPublications,
  recordDeploy,
  recordPublicationConfig,
} from "../store/publications.js";
import { checkAccess } from "./github/access-check.js";
import { followPublication } from "./watch.js";
import { getGitHubConfig } from "./github/client.js";
import {
  getWorkflowFileContent,
  listWorkflowFiles,
} from "./github/contents.js";
import { listRepos, listWorkflowRuns } from "./github/repositories.js";
import {
  assertConfigured,
  assertCanConfigure,
  assertMutationAllowed,
  repoParams,
} from "./guards.js";
import {
  assertBranch,
  assertIdentifier,
  assertWorkflowFileName,
  assertWorkflowPath,
  parsePublicationRequest,
} from "./input.js";
import {
  deleteWorkflows,
  describeManagedWorkflows,
  dispatchWithRetry,
  githubConfig,
  mapRepo,
  mapRun,
} from "./operations.js";
import { configurePublication } from "./publication.js";
import {
  parseSettingsPayload,
  readPanelSettings,
  saveSettings,
} from "./settings.js";
import {
  buildWorkflowFiles,
  DEPLOY_WORKFLOW_FILE,
  WORKFLOW_TEMPLATE_VERSION,
} from "./workflow-template.js";

/** Rotas /api/deploy: configuração do painel, repositórios e publicação. */
export const deployRouter = Router();

deployRouter.get("/status", (req, res) => {
  const runtime = runtimeConfig();
  res.json({
    service: "online",
    githubConfigured: Boolean(runtime.githubToken),
    organization: runtime.organization,
    authenticationRequired: Boolean(runtime.panelAccessToken),
    defaultFtpHost: runtime.defaultFtpHost,
    deployWorkflowFile: DEPLOY_WORKFLOW_FILE,
    workflowTemplateVersion: WORKFLOW_TEMPLATE_VERSION,
    setupRequired: !runtime.githubToken || !runtime.organization,
    // A interface só oferece a tela de configuração a quem tem a permissão
    // `configurar`; os demais veem uma instrução em vez do formulário.
    configurable: identityAllows(req.identity, "configurar"),
  });
});

deployRouter.get("/config", (req, res) => {
  assertCanConfigure(req);
  res.json(readPanelSettings());
});

deployRouter.post("/config", (req, res) => {
  assertCanConfigure(req);
  assertMutationAllowed(req);
  const updates = parseSettingsPayload(req.body);
  const previousPanelToken = runtimeConfig().panelAccessToken;
  const envPath = saveSettings(updates);
  console.log(`[deploy] configurações gravadas em ${envPath}`);

  // Trocar a chave mestra tem de valer para quem já estava dentro. As sessões
  // abertas com a antiga já são recusadas (cada uma guarda a impressão digital
  // da chave com que nasceu); aqui elas também saem do arquivo de sessões.
  if (
    updates.PANEL_ACCESS_TOKEN !== undefined &&
    updates.PANEL_ACCESS_TOKEN !== previousPanelToken
  ) {
    const encerradas = dropSessionsOfUser("admin");
    if (encerradas) {
      console.log(`[deploy] chave mestra trocada: ${encerradas} sessão(ões) encerrada(s).`);
    }
  }

  res.json(readPanelSettings());
});

deployRouter.post(
  "/config/check",
  async (req, res) => {
    assertCanConfigure(req);
    assertMutationAllowed(req);
    const body = req.body ?? {};
    const stored = runtimeConfig();
    const token =
      typeof body.githubToken === "string" && body.githubToken.trim()
        ? body.githubToken.trim()
        : stored.githubToken;
    const organization =
      typeof body.organization === "string" && body.organization.trim()
        ? body.organization.trim()
        : stored.organization;

    if (!token) throw new HttpError(400, "Informe o token do GitHub para validar.");
    if (!organization) {
      throw new HttpError(400, "Informe a organização do GitHub para validar.");
    }

    res.json(await checkAccess(getGitHubConfig({ token }), { organization }));
  },
);

deployRouter.get(
  "/repositories",
  async (_req, res) => {
    assertConfigured();
    const repos = await listRepos(githubConfig(), {
      organization: runtimeConfig().organization,
      perPage: 100,
    });
    res.json(
      repos
        .map(mapRepo)
        .sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    );
  },
);

deployRouter.get(
  "/repositories/:owner/:repo/workflows",
  async (req, res) => {
    assertConfigured();
    const route = repoParams(req);
    const branch = assertBranch(req.query.branch ?? "main");
    const files = await listWorkflowFiles(githubConfig(), { ...route, branch });
    res.json(await describeManagedWorkflows({ ...route, branch, files }));
  },
);

deployRouter.get(
  "/repositories/:owner/:repo/workflows/preview",
  async (req, res) => {
    assertConfigured();
    const route = repoParams(req);
    const branch = assertBranch(req.query.branch ?? "main");
    const path = assertWorkflowPath(req.query.path);
    res.json({
      content: await getWorkflowFileContent(githubConfig(), {
        ...route,
        path,
        branch,
      }),
    });
  },
);

deployRouter.delete(
  "/repositories/:owner/:repo/workflows",
  async (req, res) => {
    assertConfigured();
    const route = repoParams(req);
    assertMutationAllowed(req);
    const body = req.body ?? {};
    const branch = assertBranch(body.branch);
    if (!Array.isArray(body.files) || body.files.length > 100) {
      throw new HttpError(400, "Lista de workflows inválida.");
    }
    const files = body.files.map((file) => ({
      name: assertIdentifier(String(file.name), "Nome do arquivo"),
      path: assertWorkflowPath(file.path),
      sha: assertIdentifier(String(file.sha), "SHA"),
      size: Number(file.size) || 0,
    }));
    res.json(await deleteWorkflows({ ...route, files, branch }));
  },
);

deployRouter.get(
  "/repositories/:owner/:repo/runs",
  async (req, res) => {
    assertConfigured();
    const route = repoParams(req);
    const branch = assertBranch(req.query.branch ?? "main");
    const workflowFile = req.query.workflow
      ? assertWorkflowFileName(req.query.workflow)
      : undefined;
    const runs = await listWorkflowRuns(githubConfig(), {
      ...route,
      branch,
      workflowFile,
      perPage: 8,
    });
    res.json(runs.map(mapRun));
  },
);

deployRouter.post(
  "/repositories/:owner/:repo/publication",
  async (req, res) => {
    assertConfigured();
    const route = repoParams(req);
    assertMutationAllowed(req);
    const { branch, domain, autoDeploy, secrets, settings } =
      parsePublicationRequest(req.body);

    const resultado = await configurePublication({
      config: githubConfig(),
      owner: route.owner,
      repo: route.repo,
      workflowBranch: branch,
      secrets,
      workflows: buildWorkflowFiles({ branch, autoDeploy }),
    });

    // O domínio só existe aqui: ele vira secret no GitHub e não volta de lá.
    // Sem registrar neste ponto, o painel nunca saberia qual domínio pertence
    // a qual repositório.
    await recordPublicationConfig(`${route.owner}/${route.repo}`, {
      domain,
      branch,
      settings,
      by: req.identity?.name ?? null,
    });

    res.json(resultado);
  },
);

/** Quais domínios estão no ar, desde quando e por quem. */
deployRouter.get(
  "/publications",
  async (_req, res) => {
    res.json({ publications: await listPublications() });
  },
);

deployRouter.post(
  "/repositories/:owner/:repo/deploy",
  async (req, res) => {
    assertConfigured();
    const route = repoParams(req);
    assertMutationAllowed(req);
    const body = req.body ?? {};
    const branch = assertBranch(body.branch);
    const workflowFile = body.workflow
      ? assertWorkflowFileName(body.workflow)
      : DEPLOY_WORKFLOW_FILE;
    const dryRun = body.dryRun === true;

    await dispatchWithRetry({
      owner: route.owner,
      repo: route.repo,
      workflowFile,
      ref: branch,
      // Só enviar o input quando ele muda algo: assim o disparo continua
      // funcionando em workflows que não declaram dry_run.
      inputs: dryRun ? { dry_run: "true" } : undefined,
    });

    const repoFullName = `${route.owner}/${route.repo}`;
    await recordDeploy(repoFullName, {
      by: req.identity?.name ?? null,
      dryRun,
      branch,
      workflowFile,
    });
    if (!dryRun) followPublication(repoFullName);

    res.status(202).json({
      dispatched: true,
      workflow: workflowFile,
      branch,
      dryRun,
    });
  },
);
