import { randomBytes } from "node:crypto";
import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Motor Claude
 *
 * O site gerado pelo Claude entra em `generations`, como qualquer outro, e
 * daí em diante segue o caminho de sempre (GitHub, área de aprovação, entrega,
 * domínio). Aqui fica o que é só do motor:
 *
 * - `projects`: por projeto do painel, a pasta de trabalho dele, o modelo e o
 *   esforço que ele escolheu para as execuções e um resumo do que há na pasta
 *   (briefing, site, última execução) — é o que o card mostra, sem o painel
 *   ter de perguntar ao motor a cada atualização da lista;
 * - `queue`: os pedidos que esperam ou estavam rodando, para o painel reabrir
 *   sabendo o que havia;
 * - `runs`: cada execução do `claude -p`, com sessão, duração, situação e o
 *   nome do arquivo do stream bruto.
 *
 * Os registros de execução e os itens da fila chegam do executor com os
 * campos dele, em português (`tipo`, `status`, `duracao_ms`…): é o formato que
 * o relatório do motor também lê, e não é traduzido aqui.
 * ------------------------------------------------------------------ */

/** As execuções mais recentes ficam; as demais saem, com o stream delas. */
export const MAX_RUNS = 300;

const FOLDER_BASE_LENGTH = 32;

/**
 * O nome da pasta de trabalho: o nome do projeto, limpo, mais um sufixo
 * sorteado. É o painel que o escolhe, nunca o modelo — ele vira caminho em
 * disco, parte do pedido digitado ao claude e, depois, o nome do site.
 *
 * @param {string} base
 * @param {Set<string>} taken
 */
export function newFolderName(base, taken) {
  const limpo =
    String(base ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, FOLDER_BASE_LENGTH)
      .replace(/-+$/, "") || "site";
  for (;;) {
    const folder = `${limpo}-${randomBytes(2).toString("hex")}`;
    if (!taken.has(folder)) return folder;
  }
}

/** @returns {Promise<Record<string, any>>} */
export async function listClaudeProjects() {
  return (await read()).claude.projects;
}

/** @param {string} projectId */
export async function getClaudeProject(projectId) {
  return (await listClaudeProjects())[projectId] ?? null;
}

/**
 * O registro do projeto no motor, criado na primeira vez — com a pasta de
 * trabalho dele.
 *
 * @param {string} projectId
 * @param {{ name: string, by?: string | null }} input
 */
export async function ensureClaudeProject(projectId, { name, by = null }) {
  const data = await read();
  const existente = data.claude.projects[projectId];
  if (existente) return existente;

  const taken = new Set(Object.values(data.claude.projects).map((item) => item.folder));
  const entry = {
    folder: newFolderName(name, taken),
    createdAt: new Date().toISOString(),
    createdBy: by,
    /** A última cópia do material do projeto para a pasta de trabalho. */
    material: null,
    /** `{ state: "ok" | "refused" | "missing", errors, warnings, checkedAt }` */
    briefing: null,
    /**
     * O modelo e o esforço das execuções deste projeto. `null` em cada um é
     * "o das Configurações" — e, sem nada lá, o que o motor espera.
     */
    options: { modelo: null, esforco: null },
    /** O projeto do motor — o site. Nasce durante a geração. */
    slug: null,
    /** `{ awaitingApproval, openStage, delivered, situation, phase, round, rounds, next, checkedAt }` */
    site: null,
    /** `{ id, type, status, message, at, durationMs }` */
    lastRun: null,
  };
  data.claude.projects[projectId] = entry;
  await flush();
  return entry;
}

/**
 * @param {string} projectId
 * @param {Record<string, unknown>} patch
 */
export async function patchClaudeProject(projectId, patch) {
  const data = await read();
  const entry = data.claude.projects[projectId];
  if (!entry) return null;
  Object.assign(entry, patch);
  await flush();
  return entry;
}

/** @param {string} projectId */
export async function forgetClaudeProject(projectId) {
  const data = await read();
  if (!data.claude.projects[projectId]) return false;
  delete data.claude.projects[projectId];
  await flush();
  return true;
}

/* ------------------------------------------------------------------ *
 * Fila
 * ------------------------------------------------------------------ */

/** @returns {Promise<any[]>} */
export async function loadClaudeQueue() {
  return structuredClone((await read()).claude.queue);
}

/** @param {any[]} items */
export async function saveClaudeQueue(items) {
  const data = await read();
  data.claude.queue = structuredClone(items);
  await flush();
}

/* ------------------------------------------------------------------ *
 * Execuções
 * ------------------------------------------------------------------ */

/**
 * Grava ou atualiza uma execução — ela é regravada várias vezes enquanto roda
 * (a sessão aparece, a etapa muda, termina).
 *
 * @param {Record<string, any>} run
 * @returns {Promise<string[]>} os arquivos de stream das execuções que saíram
 *   do registro por excesso, para quem chama apagá-los
 */
export async function recordClaudeRun(run) {
  const data = await read();
  const runs = data.claude.runs;
  const indice = runs.findIndex((item) => item.id === run.id);
  if (indice >= 0) runs[indice] = { ...run };
  else runs.push({ ...run });

  /** @type {string[]} */
  const descartados = [];
  while (runs.length > MAX_RUNS) {
    // Só sai o que já terminou: uma execução em andamento nunca perde o registro.
    const velha = runs.findIndex((item) => item.status !== "rodando");
    if (velha < 0) break;
    const [fora] = runs.splice(velha, 1);
    if (typeof fora.log === "string") descartados.push(fora.log);
  }
  await flush();
  return descartados;
}

/**
 * @param {{ projectId?: string }} [filter]
 * @returns {Promise<Array<Record<string, any>>>} da mais recente para a mais antiga
 */
export async function listClaudeRuns({ projectId } = {}) {
  const { runs } = (await read()).claude;
  return runs
    .filter((run) => !projectId || run.projectId === projectId)
    .map((run) => ({ ...run }))
    .reverse();
}

/** @param {string} id */
export async function getClaudeRun(id) {
  const { runs } = (await read()).claude;
  const achada = runs.find((run) => run.id === id);
  return achada ? { ...achada } : null;
}

/**
 * Na subida do painel: o que ficou marcado como rodando não está mais — o
 * processo que cuidava dela morreu junto com o painel anterior. Vira
 * interrompida, para a pessoa decidir entre retomar e descartar.
 *
 * @param {(run: Record<string, any>) => boolean} [alive] a execução ainda é
 *   de um processo vivo? (outro painel aberto na mesma pasta de dados)
 * @returns {Promise<number>} quantas mudaram
 */
export async function interruptRunningClaudeRuns(alive = () => false) {
  const data = await read();
  let mudaram = 0;
  for (const run of data.claude.runs) {
    if (run.status !== "rodando" || alive(run)) continue;
    run.status = "interrompida";
    run.mensagem = "O painel foi encerrado no meio desta execução.";
    delete run.pid;
    mudaram += 1;
  }
  if (mudaram) await flush();
  return mudaram;
}
