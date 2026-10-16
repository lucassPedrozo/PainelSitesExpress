import { X } from "lucide-react";
import type { Tag } from "@/lib/api";
import { tagDotClass } from "@/features/tags/tag-colors";
import { cn } from "@/lib/utils";

/**
 * Uma tag: pílula neutra com o ponto na cor dela. A cor de fundo ficou para
 * as etapas — numa linha com selo de etapa, duas cores fortes disputavam o
 * olhar, e a tag é a informação de exceção, não a principal.
 */
export function TagBadge({
  tag,
  className,
  onRemove,
}: {
  tag: Tag;
  className?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1.5 rounded-sm border bg-card px-1.5 text-2xs font-medium text-muted-foreground",
        className,
      )}
      title={tag.name}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tagDotClass[tag.color])} />
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remover tag ${tag.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="relative -mr-0.5 rounded-sm opacity-70 transition outline-none after:absolute after:-inset-2 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
