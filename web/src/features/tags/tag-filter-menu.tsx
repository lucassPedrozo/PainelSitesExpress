import { ChevronDown, Settings2, Tag as TagIcon } from "lucide-react";
import type { TagsController } from "@/features/tags/use-tags";
import { tagDotClass } from "@/features/tags/tag-colors";
import { usePermissions } from "@/lib/permissions";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { emptyTagFilter, type TagFilter } from "./tag-filter";

/**
 * O filtro de tags, num seletor só da barra de filtros. Antes era uma
 * fileira inteira de chips, com o mesmo peso dos selos de etapa.
 *
 * Várias tags marcadas: o projeto precisa de qualquer uma delas, ou de todas.
 * "Sem tag" acha o que ainda não foi triado. A contagem é a dos projetos que
 * existem, com os outros filtros aplicados — o que aparece ao marcar.
 */
export function TagFilterMenu({
  controller,
  counts,
  filter,
  onChange,
  hiddenTagIds = [],
  onManage,
}: {
  controller: TagsController;
  counts: Map<string, number>;
  filter: TagFilter;
  onChange: (filter: TagFilter) => void;
  /** "Finalizado" tem aba própria: como filtro daria uma lista vazia fora dela. */
  hiddenTagIds?: string[];
  /** Abre o diálogo de criar, renomear e excluir tags. */
  onManage: () => void;
}) {
  const { can } = usePermissions();
  const visiveis = controller.tags.filter((tag) => !hiddenTagIds.includes(tag.id) || filter.tagIds.includes(tag.id));
  const marcadas = filter.tagIds.map((id) => controller.byId.get(id)).filter((tag) => tag !== undefined);
  const rotulo = filter.untaggedOnly
    ? "Sem tag"
    : marcadas.length === 0
      ? "Todas as tags"
      : marcadas.length === 1
        ? marcadas[0].name
        : `${marcadas.length} tags`;

  const toggle = (tagId: string) => {
    const tagIds = filter.tagIds.includes(tagId)
      ? filter.tagIds.filter((id) => id !== tagId)
      : [...filter.tagIds, tagId];
    onChange({ ...filter, tagIds, untaggedOnly: false });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("max-w-56", (marcadas.length > 0 || filter.untaggedOnly) && "border-primary/50")}>
          <TagIcon />
          <span className="truncate">{rotulo}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <div className="max-h-80 overflow-y-auto p-1">
          {controller.loading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-32" />
            </div>
          ) : controller.error ? (
            <p className="p-3 text-sm text-destructive">Não foi possível carregar as tags: {controller.error}</p>
          ) : visiveis.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nenhuma tag criada ainda.</p>
          ) : (
            visiveis.map((tag) => {
              const count = counts.get(tag.id) ?? 0;
              const id = `filtro-tag-${tag.id}`;
              return (
                <label
                  key={tag.id}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox id={id} checked={filter.tagIds.includes(tag.id)} onCheckedChange={() => toggle(tag.id)} />
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tagDotClass[tag.color])} />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                </label>
              );
            })
          )}
          <div aria-hidden className="-mx-1 my-1 h-px bg-border" />
          <label
            htmlFor="filtro-sem-tag"
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Checkbox
              id="filtro-sem-tag"
              checked={filter.untaggedOnly}
              onCheckedChange={() => onChange({ ...emptyTagFilter, untaggedOnly: !filter.untaggedOnly })}
            />
            <span className="flex-1">Sem tag</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t p-2">
          {filter.tagIds.length > 1 && (
            <Segmented
              label="Combinar tags"
              value={filter.matchAll ? "todas" : "qualquer"}
              onChange={(value) => onChange({ ...filter, matchAll: value === "todas" })}
              options={[
                { value: "qualquer", label: "Qualquer", title: "O projeto tem pelo menos uma das tags marcadas" },
                { value: "todas", label: "Todas", title: "O projeto tem todas as tags marcadas" },
              ]}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onManage}
            disabled={!can("organizar")}
            title={can("organizar") ? undefined : "Sua chave de acesso não pode organizar projetos."}
          >
            <Settings2 />
            Gerenciar tags
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
