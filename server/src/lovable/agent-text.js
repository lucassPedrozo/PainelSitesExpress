/**
 * O que o agente do Lovable disse ao usuário, tirado da mensagem crua.
 *
 * O `content` de uma mensagem do agente é o registro de trabalho inteiro:
 * pensamentos, comandos, leituras de arquivo — cada um numa marcação
 * `<lov-tool-use>`. A fala para o usuário é a ferramenta
 * `user_messaging--message_user`, com o texto no campo `message` do JSON em
 * `data`. Texto solto fora das marcações também é fala.
 */

/** Teto do que o painel guarda e mostra: é uma pergunta, não o registro. */
const MAX_CHARS = 1200;

const ENTITIES = { "&quot;": '"', "&apos;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" };

/** @param {string} value */
const decodeEntities = (value) =>
  value.replace(/&(quot|apos|amp|lt|gt);/g, (entity) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (entity)]);

/**
 * @param {unknown} content
 * @returns {string | null}
 */
export function extractAgentText(content) {
  if (typeof content !== "string" || !content.trim()) return null;

  const falas = [];
  const marcacao = /<lov-tool-use\b([^>]*)>[\s\S]*?<\/lov-tool-use>/g;
  for (const [, atributos] of content.matchAll(marcacao)) {
    if (!/name="user_messaging--message_user"/.test(atributos)) continue;
    const bruto = /data="((?:[^"\\]|\\.)*)"/.exec(atributos)?.[1];
    if (!bruto) continue;
    try {
      const dados = JSON.parse(decodeEntities(bruto.replace(/\\"/g, '"')));
      const texto = [dados.summary && !dados.message ? dados.summary : null, dados.message]
        .filter((item) => typeof item === "string" && item.trim())
        .join("\n");
      if (texto) falas.push(texto.trim());
    } catch {
      // Marcação num formato que não conhecemos: melhor ficar sem essa fala
      // do que mostrar JSON quebrado.
    }
  }

  const solto = decodeEntities(
    content.replace(marcacao, " ").replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (solto) falas.push(solto);

  const texto = falas.join("\n\n").trim();
  if (!texto) return null;
  return texto.length > MAX_CHARS ? `${texto.slice(0, MAX_CHARS - 1)}…` : texto;
}
