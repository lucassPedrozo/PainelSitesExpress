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
  usage,
  onChange,
  className,
  singleLine = false,
  quietAdd = false,
}: {
  project: Project;
  tags: TagsController;
  /** Em quantos projetos cada tag está; sem isto, vale a conta do banco. */
  usage?: Map<string, number>;
  onChange: (project: Project, tagIds: string[]) => void;
  className?: string;
  /**
   * Uma linha só, para o card ter altura fixa: até duas tags à vista e "+N"
   * com o nome das demais no título.
   */
  singleLine?: boolean;
  /**
   * Na tabela: com mouse, o "+ Tag" só aparece com a linha sob o ponteiro ou
   * com o foco nela — em todas as linhas ele pesava mais que as tags. No toque
   * e no teclado ele continua lá.
   */
  quietAdd?: boolean;
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
        <span className="truncate text-xs text-muted-foreground italic">Sem tags</span>
      )}
      {visiveis.map((tag) => (
        <TagBadge
          key={tag.id}
          tag={tag}
          className={singleLine ? "min-w-0 max-w-36" : undefined}
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
          className="inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-2xs text-muted-foreground"
          title={ocultas.map((tag) => tag.name).join(", ")}
        >
          +{ocultas.length}
          <span className="sr-only">: {ocultas.map((tag) => tag.name).join(", ")}</span>
        </span>
      )}
      {podeOrganizar && (
      <TagPicker
        controller={tags}
        counts={usage}
        selected={project.tagIds}
        onChange={(tagIds) => onChange(project, tagIds)}
        trigger={
          <button
            type="button"
            aria-label={applied.length === 0 ? "Adicionar tag" : "Adicionar outra tag"}
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-dashed px-1.5 text-2xs text-muted-foreground transition outline-none hover:border-solid hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
              quietAdd &&
                "pointer-fine:opacity-0 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
            )}
          >
            <Plus className="size-3" />
            Tag
          </button>
        }
      />
      )}
    </div>
  );
}
