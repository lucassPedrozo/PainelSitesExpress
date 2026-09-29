import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Tag as TagIcon } from "lucide-react";
import type { TagColor } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import { tagDotClass } from "@/features/tags/tag-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PALETTE: TagColor[] = [
  "slate",
  "blue",
  "cyan",
  "emerald",
  "amber",
  "orange",
  "red",
  "violet",
  "pink",
];

/** Cor sugerida para a próxima tag, girando a paleta. */
const nextColor = (used: number) => PALETTE[used % PALETTE.length];

export function TagPicker({
  controller,
  selected,
  onChange,
  trigger,
  align = "start",
}: {
  controller: TagsController;
  selected: string[];
  onChange: (tagIds: string[]) => void;
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
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
            <TagIcon className="size-4" />
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
              if (event.key === "Enter" && term && !exists) void createAndApply();
            }}
            placeholder="Buscar ou criar tag..."
            className="h-8"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {matches.map((tag) => {
            const active = selected.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition hover:bg-muted"
              >
                <span
                  className={cn("size-2.5 shrink-0 rounded-full", tagDotClass[tag.color])}
                />
                <span className="flex-1 truncate">{tag.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tag.projectCount}
                </span>
                <Check
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

        {term && !exists && (
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
