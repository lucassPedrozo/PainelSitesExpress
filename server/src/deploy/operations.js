import { HttpError } from "../http.js";
import { runtimeConfig } from "../config.js";
import { getGitHubConfig, GitHubRequestError } from "./github/client.js";
import { createOrUpdateFile, deleteFile, getWorkflowFileContent } from "./github/contents.js";
import { dispatchWorkflow } from "./github/repositories.js";
import {
  BUILD_WORKFLOW_FILE,
  buildWorkflowFiles,
  DEPLOY_WORKFLOW_FILE,
  readTemplateVersion,
  WORKFLOW_TEMPLATE_VERSION,
} from "./workflow-template.js";
import { readAutoDeploy } from "./workflow-render.js";

/*
 * O que as rotas de deploy fazem no GitHub além de uma chamada simples: o
 * formato devolvido à interface, a leitura da versão dos workflows gerados, o
 * disparo com novas tentativas e a remoção em lote.
 */

export const githubConfig = () => getGitHubConfig({ token: runtimeConfig().githubToken });

export const mapRepo = (repo) => {
  const [owner = "", name = repo.name] = repo.full_name.split("/");
  return {
    id: String(repo.id),
    name,
    owner,
    fullName: repo.full_name,
    createdAt: repo.created_at,
    updatedAt: repo.pushed_at || repo.updated_at,
    private: repo.private,
    defaultBranch: repo.default_branch || "main",
  };
};

export const mapRun = (run) => ({
  id: run.id,
  name: run.name ?? "Workflow",
  title: run.display_title ?? "",
  status: run.status ?? "unknown",
  conclusion: run.conclusion,
  runNumber: run.run_number,
  url: run.html_url,
  event: run.event,
  createdAt: run.created_at,
  updatedAt: run.updated_at,
});

const managedWorkflowNames = new Set(
  [BUILD_WORKFLOW_FILE, DEPLOY_WORKFLOW_FILE].map((name) => name.toLowerCase()),
);

/**
 * Lê o marcador de versão dos workflows gerados pelo painel, para a interface
 * poder avisar quando o repositório ainda roda um template antigo.
 */
export const describeManagedWorkflows = ({ owner, repo, branch, files }) =>
  Promise.all(
    files.map(async (file) => {
      if (!managedWorkflowNames.has(file.name.toLowerCase())) return file;

      try {
        const content = await getWorkflowFileContent(githubConfig(), {
          owner,
          repo,
          path: file.path,
          branch,
        });
        return {
          ...file,
          templateVersion: readTemplateVersion(content),
          // Só o de deploy decide: o de build roda a cada push por definição.
          ...(file.name.toLowerCase() === DEPLOY_WORKFLOW_FILE.toLowerCase()
            ? { autoDeploy: readAutoDeploy(content) }
            : {}),
        };
      } catch {
        // A versão é um detalhe informativo; falhar aqui não pode derrubar a
        // listagem inteira de workflows.
        return file;
      }
    }),
  );

/**
 * Antes de publicar, regrava os workflows gerados pelo painel que estão numa
 * versão antiga do template. Sem isto, uma correção no template só chegava ao
 * repositório quando alguém lembrava de salvar a configuração de novo — e o
 * botão de publicar seguia rodando o workflow velho (eixo-express: a correção
 * do build estático estava no painel, e a publicação falhou igual).
 *
 * Só toca no que traz o marcador do painel; o gatilho automático é mantido
 * como está. Os secrets não mudam.
 *
 * @returns {Promise<string[]>} caminhos regravados
 */
export const refreshOutdatedWorkflows = async ({ owner, repo, branch }, deps = {}) => {
  const {
    read = (path) => getWorkflowFileContent(githubConfig(), { owner, repo, path, branch }),
    write = (file) =>
      createOrUpdateFile({ config: githubConfig(), owner, repo, branch, ...file }),
  } = deps;

  let deploy;
  try {
    deploy = await read(`.github/workflows/${DEPLOY_WORKFLOW_FILE}`);
  } catch (error) {
    // Sem o workflow de deploy, o disparo a seguir já explica o que falta.
    if (error instanceof GitHubRequestError && error.status === 404) return [];
    throw error;
  }
  const versao = readTemplateVersion(deploy);
  if (!versao || versao === WORKFLOW_TEMPLATE_VERSION) return [];

  const regravados = [];
  // O de deploy primeiro: com o gatilho automático, o commit do de build
  // também dispara uma publicação, e ela precisa achar o deploy já novo.
  const arquivos = buildWorkflowFiles({ branch, autoDeploy: readAutoDeploy(deploy) }).sort(
    (a, b) => Number(b.path.endsWith(DEPLOY_WORKFLOW_FILE)) - Number(a.path.endsWith(DEPLOY_WORKFLOW_FILE)),
  );
  for (const arquivo of arquivos) {
    // O de build pode ter sido removido de propósito: não volta sozinho.
    if (!arquivo.path.endsWith(DEPLOY_WORKFLOW_FILE)) {
      const existe = await read(arquivo.path).then(
        () => true,
        (error) => {
          if (error instanceof GitHubRequestError && error.status === 404) return false;
          throw error;
        },
      );
      if (!existe) continue;
    }
    const { action } = await write({
      path: arquivo.path,
      content: arquivo.content,
      message: `Atualizar workflow do painel (versao ${WORKFLOW_TEMPLATE_VERSION})`,
    });
    if (action !== "unchanged") regravados.push(arquivo.path);
  }
  console.log(
    `[deploy] ${owner}/${repo}: workflows da versao ${versao} atualizados para ${WORKFLOW_TEMPLATE_VERSION}.`,
  );
  return regravados;
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Repositórios configurados por uma versão anterior do painel têm um workflow
 * sem o input dry_run. Ignorar o erro rodaria uma publicação real no lugar da
 * simulação pedida, então é melhor avisar.
 */
const isUnexpectedInputError = (error) =>
  error instanceof GitHubRequestError &&
  error.status === 422 &&
  /unexpected inputs/i.test(error.message);

/**
 * O GitHub leva alguns segundos para registrar um workflow recém-commitado;
 * até lá o endpoint de dispatch responde 404.
 */
export const dispatchWithRetry = async (params) => {
  const delays = [0, 1500, 3000, 5000];
  let lastError;

  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      await dispatchWorkflow({ config: githubConfig(), ...params });
      return;
    } catch (error) {
      lastError = error;
      if (isUnexpectedInputError(error)) {
        throw new HttpError(
          409,
          'O workflow deste repositório ainda não aceita simulação. Use "Salvar configuração" para atualizá-lo e tente novamente.',
        );
      }
      if (!(error instanceof GitHubRequestError) || error.status !== 404) throw error;
    }
  }

  console.error("[deploy] dispatch falhou após novas tentativas:", lastError);
  throw new HttpError(
    404,
    `O workflow ${params.workflowFile} ainda não está disponível no GitHub. Configure a publicação e tente novamente em alguns segundos.`,
  );
};

export const deleteWorkflows = async ({ owner, repo, branch, files }) => {
  const removed = [];
  const failed = [];

  for (const file of files) {
    try {
      await deleteFile({
        config: githubConfig(),
        owner,
        repo,
        path: file.path,
        sha: file.sha,
        message: `Remover workflow ${file.name}`,
        branch,
      });
      removed.push(file.path);
    } catch (error) {
      failed.push({
        path: file.path,
        message:
          error instanceof Error ? error.message : "Falha ao remover workflow.",
      });
    }
  }

  return {
    removed,
    failed,
    status:
      failed.length === 0 ? "success" : removed.length > 0 ? "partial" : "failed",
  };
};
