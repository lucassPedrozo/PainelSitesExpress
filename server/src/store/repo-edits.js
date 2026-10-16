import { randomBytes } from "node:crypto";
import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Ajustes pelo Claude em sites de repositório
 *
 * A memória dos ajustes pedidos ao Claude num site que mora num repositório
 * do GitHub (feito no Lovable, ou vinculado de fora): o que foi pedido, por
 * quem, a versão de onde o ajuste partiu (e quem tinha feito a última
 * alteração antes dele), o commit que ele gerou e o que o Claude disse ter
 * feito. É o que a aba "Ajustes" do projeto mostra, e o que o próximo pedido
 * leva ao Claude como contexto.
 *
 * Fica em `repoEdits[projectId]`, do mais antigo para o mais recente.
 * ------------------------------------------------------------------ */

/** Quantos ajustes cada projeto guarda; os mais antigos saem. */
const MAX_EDITS_PER_PROJECT = 200;

/**
 * @typedef {"queued" | "running" | "pushed" | "unchanged" | "failed" | "conflict" | "cancelled" | "interrupted"} EditStatus
 *   `pushed`: o ajuste virou commit no GitHub. `unchanged`: o Claude terminou
 *   sem mudar arquivo nenhum. `conflict`: o repositório mudou durante o
 *   ajuste e as alterações não se juntam sozinhas.
 * @typedef {{ sha: string, origin: "lovable" | "claude" | "person" | "panel", author: string,
 *   message: string, at: string }} EditCommit
 * @typedef {{
 *   id: string, projectId: string, repo: string, branch: string | null,
 *   request: string, attachments: string[], by: string | null, createdAt: string,
 *   status: EditStatus, itemId: string | null, runId: string | null,
 *   startedAt: string | null, finishedAt: string | null, durationMs: number | null,
 *   model: string | null, effort: string | null,
 *   base: EditCommit | null, commit: (EditCommit & { url: string, files: string[] }) | null,
 *   summary: string | null, error: string | null,
 * }} RepoEdit
 */

const agora = () => new Date().toISOString();

/**
 * @param {string} projectId
 * @returns {Promise<RepoEdit[]>} do mais recente para o mais antigo
 */
export async function listRepoEdits(projectId) {
  const data = await read();
  return structuredClone([...(data.repoEdits[projectId] ?? [])].reverse());
}

/** @param {string} projectId @param {string} editId */
export async function getRepoEdit(projectId, editId) {
  const data = await read();
  const edit = (data.repoEdits[projectId] ?? []).find((item) => item.id === editId);
  return edit ? structuredClone(edit) : null;
}

/**
 * Registra um pedido de ajuste que acabou de entrar na fila.
 * @param {{ projectId: string, repo: string, request: string, attachments?: string[], by?: string | null }} input
 * @returns {Promise<RepoEdit>}
 */
export async function createRepoEdit({ projectId, repo, request, attachments = [], by = null }) {
  const data = await read();
  /** @type {RepoEdit} */
  const edit = {
    id: `aj-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    projectId,
    repo,
    branch: null,
    request,
    attachments,
    by,
    createdAt: agora(),
    status: "queued",
    itemId: null,
    runId: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    model: null,
    effort: null,
    base: null,
    commit: null,
    summary: null,
    error: null,
  };
  const lista = (data.repoEdits[projectId] ??= []);
  lista.push(edit);
  // Sai o mais antigo que já terminou: um ajuste na fila ou rodando nunca perde o registro.
  while (lista.length > MAX_EDITS_PER_PROJECT) {
    const velho = lista.findIndex((item) => item.status !== "queued" && item.status !== "running");
    if (velho < 0) break;
    lista.splice(velho, 1);
  }
  await flush();
  return structuredClone(edit);
}

/**
 * @param {string} projectId
 * @param {string} editId
 * @param {Partial<RepoEdit>} patch
 * @returns {Promise<RepoEdit | null>}
 */
export async function patchRepoEdit(projectId, editId, patch) {
  const data = await read();
  const edit = (data.repoEdits[projectId] ?? []).find((item) => item.id === editId);
  if (!edit) return null;
  Object.assign(edit, patch);
  await flush();
  return structuredClone(edit);
}

/** Tira um pedido que não chegou a entrar na fila (a fila recusou). */
export async function deleteRepoEdit(projectId, editId) {
  const data = await read();
  const lista = data.repoEdits[projectId] ?? [];
  const indice = lista.findIndex((item) => item.id === editId);
  if (indice < 0) return false;
  lista.splice(indice, 1);
  await flush();
  return true;
}

/**
 * Na subida do painel: o que estava rodando quando ele caiu vira interrompido.
 * O que esperava na fila continua esperando (a fila volta pausada).
 */
export async function interruptRunningRepoEdits() {
  const data = await read();
  let mudou = false;
  for (const lista of Object.values(data.repoEdits)) {
    for (const edit of lista) {
      if (edit.status === "running") {
        edit.status = "interrupted";
        edit.finishedAt = agora();
        edit.error = "O painel foi reiniciado no meio do ajuste. Nada foi enviado ao GitHub.";
        mudou = true;
      }
    }
  }
  if (mudou) await flush();
  return mudou;
}
