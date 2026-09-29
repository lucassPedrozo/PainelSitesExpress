import { randomBytes } from "node:crypto";
import { runtimeConfig } from "../config.js";
import { httpError } from "../http.js";
import { callTool } from "./mcp.js";
import { readProject } from "./progress.js";

/* ------------------------------------------------------------------ *
 * Site existente, vinculado a um projeto do Drive
 *
 * Tudo o que o painel faz com um site — área de aprovação, link do cliente,
 * entrega, publicação no domínio — pende de um registro de geração, e esse
 * registro só nascia do "Gerar". Um site feito no Lovable à mão, ou fora do
 * Lovable, ficava sem caminho nenhum. Vincular cria o mesmo registro.
 * ------------------------------------------------------------------ */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Prefixo dos sites que não vieram do Lovable: nunca são consultados lá. */
export const EXTERNAL_PREFIX = "ext-";

/** Site sem projeto no Lovable — o id foi criado pelo painel. */
export const isExternalSite = (generation) =>
  typeof generation?.id === "string" && generation.id.startsWith(EXTERNAL_PREFIX);

/**
 * O id do projeto a partir do que a pessoa colou: o endereço do editor
 * (`lovable.dev/projects/<id>`), o de preview (`id-preview--<id>.lovable.app`)
 * ou o próprio id. `null` quando não há id do Lovable no texto.
 *
 * @param {unknown} raw
 */
export function parseLovableProject(raw) {
  const texto = typeof raw === "string" ? raw.trim() : "";
  if (!texto) return null;
  const achado = texto.match(UUID);
  if (!achado) return null;
  // Só aceita endereço do próprio Lovable — um UUID qualquer num link de
  // outro site não é projeto.
  if (/^https?:\/\//i.test(texto)) {
    let host = "";
    try {
      host = new URL(texto).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (host !== "lovable.dev" && !host.endsWith(".lovable.dev") && !host.endsWith(".lovable.app")) {
      return null;
    }
  }
  return achado[0].toLowerCase();
}

/**
 * `organização/nome`, dentro da organização configurada. `null` quando vazio.
 *
 * @param {unknown} raw
 */
export function parseRepository(raw) {
  const texto = typeof raw === "string" ? raw.trim() : "";
  if (!texto) return null;
  const [owner, name, ...resto] = texto.split("/");
  if (!owner || !name || resto.length || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) {
    throw httpError(400, "Repositório inválido — use organização/nome.");
  }
  const organizacao = runtimeConfig().organization;
  if (organizacao && owner.toLowerCase() !== organizacao.toLowerCase()) {
    throw httpError(
      400,
      `O repositório precisa ser da organização ${organizacao}. Transfira-o para lá no GitHub, ou conecte o projeto do Lovable ao GitHub da organização.`,
    );
  }
  return `${owner}/${name}`;
}

/** Estados que dá para declarar ao vincular. */
export const LINK_STATES = /** @type {const} */ (["ready", "delivered", "live"]);

/**
 * Confere o pedido de vínculo e diz o que gravar.
 *
 * @param {{ lovable?: unknown, repoFullName?: unknown, state?: unknown }} body
 * @param {Set<string>} [orgRepos] repositórios da organização, em minúsculas
 */
export function planLink(body, orgRepos) {
  const lovableId = parseLovableProject(body?.lovable);
  if (typeof body?.lovable === "string" && body.lovable.trim() && !lovableId) {
    throw httpError(400, "Esse endereço não é de um projeto do Lovable. Cole o link do editor (lovable.dev/projects/…).");
  }
  const repoFullName = parseRepository(body?.repoFullName);
  if (!lovableId && !repoFullName) {
    throw httpError(400, "Informe o projeto no Lovable, o repositório do GitHub, ou os dois.");
  }
  if (repoFullName && orgRepos && !orgRepos.has(repoFullName.toLowerCase())) {
    throw httpError(404, `O repositório ${repoFullName} não foi encontrado na organização (ou o token não o enxerga).`);
  }
  const state = body?.state ?? "ready";
  if (!LINK_STATES.includes(/** @type {any} */ (state))) {
    throw httpError(400, "Estado inválido.");
  }
  if (state === "live" && !repoFullName) {
    throw httpError(400, "Para marcar como no ar, informe o repositório que publica no domínio.");
  }
  return {
    id: lovableId ?? `${EXTERNAL_PREFIX}${randomBytes(6).toString("hex")}`,
    url: lovableId ? `https://lovable.dev/projects/${lovableId}` : null,
    lovableId,
    repoFullName,
    state: /** @type {"ready" | "delivered" | "live"} */ (state),
  };
}

/**
 * O nome do projeto no Lovable — é com ele que o repositório nasce no GitHub,
 * e é por ele que a área de aprovação acha o repositório sozinha. Sem conexão
 * com o Lovable (ou projeto de outra conta), segue sem nome.
 *
 * @param {string} lovableId
 */
export async function lovableNameOf(lovableId) {
  try {
    const { name } = readProject(await callTool("get_project", { project_id: lovableId }));
    return name;
  } catch (err) {
    console.warn(`[vincular] nome do projeto ${lovableId} no Lovable: ${err?.message ?? err}`);
    return null;
  }
}
