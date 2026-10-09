import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { StockSearchResult, StockTerm } from "@/lib/api";
import { fetchStockImagesStatus, searchStockImages } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { newRowKey, termsToSearch, type StockTermRow } from "./stock-images";

/** Sugestão de partida: as seções de quase todo site institucional. */
const LINHAS_INICIAIS: Array<Omit<StockTermRow, "key">> = [
  { term: "", section: "hero", quantity: "3" },
  { term: "", section: "sobre", quantity: "2" },
  { term: "", section: "serviços", quantity: "4" },
];

/**
 * A busca no banco de imagens: os termos digitados, a conferência da chave
 * do Pixabay e a busca em si.
 *
 * Morava dentro da aba de imagens; saiu para o formulário de geração poder
 * preencher os termos e buscar de uma vez — é como as sugestões do assistente
 * chegam ao banco de imagens sem a pessoa redigitar nada.
 */
export function useStockSearch({ onResults }: { onResults: (results: StockSearchResult[]) => void }) {
  const status = useQuery({
    queryKey: queryKeys.stockImagesStatus,
    queryFn: fetchStockImagesStatus,
    staleTime: 5 * 60_000,
  });
  const [rows, setRows] = useState<StockTermRow[]>(() =>
    LINHAS_INICIAIS.map((row) => ({ ...row, key: newRowKey() })),
  );
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limits = status.data?.limits;
  const terms = useMemo(
    () => (limits ? termsToSearch(rows, limits.defaultQuantity, limits.maxQuantity) : []),
    [rows, limits],
  );

  const search = useCallback(
    async (quais: StockTerm[] = terms) => {
      if (quais.length === 0) return;
      setSearching(true);
      setError(null);
      try {
        const { results } = await searchStockImages(quais);
        onResults(results);
        const vazios = results.filter((item) => item.images.length === 0);
        if (vazios.length > 0) {
          toast.warning("Busca sem resultado", {
            description: `Nada encontrado para ${vazios.map((item) => `“${item.term}”`).join(", ")}. Tente outro termo.`,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "A busca falhou.");
      } finally {
        setSearching(false);
      }
    },
    [terms, onResults],
  );

  /** Troca as linhas e busca com elas de uma vez. */
  const searchRows = useCallback(
    async (next: StockTermRow[]) => {
      setRows(next);
      if (!limits) return;
      await search(termsToSearch(next, limits.defaultQuantity, limits.maxQuantity));
    },
    [limits, search],
  );

  return {
    status,
    /** Há chave do Pixabay no servidor. */
    configured: status.data?.configured === true,
    limits,
    rows,
    setRows,
    terms,
    searching,
    error,
    search,
    searchRows,
  };
}

export type StockSearch = ReturnType<typeof useStockSearch>;
