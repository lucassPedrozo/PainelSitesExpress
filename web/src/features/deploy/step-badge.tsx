import type { ReactNode } from "react";

/**
 * O número do passo. Cada card carrega exatamente um — antes o card de
 * workflows abrigava o "2" e o "3", e a numeração deixava de guiar.
 */
export function StepBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-2xs font-semibold text-secondary-foreground tabular-nums"
    >
      {children}
    </span>
  );
}
