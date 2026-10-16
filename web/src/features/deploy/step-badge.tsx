import type { ReactNode } from "react";

/**
 * O número do passo. Só aparece quando há dois passos à vista — configurar e
 * publicar, com o formulário aberto. Sozinho, um "1" não guia nada; por isso
 * quem decide é a tela, que passa `step` só nesse caso.
 *
 * Vai no lugar do ícone do `SectionCard`, com a mesma altura da linha do
 * título.
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
