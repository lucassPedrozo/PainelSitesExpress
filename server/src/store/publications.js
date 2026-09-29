import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Histórico de publicação
 *
 * Responde "quais domínios estão no ar e desde quando" — que o painel só
 * sabia consultando o GitHub repositório por repositório.
 * ------------------------------------------------------------------ */

/** Guarda a configuração gravada num repositório. Uma entrada por repositório. */
export async function recordPublicationConfig(
  repoFullName,
  { domain, branch, settings, by },
) {
  const data = await read();
  const atual = data.publications[repoFullName] ?? { deploys: [] };

  data.publications[repoFullName] = {
    ...atual,
    repoFullName,
    domain: domain ?? atual.domain ?? null,
    branch: branch ?? atual.branch ?? null,
    // Servidor, login, pasta, protocolo, porta e o gatilho de push — a senha
    // e as variáveis de build ficam só no GitHub, como secret.
    settings: settings ?? atual.settings ?? null,
    configuredAt: new Date().toISOString(),
    configuredBy: by ?? null,
    deploys: atual.deploys ?? [],
  };

  await flush();
  return data.publications[repoFullName];
}

/** Últimos 20 disparos por repositório — o suficiente para auditar. */
const MAX_DEPLOYS = 20;

/**
 * Registra um disparo. Um envio real marca a publicação como "publicando" na
 * hora — a execução leva alguns segundos para aparecer no GitHub, e até lá o
 * card mostraria o estado anterior. O resultado vem de `setPublicationRuns`.
 */
export async function recordDeploy(repoFullName, { by, dryRun, branch, workflowFile }) {
  const data = await read();
  const atual = data.publications[repoFullName] ?? {
    repoFullName,
    domain: null,
    branch: branch ?? null,
    configuredAt: null,
    configuredBy: null,
    deploys: [],
  };

  const registro = {
    at: new Date().toISOString(),
    by: by ?? null,
    dryRun: Boolean(dryRun),
    workflowFile: workflowFile ?? null,
  };

  atual.deploys = [registro, ...(atual.deploys ?? [])].slice(0, MAX_DEPLOYS);
  if (!registro.dryRun) {
    atual.lastRun = {
      at: registro.at,
      status: "pending",
      runUrl: null,
      event: "workflow_dispatch",
    };
  }
  data.publications[repoFullName] = atual;

  await flush();
  return { publication: atual, deploy: registro };
}

/**
 * O estado da publicação segundo as execuções do workflow de deploy no
 * GitHub — de qualquer origem. Disparo pelo painel é só uma delas: cada
 * edição no Lovable faz push, e o push publica sozinho.
 *
 * `lastRun`: a execução mais recente. `lastSuccessAt`: a mais recente que
 * terminou bem — é ela que diz desde quando o site está no ar. `null` não
 * apaga o que se sabia: o sucesso pode ter ficado fora da janela consultada.
 *
 * @param {string} repoFullName
 * @param {{ lastRun?: { at: string, status: string, runUrl: string | null, event?: string | null } | null, lastSuccessAt?: string | null }} state
 */
export async function setPublicationRuns(repoFullName, { lastRun, lastSuccessAt }) {
  const data = await read();
  const atual = data.publications[repoFullName];
  if (!atual) return null;

  if (lastRun) atual.lastRun = lastRun;
  if (lastSuccessAt) atual.lastDeployAt = lastSuccessAt;

  await flush();
  return atual;
}

export async function getPublication(repoFullName) {
  const { publications } = await read();
  return publications[repoFullName] ?? null;
}

/**
 * A execução mais recente — é ela que diz se o projeto está publicando, se a
 * última tentativa falhou, ou nada a relatar.
 *
 * @param {{ lastRun?: { at: string, status: string, runUrl: string | null,
 *   progress?: { total: number, done: number, current: string | null } | null } | null }} publication
 */
export function lastAttemptOf(publication) {
  const run = publication.lastRun;
  if (!run) return null;
  return {
    at: run.at,
    status: run.status,
    runUrl: run.runUrl ?? null,
    // O passo em que o deploy está, enquanto publica.
    progress: run.status === "pending" ? (run.progress ?? null) : null,
  };
}

export async function listPublications() {
  const { publications } = await read();
  return Object.values(publications).sort((a, b) =>
    String(b.lastDeployAt ?? b.configuredAt ?? "").localeCompare(
      String(a.lastDeployAt ?? a.configuredAt ?? ""),
    ),
  );
}
