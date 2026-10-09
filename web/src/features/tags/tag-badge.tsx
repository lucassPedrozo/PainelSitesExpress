import { X } from "lucide-react";
import type { Tag } from "@/lib/api";
import { tagBadgeClass } from "@/features/tags/tag-colors";
import { cn } from "@/lib/utils";

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
        "inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-2 text-xs font-medium",
        tagBadgeClass[tag.color],
        className,
      )}
      title={tag.name}
    >
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
