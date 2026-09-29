import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Controle segmentado: uma escolha entre poucas opções vizinhas (vistas,
 * grade/lista, seções do cabeçalho). Tem a altura de um botão padrão (32px) —
 * trilho com 2px de respiro e segmentos de 28px —, então alinha com os
 * botões, campos e seletores da mesma barra.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{
    value: T;
    label?: ReactNode;
    icon?: ReactNode;
    title?: string;
    /** Contador depois do rótulo. */
    count?: number;
  }>;
  /** Nome do grupo para leitores de tela. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-xs", className)}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            title={option.title}
            aria-label={option.label ? undefined : option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-md text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
              option.label ? "px-2.5" : "w-7 justify-center",
              on
                ? "bg-secondary text-secondary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {option.icon}
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  "rounded-sm px-1 text-2xs tabular-nums",
                  on ? "bg-background/70 text-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
