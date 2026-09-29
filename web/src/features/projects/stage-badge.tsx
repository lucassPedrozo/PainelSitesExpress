import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { projectStatus, stageClass } from "./project-status";

/**
 * O selo de etapa do projeto — o mesmo no card, na lista e no modal. O
 * detalhe (o porquê daquela etapa) aparece ao passar o mouse.
 */
export function StageBadge({
  project,
  size = "default",
  className,
}: {
  project: Project;
  /** `sm` no card, onde divide a linha com o título. */
  size?: "sm" | "default";
  className?: string;
}) {
  const status = projectStatus(project);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center truncate rounded-md border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        stageClass[status.stage],
        className,
      )}
      title={status.detail}
    >
      {status.label}
    </span>
  );
}
