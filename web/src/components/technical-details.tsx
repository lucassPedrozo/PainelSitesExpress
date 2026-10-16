import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * O que é do motor e não da decisão — a frase digitada ao Claude, o comando,
 * o id do modelo, as etapas com chamadas e builds. Continua a um clique, mas
 * sai do primeiro plano.
 */
export function TechnicalDetails({
  children,
  label = "Detalhes técnicos",
  open,
  className,
}: {
  children: ReactNode;
  label?: ReactNode;
  /** Começa aberto (uma etapa que falhou, por exemplo). */
  open?: boolean;
  className?: string;
}) {
  return (
    <details open={open} className={cn("text-xs text-muted-foreground", className)}>
      <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        {label}
      </summary>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </details>
  );
}

/** Um comando ou um texto do motor, como ele é: monoespaçado e rolando por dentro. */
export function TechnicalCode({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-2xs leading-relaxed break-all whitespace-pre-wrap">
      {children}
    </pre>
  );
}
