import { Plus } from "lucide-react";
import type { Project } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import { usePermissions } from "@/lib/permissions";
import { TagBadge } from "@/features/tags/tag-badge";
import { TagPicker } from "@/features/tags/tag-picker";
import { cn } from "@/lib/utils";

/** As tags são o status do projeto — editáveis onde quer que apareçam. */
export function ProjectTags({
  project,
  tags,
  onChange,
  className,
  singleLine = false,
}: {
  project: Project;
  tags: TagsController;
  onChange: (project: Project, tagIds: string[]) => void;
  className?: string;
  /**
   * Uma linha só, para o card ter altura fixa: até duas tags à vista e "+N"
   * com o nome das demais no título.
   */
  singleLine?: boolean;
}) {
  const { can } = usePermissions();
  const podeOrganizar = can("organizar");

  const applied = project.tagIds
    .map((id) => tags.byId.get(id))
    .filter((tag) => tag !== undefined);

  const visiveis = singleLine ? applied.slice(0, 2) : applied;
  const ocultas = applied.slice(visiveis.length);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        singleLine ? "min-w-0 flex-nowrap overflow-hidden" : "flex-wrap",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {!podeOrganizar && applied.length === 0 && singleLine && (
        <span className="truncate text-xs text-muted-foreground/70 italic">Sem tags</span>
      )}
      {visiveis.map((tag) => (
        <TagBadge
          key={tag.id}
          tag={tag}
          className={singleLine ? "min-w-0 max-w-[9rem]" : undefined}
          // Sem permissão a etiqueta continua à vista — ela é informação —,
          // mas perde o "x" que a removeria.
          onRemove={
            podeOrganizar
              ? () =>
                  onChange(
                    project,
                    project.tagIds.filter((id) => id !== tag.id),
                  )
              : undefined
          }
        />
      ))}
      {ocultas.length > 0 && (
        <span
          className="inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs text-muted-foreground"
          title={ocultas.map((tag) => tag.name).join(", ")}
        >
          +{ocultas.length}
        </span>
      )}
      {podeOrganizar && (
      <TagPicker
        controller={tags}
        selected={project.tagIds}
        onChange={(tagIds) => onChange(project, tagIds)}
        trigger={
          <button
            type="button"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="size-3" />
            {applied.length === 0 ? "Adicionar tag" : "Tag"}
          </button>
        }
      />
      )}
    </div>
  );
}
