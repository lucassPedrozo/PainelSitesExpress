import type { StockCandidate, StockSearchResult, StockSelection } from "@/lib/api";

/**
 * A escolha das imagens de banco, calculada fora da tela.
 *
 * Cada termo buscado é um grupo (a "subpasta" do script de busca): a seção do
 * site, quando informada, ou o próprio termo. A busca traz mais candidatas que
 * a quantidade pedida; as primeiras vêm marcadas e a pessoa troca o que quiser.
 */

export type StockPick = StockSelection & { candidate: StockCandidate };

/** Uma linha do formulário de busca, como digitada. */
export type StockTermRow = {
  key: number;
  term: string;
  section: string;
  quantity: string;
};

/** O grupo de um termo — mesma busca e mesma seção são o mesmo grupo. */
export const groupKey = (group: { term: string; section: string | null }) =>
  `${(group.section ?? "").trim().toLowerCase()}\u0000${group.term.trim().toLowerCase()}`;

let proximaChave = 0;

/** A chave de uma linha nova do formulário de busca — única na sessão. */
export const newRowKey = () => ++proximaChave;

/**
 * As buscas sugeridas pelo assistente como linhas do formulário: até o teto
 * de termos, com a quantidade dentro do limite do banco de imagens.
 */
export function rowsFromQueries(
  queries: Array<{ term: string; section: string; quantity: number }>,
  limits: { maxTerms: number; maxQuantity: number; defaultQuantity: number },
  nextKey: () => number = newRowKey,
): StockTermRow[] {
  return queries
    .filter((query) => query.term.trim())
    .slice(0, limits.maxTerms)
    .map((query) => {
      const numero = Math.trunc(Number(query.quantity));
      const quantidade =
        Number.isFinite(numero) && numero > 0 ? Math.min(numero, limits.maxQuantity) : limits.defaultQuantity;
      return { key: nextKey(), term: query.term.trim(), section: query.section.trim(), quantity: String(quantidade) };
    });
}

/** As linhas preenchidas, prontas para a API. Linha sem termo é ignorada. */
export function termsToSearch(rows: StockTermRow[], defaultQuantity: number, maxQuantity: number) {
  return rows
    .filter((row) => row.term.trim())
    .map((row) => {
      const numero = Math.trunc(Number(row.quantity));
      return {
        term: row.term.trim(),
        section: row.section.trim() || null,
        quantity: Number.isFinite(numero) && numero > 0 ? Math.min(numero, maxQuantity) : defaultQuantity,
      };
    });
}

/**
 * A seleção depois de uma busca nova.
 *
 * Num grupo que já existia, valem as fotos que a pessoa escolheu e que vieram
 * de novo; num grupo novo (ou sem nenhuma escolha que sobreviveu), as
 * primeiras `quantity`. Grupos que saíram da busca saem da seleção. Uma foto
 * que aparece em dois grupos fica no primeiro.
 */
export function nextStockSelection(
  previous: Map<number, StockPick>,
  results: StockSearchResult[],
): Map<number, StockPick> {
  const next = new Map<number, StockPick>();

  for (const result of results) {
    const key = groupKey(result);
    const pick = (candidate: StockCandidate) => {
      if (next.has(candidate.id)) return;
      next.set(candidate.id, {
        id: candidate.id,
        term: result.term,
        section: result.section,
        candidate,
      });
    };

    const mantidas = result.images.filter((image) => {
      const antes = previous.get(image.id);
      return antes !== undefined && groupKey(antes) === key;
    });

    if (mantidas.length > 0) mantidas.forEach(pick);
    else result.images.slice(0, result.quantity).forEach(pick);
  }

  return next;
}

/** Marca ou desmarca uma foto dentro do seu grupo. */
export function toggleStockPick(
  current: Map<number, StockPick>,
  candidate: StockCandidate,
  group: { term: string; section: string | null },
): Map<number, StockPick> {
  const next = new Map(current);
  if (next.has(candidate.id)) next.delete(candidate.id);
  else next.set(candidate.id, { id: candidate.id, term: group.term, section: group.section, candidate });
  return next;
}
