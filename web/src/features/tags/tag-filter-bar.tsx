import { TagIcon, X } from "lucide-react";
import type { TagsController } from "@/features/tags/use-tags";
import { tagBadgeClass, tagDotClass } from "@/features/tags/tag-colors";
import { ManageTagsDialog } from "@/features/tags/manage-tags-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FilterChip, FilterRow } from "@/components/filter-chip";
import { emptyTagFilter, type TagFilter } from "./tag-filter";

export function TagFilterBar({
  controller,
  counts,
  filter,
  onChange,
  onTagRemoved,
  hiddenTagIds = [],
}: {
  controller: TagsController;
  /**
   * Uso de cada tag entre os projetos que existem. Sem isto vale o número do
   * banco, que conta também pastas que saíram do Drive.
   */
  counts?: Map<string, number>;
  filter: TagFilter;
  onChange: (filter: TagFilter) => void;
  onTagRemoved: (tagId: string) => void;
  /**
   * Tags que não filtram por aqui — "Finalizado" virou vista própria, e como
   * chip ela filtrava para uma lista sempre vazia fora daquela vista.
   */
  hiddenTagIds?: string[];
}) {
  const active =
    filter.tagIds.length > 0 || filter.untaggedOnly;

  const toggleTag = (tagId: string) => {
    const tagIds = filter.tagIds.includes(tagId)
      ? filter.tagIds.filter((id) => id !== tagId)
      : [...filter.tagIds, tagId];
    onChange({ ...filter, tagIds, untaggedOnly: false });
  };

  const visiveis = controller.tags.filter(
    (tag) => !hiddenTagIds.includes(tag.id) || filter.tagIds.includes(tag.id),
  );

  return (
    <FilterRow
      icon={<TagIcon aria-hidden />}
      label="Tags"
      aside={
        <>
          {filter.tagIds.length > 1 && (
            // Com duas ou mais tags marcadas: o projeto precisa de qualquer
            // uma delas, ou de todas.
            <div className="flex h-7 overflow-hidden rounded-md border text-xs" role="group" aria-label="Combinar tags">
              {([false, true] as const).map((todas) => (
                <button
                  key={String(todas)}
                  type="button"
                  aria-pressed={filter.matchAll === todas}
                  onClick={() => onChange({ ...filter, matchAll: todas })}
                  className={cn(
                    "px-2.5 transition-colors",
                    filter.matchAll === todas
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {todas ? "Todas" : "Qualquer"}
                </button>
              ))}
            </div>
          )}
          {active && (
            <Button variant="ghost" size="sm" onClick={() => onChange(emptyTagFilter)}>
              <X />
              Limpar
            </Button>
          )}
          <ManageTagsDialog controller={controller} onTagRemoved={onTagRemoved} />
        </>
      }
    >
      {visiveis.length === 0 && (
        <span className="text-xs text-muted-foreground">
          Nenhuma tag criada — use “Gerenciar tags” ou marque um projeto.
        </span>
      )}
      {visiveis.map((tag) => {
        const on = filter.tagIds.includes(tag.id);
        const count = counts?.get(tag.id) ?? tag.projectCount;
        return (
          <FilterChip
            key={tag.id}
            active={on}
            activeClassName={tagBadgeClass[tag.color]}
            count={count}
            // Uma etiqueta que ninguém usa não filtra nada; ela continua na
            // barra para não sumir do vocabulário, mas recuada.
            dimmed={count === 0}
            title={count === 0 && !on ? `Nenhum projeto usa “${tag.name}”` : undefined}
            leading={<span className={cn("size-2 rounded-full", tagDotClass[tag.color])} />}
            onClick={() => toggleTag(tag.id)}
          >
            {tag.name}
          </FilterChip>
        );
      })}
      <FilterChip
        active={filter.untaggedOnly}
        onClick={() => onChange({ ...emptyTagFilter, untaggedOnly: !filter.untaggedOnly })}
      >
        Sem tag
      </FilterChip>
    </FilterRow>
  );
}
