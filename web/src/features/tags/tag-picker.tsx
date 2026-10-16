import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Tag as TagIcon } from "lucide-react";
import type { TagsController } from "@/features/tags/use-tags";
import { TAG_PALETTE, tagDotClass } from "@/features/tags/tag-colors";
import { ErrorNotice } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Cor sugerida para a próxima tag, girando a paleta. */
const nextColor = (used: number) => TAG_PALETTE[used % TAG_PALETTE.length];

export function TagPicker({
  controller,
  selected,
  onChange,
  trigger,
  align = "start",
  counts,
}: {
  controller: TagsController;
  selected: string[];
  onChange: (tagIds: string[]) => void;
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
  /**
   * Quantos projetos que existem têm cada tag — a conta do filtro. Sem o
   * mapa, vale o número do banco (`projectCount`); no mapa, uma tag ausente
   * conta zero.
   */
  counts?: Map<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const term = query.trim();
  const matches = useMemo(() => {
    const needle = term.toLocaleLowerCase("pt-BR");
    return needle
      ? controller.tags.filter((tag) =>
          tag.name.toLocaleLowerCase("pt-BR").includes(needle),
        )
      : controller.tags;
  }, [controller.tags, term]);

  const exists = controller.tags.some(
    (tag) =>
      tag.name.toLocaleLowerCase("pt-BR") === term.toLocaleLowerCase("pt-BR"),
  );
  // Criar só com a lista na mão: carregando ou com falha, não dá para saber
  // se a tag já existe, e o atalho criaria uma repetida.
  const listaPronta = !controller.loading && !controller.error;
  const podeCriar = listaPronta && Boolean(term) && !exists;

  const toggle = (tagId: string) => {
    onChange(
      selected.includes(tagId)
        ? selected.filter((id) => id !== tagId)
        : [...selected, tagId],
    );
  };

  const createAndApply = async () => {
    if (!term || creating) return;
    setCreating(true);
    setError(null);
    try {
      const tag = await controller.create(term, nextColor(controller.tags.length));
      onChange([...selected, tag.id]);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild onClick={(event) => event.stopPropagation()}>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <TagIcon />
            Tags
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-64 p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && podeCriar) void createAndApply();
            }}
            placeholder="Buscar ou criar tag…"
            aria-label="Buscar ou criar tag"
          />
        </div>

        {/* Carregando e falha têm cara própria: antes as duas apareciam como
            "Nenhuma tag criada", e quem lia achava que não havia. */}
        {controller.loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-32" />
          </div>
        ) : controller.error ? (
          <ErrorNotice
            title="Não foi possível carregar as tags"
            error={controller.error}
            onRetry={() => void controller.reload()}
            className="px-3 py-5"
          />
        ) : (
          <div className="max-h-64 overflow-y-auto p-1">
            {matches.map((tag) => {
              const active = selected.includes(tag.id);
              const count = counts ? (counts.get(tag.id) ?? 0) : tag.projectCount;
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  aria-pressed={active}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition hover:bg-muted"
                >
                  <span
                    aria-hidden
                    className={cn("size-2.5 shrink-0 rounded-full", tagDotClass[tag.color])}
                  />
                  <span className="flex-1 truncate" title={tag.name}>
                    {tag.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {count}
                  </span>
                  <Check
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 transition",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}

            {matches.length === 0 && !term && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nenhuma tag criada ainda.
              </p>
            )}
          </div>
        )}

        {podeCriar && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => void createAndApply()}
              disabled={creating}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition hover:bg-muted disabled:opacity-60"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Criar <span className="font-medium">“{term}”</span>
            </button>
          </div>
        )}

        {error && (
          <p className="border-t px-3 py-2 text-xs text-destructive">{error}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
