import {
  getAllPages,
  getGitHubBaseUrl,
  getJson,
  GitHubRequestError,
  requestNoContent,
  requestRaw,
} from "./client.js";

/* Repositórios da organização e as execuções do GitHub Actions. */

export const listRepos = async (config, options) => {
  const { organization } = options;
  if (!organization) throw new Error("Organização do GitHub não informada.");
  const perPage = String(Math.min(options.perPage ?? 100, 100));

  const orgParams = new URLSearchParams({
    type: options.visibility ?? "all",
    per_page: perPage,
    sort: "pushed",
    direction: "desc",
  });
  const orgUrl = `${getGitHubBaseUrl(config)}/orgs/${organization}/repos?${orgParams.toString()}`;

  // O endpoint da organização é a fonte preferencial; tokens fine-grained
  // limitados a repositórios específicos recebem 403/404 e caem no /user/repos.
  try {
    const orgRepos = await getAllPages(orgUrl, config);
    if (orgRepos.length > 0) return orgRepos;
  } catch (error) {
    if (
      !(error instanceof GitHubRequestError) ||
      ![401, 403, 404].includes(error.status)
    ) {
      throw error;
    }
  }

  const userParams = new URLSearchParams({
    per_page: perPage,
    sort: "pushed",
    direction: "desc",
    visibility: options.visibility ?? "all",
    affiliation: "organization_member,collaborator,owner",
  });
  const userUrl = `${getGitHubBaseUrl(config)}/user/repos?${userParams.toString()}`;

  try {
    const userRepos = await getAllPages(userUrl, config);
    return userRepos.filter((repo) =>
      repo.full_name.toLowerCase().startsWith(`${organization.toLowerCase()}/`),
    );
  } catch (error) {
    if (
      error instanceof GitHubRequestError &&
      [401, 403, 404].includes(error.status)
    ) {
      return [];
    }
    throw error;
  }
};

export const listWorkflowRuns = async (config, params) => {
  const search = new URLSearchParams({ per_page: String(params.perPage ?? 10) });

  if (params.status) search.set("status", params.status);
  if (params.branch) search.set("branch", params.branch);

  const base = `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/actions`;
  const url = params.workflowFile
    ? `${base}/workflows/${encodeURIComponent(params.workflowFile)}/runs?${search.toString()}`
    : `${base}/runs?${search.toString()}`;

  try {
    const response = await getJson(url, config);
    return response?.workflow_runs ?? [];
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return [];
    throw error;
  }
};

export const dispatchWorkflow = async (params) => {
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/actions/workflows/${encodeURIComponent(params.workflowFile)}/dispatches`;

  await requestNoContent(url, params.config, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: params.ref,
      ...(params.inputs ? { inputs: params.inputs } : {}),
    }),
  });
};

/**
 * O log em texto do primeiro job que falhou numa execução — é onde está o
 * motivo, que a listagem de execuções não traz. `null` sem job com falha.
 */
export const getFailedJobLog = async (config, params) => {
  const base = `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/actions`;
  const response = await getJson(`${base}/runs/${params.runId}/jobs?per_page=20`, config);
  const job = (response?.jobs ?? []).find((item) => item.conclusion === "failure");
  if (!job) return null;
  // O GitHub responde com um redirecionamento para o armazenamento do log;
  // o fetch o segue sem levar o token para o outro domínio.
  const log = await requestRaw(`${base}/jobs/${job.id}/logs`, config, { method: "GET" });
  return log.text();
};

/** Passos que o runner acrescenta sozinho: não são andamento do deploy. */
const RUNNER_STEP = /^(Set up job|Complete job|Post )/;

/**
 * Em que passo está uma execução em andamento — é o que diz se falta pouco.
 * `null` enquanto o job não começou.
 *
 * @returns {Promise<{ total: number, done: number, current: string | null } | null>}
 */
export const getRunProgress = async (config, params) => {
  const base = `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/actions`;
  const response = await getJson(`${base}/runs/${params.runId}/jobs?per_page=20`, config);
  const job = (response?.jobs ?? [])[0];
  if (!job?.steps?.length) return null;
  const passos = job.steps.filter((step) => !RUNNER_STEP.test(step.name ?? ""));
  if (!passos.length) return null;
  const atual = passos.find((step) => step.status === "in_progress");
  return {
    total: passos.length,
    done: passos.filter((step) => step.status === "completed").length,
    current: atual?.name ?? null,
  };
};
