import { callTool } from "./mcp.js";

/**
 * O bloco "Já usado" da Workspace Knowledge: a paleta, a tipografia, o hero e
 * o elemento memorável dos últimos sites, para o próximo não repetir.
 *
 * A skill `novo-site` termina cada site com a linha "Já usado: …", mas ninguém
 * a copiava para a Knowledge — o bloco ficava vazio e a regra de não repetir
 * nunca valia. O painel lê a linha quando o agente termina e mantém o bloco.
 * Só mexe entre os marcadores; o resto da Knowledge não é tocado.
 */

const START = "<!-- ja-usado:inicio -->";
const END = "<!-- ja-usado:fim -->";

/** Limite do Lovable para a Workspace Knowledge. */
export const KNOWLEDGE_LIMIT = 10_000;
export const MAX_ENTRIES = 5;

const decodeEntities = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * A última linha "Já usado: …" da resposta do agente, sem crases e sem o
 * prefixo, ou `null`. A resposta vem com as marcações das ferramentas do
 * Lovable; a linha é procurada no texto inteiro.
 *
 * @param {string | null | undefined} text
 */
export function extractStyleLine(text) {
  if (typeof text !== "string") return null;
  // Aspas e barra também encerram: a linha pode vir dentro do JSON de uma
  // ferramenta do Lovable (`...três metros\"}">`), e sem isso o fim do JSON
  // entrava na Knowledge junto com o registro.
  const matches = [...decodeEntities(text).matchAll(/J[áa] usado:\s*([^\n`<"\\]+)/gi)];
  const last = matches.at(-1)?.[1]?.trim();
  // O modelo do formato, repetido pelo agente, não é registro.
  if (!last || last.startsWith("<cliente>")) return null;
  return last.slice(0, 200);
}

/**
 * A Knowledge com a entrada nova no topo do bloco. Mantém as últimas
 * `MAX_ENTRIES` e descarta as mais antigas até caber no limite do Lovable.
 * Devolve `null` quando os marcadores não existem ou nem uma entrada cabe.
 *
 * @param {string} knowledge
 * @param {string} entry
 */
export function insertStyleEntry(knowledge, entry) {
  const start = knowledge.indexOf(START);
  const end = knowledge.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;

  const current = knowledge
    .slice(start + START.length, end)
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);

  const entries = [entry, ...current.filter((line) => line !== entry)].slice(
    0,
    MAX_ENTRIES,
  );

  const build = (list) =>
    knowledge.slice(0, start + START.length) +
    "\n" +
    list.map((line) => `- ${line}\n`).join("") +
    knowledge.slice(end);

  while (entries.length > 0) {
    const next = build(entries);
    if (next.length <= KNOWLEDGE_LIMIT) return next;
    entries.pop();
  }
  return null;
}

/**
 * Lê a Knowledge do workspace, insere a entrada e grava. Precisa do escopo
 * `workspaces:write` na conexão com o Lovable.
 *
 * @returns {Promise<boolean>} se a Knowledge foi atualizada
 */
export async function registerStyle(workspaceId, entry) {
  const current = await callTool("get_workspace_knowledge", {
    workspace_id: workspaceId,
  });
  const content = typeof current?.content === "string" ? current.content : "";
  const next = insertStyleEntry(content, entry);
  if (!next) return false;

  await callTool("set_workspace_knowledge", {
    workspace_id: workspaceId,
    content: next,
  });
  return true;
}
