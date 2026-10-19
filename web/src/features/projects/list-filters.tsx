import { useState, useTransition } from "react";
import { ArrowDownUp, ListFilter, TriangleAlert, X } from "lucide-react";
import type { TagsController } from "@/features/tags/use-tags";
import { TagFilterMenu } from "@/features/tags/tag-filter-menu";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SlidingIndicator, useSlidingIndicator } from "@/components/sliding-indicator";
import { sortLabels, type EtapaFilter, type SortKey } from "./project-filters";
import { ETAPAS, ETAPA_ORDER, toneClass, type ListTab } from "./stage";
import type { ProjectList } from "./use-project-list";

const TABS: Array<{ value: ListTab; label: string; title: string }> = [
  { value: "ativos", label: "Ativos", title: "Tudo o que ainda não está no ar nem foi finalizado" },
  { value: "no-ar", label: "No ar", title: "Publicados no domínio do cliente" },
  { value: "finalizados", label: "Finalizados", title: "Os que têm a tag “Finalizado”" },
  { value: "ocultos", label: "Ocultos", title: "Ocultados pela equipe: fora da lista, dos contadores, do Dashboard e do relatório" },
];

/**
 * A linha de filtros da lista: as abas (Ativos, No ar, Finalizados), a etapa,
 * as tags e a ordem — numa linha só. A busca é a do cabeçalho do painel.
 */
export function ListFilters({
  list,
  tags,
  onManageTags,
}: {
  list: ProjectList;
  tags: TagsController;
  onManageTags: () => void;
}) {
  const semDado = list.loading || (Boolean(list.error) && list.projects.length === 0);
  // A aba responde ao clique na hora: ela (e o fundo que desliza até ela)
  // muda já, e a lista nova monta em seguida, sem prender o clique.
  const [pedida, setPedida] = useState<ListTab | null>(null);
  const [, startTransition] = useTransition();
  const aba = pedida ?? list.tab;
  const escolher = (value: ListTab) => {
    setPedida(value);
    startTransition(() => {
      list.setTab(value);
      setPedida(null);
    });
  };
  // O fundo da aba ativa é um só, e desliza até a aba escolhida.
  const { containerRef: abasRef, box: fundo, animar } = useSlidingIndicator<HTMLDivElement>(aba);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
      <div ref={abasRef} role="group" aria-label="Aba" className="relative flex items-center gap-0.5">
        <SlidingIndicator box={fundo} animar={animar} className="inset-y-0 rounded-lg bg-secondary" />
        {/* "Ocultos" só aparece quando há algum — ou quando é a aba aberta. */}
        {TABS.filter((tab) => tab.value !== "ocultos" || aba === "ocultos" || list.tabCounts.ocultos > 0).map((tab) => {
          const on = aba === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-pressed={on}
              data-indicator-active={on}
              title={tab.title}
              onClick={() => escolher(tab.value)}
              className={cn(
                "relative inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-ui font-medium transition-colors outline-none pointer-coarse:h-11",
                "focus-visible:ring-2 focus-visible:ring-ring/60",
                on ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {tab.label}
              {/* Sem a lista (carregando ou com falha), a aba não diz um 0 que ninguém contou. */}
              {!semDado && <span className="text-xs text-muted-foreground tabular-nums">{list.tabCounts[tab.value]}</span>}
            </button>
          );
        })}
      </div>

      <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <Select
        value={list.etapa ?? "todas"}
        onValueChange={(value) => list.setEtapa(value === "todas" ? null : (value as EtapaFilter))}
      >
        <SelectTrigger aria-label="Filtrar por etapa" className={cn(list.etapa && "border-primary/50")}>
          <ListFilter className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todas">Todas as etapas</SelectItem>
          <SelectSeparator />
          {ETAPA_ORDER.map((key) => {
            const etapa = ETAPAS[key];
            const Icon = etapa.icon;
            return (
              <SelectItem key={key} value={key}>
                <Icon className={toneClass[etapa.tone].text} />
                {etapa.label}
              </SelectItem>
            );
          })}
          <SelectSeparator />
          <SelectItem value="problema">
            <TriangleAlert className="text-destructive" />
            Com problema
          </SelectItem>
        </SelectContent>
      </Select>

      <TagFilterMenu
        controller={tags}
        counts={list.tagCounts}
        filter={list.tagFilter}
        onChange={list.setTagFilter}
        hiddenTagIds={tags.finishedTagId ? [tags.finishedTagId] : []}
        onManage={onManageTags}
      />

      <Select value={list.sort} onValueChange={(value) => list.setSort(value as SortKey)}>
        <SelectTrigger aria-label="Ordenar por">
          <ArrowDownUp className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(sortLabels) as SortKey[]).map((key) => (
            <SelectItem key={key} value={key}>
              {sortLabels[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-2">
        {list.filtersActive && (
          <Button variant="ghost" onClick={list.clearFilters}>
            <X />
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
