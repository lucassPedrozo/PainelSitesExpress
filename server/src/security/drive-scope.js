/**
 * Alcance do painel dentro do Drive.
 *
 * A service account costuma enxergar mais do que a pasta raiz das coletas —
 * outras pastas compartilhadas com ela, drives inteiros. As rotas de arquivo
 * aceitavam qualquer id que ela alcançasse, então quem tinha uma chave do
 * painel lia arquivos que não eram de projeto nenhum. E o id entrava cru na
 * busca do Drive (`'<id>' in parents`), onde um apóstrofo muda a consulta.
 *
 * Funções puras: quem busca os pais no Drive é injetado, para a regra poder
 * ser testada sem rede.
 */

/** Ids do Drive: letras, dígitos, `-` e `_`. Nada que altere uma consulta. */
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export const isValidDriveId = (id) => typeof id === "string" && DRIVE_ID.test(id);

/**
 * A coleta é rasa (raiz → projeto → poucas subpastas); o teto existe para um
 * atalho ou pai circular não fazer a subida passear para sempre.
 */
export const MAX_SCOPE_DEPTH = 12;

/**
 * `id` é a própria raiz ou está em algum nível abaixo dela? Sobe pelos pais —
 * um arquivo pode ter mais de um — até achar a raiz ou esgotar o teto.
 */
export async function isDescendantOf(
  id,
  rootId,
  getParents,
  { maxDepth = MAX_SCOPE_DEPTH } = {},
) {
  if (!isValidDriveId(id) || !rootId) return false;
  if (id === rootId) return true;

  let frontier = [id];
  const seen = new Set(frontier);

  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const parent of (await getParents(current)) ?? []) {
        if (parent === rootId) return true;
        if (!seen.has(parent)) {
          seen.add(parent);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }

  return false;
}
