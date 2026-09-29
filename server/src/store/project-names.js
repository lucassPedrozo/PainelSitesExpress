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

/** Texto vazio apaga o apelido e devolve o nome da pasta do Drive. */
export async function setProjectName(projectId, name) {
  const data = await read();
  const label = String(name ?? "").trim();

  if (label.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Nome muito longo (máx. ${MAX_NAME_LENGTH})`);
  }

  if (label) data.names[projectId] = label;
  else delete data.names[projectId];

  await flush();
  return label || null;
}
