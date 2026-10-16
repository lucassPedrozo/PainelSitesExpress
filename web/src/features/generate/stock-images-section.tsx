import { Check, ExternalLink, ImageOff, Loader2, Plus, Search, X } from "lucide-react";
import type { StockCandidate, StockSearchResult } from "@/lib/api";
import { stockThumbnailUrl } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { STOCK_ZIP_NAME, stockZipPath } from "@shared/stock-images.js";
import { TechnicalCode, TechnicalDetails } from "@/features/claude/claude-shared";
import { groupKey, newRowKey, type StockPick, type StockTermRow } from "./stock-images";
import type { StockSearch } from "./use-stock-search";

/**
 * Imagens de banco (Pixabay) para completar o material do cliente.
 *
 * Um termo por seção do site, como no script de busca da equipe ("hero:3",
 * "sobre:2"…). A busca não gasta nada e a chave do Pixabay fica no servidor.
 * No Lovable, as fotos marcadas são baixadas só na geração e sobem num anexo
 * só, `imagens-pixabay.zip`, com uma pasta por seção — o Lovable limita os
 * anexos por arquivo, e o zip conta como um; um bloco próprio do prompt diz o
 * que há no zip. No Claude, elas são baixadas para a pasta de trabalho junto
 * com o material do briefing: não há zip nem bloco de prompt.
 *
 * Os termos e a busca vivem em `useStockSearch`, no formulário: é de lá que o
 * assistente preenche as buscas sugeridas.
 */
export function StockImagesSection({
  search,
  picks,
  results,
  stockBlock,
  engine = "lovable",
  className,
  onToggle,
}: {
  search: StockSearch;
  picks: Map<number, StockPick>;
  results: StockSearchResult[];
  /** O bloco que vai no fim do prompt — mostrado para não haver surpresa. */
  stockBlock: string;
  /** Para quem as fotos vão: as regras do envio mudam com o motor. */
  engine?: "lovable" | "claude";
  className?: string;
  onToggle: (candidate: StockCandidate, group: StockSearchResult) => void;
}) {
  const { status, limits, rows, setRows, terms, searching, error } = search;

  const update = (key: number, patch: Partial<StockTermRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    // Em duas colunas a seção rola por dentro: os termos, os botões e a
    // lista têm altura própria, e sem isto o que não cabia vazava do diálogo.
    <section className={cn("flex min-h-0 min-w-0 flex-col gap-2 p-6 lg:overflow-y-auto", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Imagens de banco
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{pluralize(picks.size, "marcada")}</span>
        </h3>
        <a
          href="https://pixabay.com/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          Fotos do Pixabay
        </a>
      </div>

      {status.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Conferindo a chave do Pixabay…
        </p>
      ) : !status.data?.configured ? (
        <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm">
          <p className="font-medium">A busca de imagens de banco está desligada</p>
          <p className="mt-1 text-muted-foreground">
            {status.error
              ? `Não foi possível conferir a configuração do Pixabay (${status.error.message}). Se o painel acabou de ser atualizado, reinicie-o pelo lançador.`
              : `Preencha a chave do Pixabay em Configurações → Geração de sites (PIXABAY_API_KEY). ${
                  engine === "claude"
                    ? "Os arquivos do projeto continuam indo para o Claude normalmente."
                    : "Os arquivos do Drive continuam indo normalmente."
                }`}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {engine === "claude" ? (
              <>
                Um termo por seção do site. A busca não gasta nada. As fotos marcadas são baixadas para a
                pasta de trabalho do Claude, junto com o material que ele lê.
              </>
            ) : (
              <>
                Um termo por seção do site. A busca não gasta crédito. As fotos marcadas vão juntas em{" "}
                <b className="font-medium">{STOCK_ZIP_NAME}</b>, uma pasta por seção — o zip conta como um anexo
                só, qualquer que seja a quantidade de fotos.
              </>
            )}
          </p>

          <div className="space-y-1.5">
            {rows.map((row) => (
              <div key={row.key} className="flex items-center gap-1.5">
                <Input
                  value={row.term}
                  onChange={(event) => update(row.key, { term: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && terms.length > 0 && !searching) void search.search();
                  }}
                  maxLength={limits?.maxTermChars}
                  placeholder="Busca, ex.: padaria artesanal"
                  aria-label="Termo de busca"
                  className="min-w-0 flex-1"
                />
                <Input
                  value={row.section}
                  onChange={(event) => update(row.key, { section: event.target.value })}
                  maxLength={limits?.maxSectionChars}
                  placeholder="Seção"
                  aria-label="Seção do site"
                  className="w-28"
                />
                <Input
                  type="number"
                  min={1}
                  max={limits?.maxQuantity}
                  value={row.quantity}
                  onChange={(event) => update(row.key, { quantity: event.target.value })}
                  aria-label="Quantidade de fotos"
                  title="Quantas fotos vêm marcadas"
                  className="w-16 tabular-nums"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="Remover termo"
                  disabled={rows.length === 1}
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!limits || rows.length >= limits.maxTerms}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { key: newRowKey(), term: "", section: "", quantity: String(limits?.defaultQuantity ?? 5) },
                ])
              }
            >
              <Plus />
              Termo
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={terms.length === 0 || searching}
              onClick={() => void search.search()}
            >
              {searching ? <Loader2 className="animate-spin" /> : <Search />}
              Buscar imagens
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {limits && picks.size > limits.maxImages && (
            <p className="text-xs text-destructive">
              {pluralize(picks.size, "foto marcada", "fotos marcadas")} — o máximo por envio é {limits.maxImages}.
            </p>
          )}

          {/* Altura mínima: com pouco espaço a seção rola, mas a lista de
              fotos nunca some. */}
          <div className="min-h-40 flex-1 space-y-4 overflow-y-auto rounded-lg border p-2">
            {results.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Preencha os termos e busque. As primeiras fotos de cada termo
                vêm marcadas; clique para trocar.
              </p>
            ) : (
              results.map((group) => (
                <StockGroup
                  key={groupKey(group)}
                  group={group}
                  picks={picks}
                  onToggle={(candidate) => onToggle(candidate, group)}
                />
              ))
            )}
          </div>

          {stockBlock && (
            <TechnicalDetails>
              <p>Bloco que vai no fim do prompt:</p>
              <TechnicalCode>{stockBlock}</TechnicalCode>
            </TechnicalDetails>
          )}
        </>
      )}
    </section>
  );
}

