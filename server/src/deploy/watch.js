import { runtimeConfig } from "../config.js";
import {
  getPublication,
  listPublications,
  setPublicationRuns,
} from "../store/publications.js";
import { getRunProgress, listWorkflowRuns } from "./github/repositories.js";
import { githubConfig } from "./operations.js";
import { DEPLOY_WORKFLOW_FILE } from "./workflow-template.js";

/**
 * Acompanha as execuções do workflow de deploy.
 *
 * O disparo só diz que o GitHub aceitou o pedido; o build e o envio por FTP
 * vêm depois, e podem falhar. E o disparo pelo painel não é o único caminho:
 * cada edição no Lovable faz push, e o push publica sozinho. Então o estado
 * vem das execuções, de qualquer origem — antes o painel marcava "No ar" no
 * disparo, e um site com os quatro disparos falhos, publicado por um push
 * logo depois, aparecia igual a um que nunca foi ao ar.
 */

/** Enquanto publica, confere a cada 15 s. */
const POLL_MS = 15_000;
/** Fora disso, uma passada a cada 10 min pega os pushes vindos do Lovable. */
const SWEEP_MS = 10 * 60_000;
/** Um deploy leva de 1 a 5 minutos; passado isto, algo travou. */
const GIVE_UP_MS = 45 * 60_000;
/** Folga entre o relógio do painel e o do GitHub. */
const CLOCK_SKEW_MS = 60_000;

/**
 * @typedef {{ event?: string, created_at?: string, updated_at?: string,
 *   status?: string, conclusion?: string | null, html_url?: string }} WorkflowRun
 * @typedef {{ total: number, done: number, current: string | null }} RunProgress
 * @typedef {{ at: string, status: string, runUrl: string | null, event?: string | null,
 *   progress?: RunProgress | null }} RunState
 */

/** @param {string | undefined} value */
const time = (value) => Date.parse(value ?? "") || 0;

/**
 * A execução criada por um disparo: a primeira `workflow_dispatch` que nasceu
 * depois dele.
 *
 * @template {WorkflowRun} T
 * @param {T[]} runs
 * @param {string} at momento do disparo (ISO)
 * @returns {T | null}
 */
export function findRunForDispatch(runs, at) {
  const desde = time(at) - CLOCK_SKEW_MS;
  return (
    runs
      .filter((run) => run.event === "workflow_dispatch" && time(run.created_at) >= desde)
      .sort((a, b) => time(a.created_at) - time(b.created_at))[0] ?? null
  );
}

/**
 * `null` enquanto a execução não terminou.
 *
 * @param {WorkflowRun} run
 */
export function outcomeOf(run) {
  if (run.status !== "completed") return null;
  return run.conclusion === "success" ? "success" : "failure";
}

/**
 * O estado da publicação a partir das execuções do GitHub.
 *
 * - Execuções canceladas saem: são as que a concorrência do workflow
 *   atropelou quando vários pushes chegam juntos, e a que venceu vem logo
 *   depois.
 * - Simulações (dry-run) saem: não publicam nada.
 * - Um disparo recém-feito cuja execução ainda não apareceu continua
 *   "publicando" — até desistir.
 *
 * @param {WorkflowRun[]} runs
 * @param {{ dryRunDispatches?: string[], current?: RunState | null, now: number }} context
 * @returns {{ lastRun: RunState | null, lastSuccessAt: string | null }}
 */
export function summarizeRuns(runs, { dryRunDispatches = [], current = null, now }) {
  const simulacoes = new Set(
    dryRunDispatches.map((at) => findRunForDispatch(runs, at)).filter(Boolean),
  );
  const validas = runs
    .filter((run) => run.conclusion !== "cancelled" && !simulacoes.has(run))
    .sort((a, b) => time(b.created_at) - time(a.created_at));

  const ultima = validas[0];
  const sucesso = validas.find((run) => outcomeOf(run) === "success");
  const lastSuccessAt = sucesso?.created_at ?? null;

  const aguardandoDisparo =
    current?.status === "pending" &&
    !current.runUrl &&
    (!ultima || time(ultima.created_at) < time(current.at) - CLOCK_SKEW_MS);
  if (current && aguardandoDisparo) {
    const lastRun =
      now - time(current.at) > GIVE_UP_MS ? { ...current, status: "unknown" } : current;
    return { lastRun, lastSuccessAt };
  }

  if (!ultima) return { lastRun: current ?? null, lastSuccessAt };
  return {
    lastRun: {
      at: ultima.created_at ?? new Date(now).toISOString(),
      status: outcomeOf(ultima) ?? "pending",
      runUrl: ultima.html_url ?? null,
      event: ultima.event ?? null,
    },
    lastSuccessAt,
  };
}

