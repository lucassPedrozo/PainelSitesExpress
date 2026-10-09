import { randomBytes } from "node:crypto";
import { httpError } from "../http.js";
import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Projetos criados no painel
 *
 * Até aqui projeto era sinônimo de pasta no Drive: a coleta de material do
 * cliente. Um site feito fora desse caminho — desenvolvido inteiro com o
 * Claude, por exemplo — não tem pasta no Drive nem repositório no GitHub, e
 * ficava sem lugar no painel. Estes projetos nascem aqui: o registro mora no
 * banco, os arquivos em disco (`local/storage.js`), e o resto — tags,
 * apelido, site, publicação — usa as mesmas tabelas das coletas, pelo id.
 * ------------------------------------------------------------------ */

const MAX_NAME_LENGTH = 120;

/** O formato do id: nunca é confundido com um id do Drive já registrado. */
const LOCAL_ID = /^painel-[0-9a-f]{16}$/;

export const isLocalProjectId = (id) => typeof id === "string" && LOCAL_ID.test(id);

/**
 * Para que o projeto serve — só muda a fila "Fazer agora": `site` espera o
 * envio ao GitHub; `files` é um arquivo de material e não cobra passo nenhum.
 */
export const LOCAL_PROJECT_KINDS = /** @type {const} */ (["site", "files"]);

export async function listLocalProjects() {
  const { localProjects } = await read();
  return localProjects;
}

export async function getLocalProject(id) {
  if (!isLocalProjectId(id)) return null;
  return (await listLocalProjects()).find((project) => project.id === id) ?? null;
}

/** O projeto, ou 404 — o mesmo que a API responde a um id do Drive fora da raiz. */
export async function requireLocalProject(id) {
  const project = await getLocalProject(id);
  if (!project) throw httpError(404, "Projeto não encontrado.");
  return project;
}

/**
 * @param {{ name: unknown, kind?: unknown, by?: string | null }} input
 */
export async function createLocalProject({ name, kind = "site", by = null }) {
  const label = typeof name === "string" ? name.trim() : "";
  if (!label) throw httpError(400, "Dê um nome ao projeto — de preferência o domínio do site.");
  if (label.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Nome muito longo (máx. ${MAX_NAME_LENGTH})`);
  }
  if (!LOCAL_PROJECT_KINDS.includes(/** @type {any} */ (kind))) {
    throw httpError(400, "Tipo de projeto inválido.");
  }

  const data = await read();
  const project = {
    id: `painel-${randomBytes(8).toString("hex")}`,
    name: label,
    kind,
    createdAt: new Date().toISOString(),
    createdBy: by,
  };
  data.localProjects.push(project);
  await flush();
  return project;
}

/**
 * Tira o projeto do painel, com o que era só dele: tags, apelido e o registro
 * dos sites. O repositório no GitHub e o histórico de publicação do domínio
 * continuam — esses são do site, não do projeto.
 */
export async function deleteLocalProject(id) {
  const data = await read();
  const before = data.localProjects.length;
  data.localProjects = data.localProjects.filter((project) => project.id !== id);
  if (data.localProjects.length === before) throw httpError(404, "Projeto não encontrado.");

  delete data.projectTags[id];
  delete data.names[id];
  delete data.generations[id];
  // A pasta de trabalho do motor Claude fica em disco; o registro dela, não.
  delete data.claude.projects[id];
  await flush();
}