function StockGroup({
  group,
  picks,
  onToggle,
}: {
  group: StockSearchResult;
  picks: Map<number, StockPick>;
  onToggle: (candidate: StockCandidate) => void;
}) {
  const key = groupKey(group);
  const marcadas = group.images.filter((image) => {
    const pick = picks.get(image.id);
    return pick !== undefined && groupKey(pick) === key;
  }).length;

  return (
    <div>
      <p className="mb-1.5 flex items-baseline justify-between gap-2 px-1 text-xs">
        <span className="truncate font-medium">
          {group.section ? `${group.section} · ` : ""}“{group.term}”
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {marcadas} de {group.images.length}
        </span>
      </p>

      {group.images.length === 0 ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <ImageOff className="size-3.5" />
          Nenhuma foto encontrada para este termo.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {group.images.map((image) => {
            const pick = picks.get(image.id);
            const on = pick !== undefined;
            // A mesma foto já marcada em outro grupo: vai com o nome de lá.
            const emOutroGrupo = on && groupKey(pick) !== key;
            return (
              <button
                key={image.id}
                type="button"
                aria-pressed={on}
                disabled={emOutroGrupo}
                onClick={() => onToggle(image)}
                title={
                  emOutroGrupo
                    ? `Já marcada em outro termo (${stockZipPath(pick)})`
                    : `${image.tags}${image.user ? ` · foto de ${image.user}` : ""}`
                }
                className={cn(
                  "relative aspect-3/2 overflow-hidden rounded-md border bg-muted outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60",
                  on ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100",
                  emOutroGrupo && "cursor-not-allowed opacity-50",
                )}
              >
                <img
                  src={stockThumbnailUrl(image.id)}
                  alt={image.tags}
                  loading="lazy"
                  className="size-full object-cover"
                />
                {on && (
                  <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                    <Check className="size-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