/**
 * @typedef {{ repoFullName: string, branch?: string | null,
 *   lastRun?: RunState | null, deploys?: Array<{ at: string, dryRun?: boolean }> }} PublicationLike
 * @typedef {{ listRuns?: (publication: PublicationLike) => Promise<WorkflowRun[]>,
 *   record?: (repoFullName: string, state: { lastRun: RunState | null, lastSuccessAt: string | null }) => Promise<unknown>,
 *   now?: () => number,
 *   progressOf?: (publication: PublicationLike, runUrl: string) => Promise<RunProgress | null> }} SyncDeps
 */

/**
 * Relê as execuções de uma publicação e grava o estado.
 *
 * @param {PublicationLike} publication
 * @param {SyncDeps} [deps]
 */
export async function syncPublication(publication, deps = {}) {
  const {
    listRuns = listRunsFromGitHub,
    record = setPublicationRuns,
    now = Date.now,
    progressOf = progressFromGitHub,
  } = deps;
  const runs = await listRuns(publication);
  const estado = summarizeRuns(runs, {
    dryRunDispatches: (publication.deploys ?? [])
      .filter((item) => item.dryRun)
      .map((item) => item.at),
    current: publication.lastRun ?? null,
    now: now(),
  });
  // Em andamento, o passo em que o deploy está — "publicando" sozinho não
  // dizia se faltava um minuto ou dez.
  if (estado.lastRun?.status === "pending" && estado.lastRun.runUrl) {
    estado.lastRun = {
      ...estado.lastRun,
      progress: await progressOf(publication, estado.lastRun.runUrl),
    };
  }
  await record(publication.repoFullName, estado);
  return estado;
}

/**
 * @param {PublicationLike} publication
 * @param {string} runUrl
 */
async function progressFromGitHub(publication, runUrl) {
  const runId = runUrl.match(/\/runs\/(\d+)/)?.[1];
  if (!runId) return null;
  const [owner, repo] = publication.repoFullName.split("/");
  try {
    return await getRunProgress(githubConfig(), { owner, repo, runId });
  } catch {
    return null;
  }
}

/** @param {PublicationLike} publication */
async function listRunsFromGitHub(publication) {
  const [owner, repo] = publication.repoFullName.split("/");
  return listWorkflowRuns(githubConfig(), {
    owner,
    repo,
    branch: publication.branch ?? undefined,
    workflowFile: DEPLOY_WORKFLOW_FILE,
    perPage: 20,
  });
}

const following = new Set();

/** Confere de perto enquanto a publicação estiver em andamento. */
export function followPublication(repoFullName) {
  if (following.has(repoFullName)) return;
  following.add(repoFullName);

  const seguir = async () => {
    const inicio = Date.now();
    for (;;) {
      const publicacao = await getPublication(repoFullName);
      if (!publicacao) return;
      const { lastRun } = await syncPublication(publicacao);
      if (lastRun?.status !== "pending" || Date.now() - inicio > GIVE_UP_MS) return;
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
  };

  void seguir()
    .catch((err) =>
      console.warn(`[deploy] não acompanhou ${repoFullName}:`, err?.message ?? err),
    )
    .finally(() => following.delete(repoFullName));
}

async function sweep() {
  if (!runtimeConfig().githubToken) return;
  for (const publicacao of await listPublications()) {
    try {
      const { lastRun } = await syncPublication(publicacao);
      if (lastRun?.status === "pending") followPublication(publicacao.repoFullName);
    } catch (err) {
      console.warn(
        `[deploy] não conferiu ${publicacao.repoFullName}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** Na subida da API: confere todas as publicações e segue conferindo. */
export function startDeployWatch() {
  void sweep();
  setInterval(() => void sweep(), SWEEP_MS).unref();
}
