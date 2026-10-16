import { httpError } from "../http.js";
import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Nome de exibição do projeto
 *
 * O acesso ao Drive é somente leitura e a service account é leitora da pasta,
 * então renomear de verdade exigiria escopo de escrita e trocar o
 * compartilhamento para Editor. O apelido vive aqui: quando o cliente não
 * informa o domínio no formulário, a pasta nasce sem nome útil e é o painel
 * que passa a chamá-la de alguma coisa. A pasta no Drive não é tocada.
 * ------------------------------------------------------------------ */

const MAX_NAME_LENGTH = 120;

export async function listProjectNames() {
  const { names } = await read();
  return names;
}

/** Confere o apelido sem gravar — para quem grava junto com outros campos. */
export function checkProjectName(name) {
  const label = String(name ?? "").trim();
  if (label.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Nome muito longo (máx. ${MAX_NAME_LENGTH})`);
  }
  return label;
}

/** Texto vazio apaga o apelido e devolve o nome da pasta do Drive. */
export async function setProjectName(projectId, name) {
  const label = checkProjectName(name);
  const data = await read();

  if (label) data.names[projectId] = label;
  else delete data.names[projectId];

  await flush();
  return label || null;
}
