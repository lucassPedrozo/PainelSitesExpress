import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * O chip de filtro do painel — etapas, tags e "Sem tag" usam o mesmo, com a
 * mesma altura (28px, igual aos botões `sm`), raio, contador e estados.
 *
 * Desligado ele é neutro; ligado, assume a cor de quem ele representa
 * (`activeClassName`), ou o destaque neutro quando não há cor própria.
 */
export function FilterChip({
  active,
  activeClassName,
  count,
  dimmed = false,
  leading,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "type"> & {
  active: boolean;
  activeClassName?: string;
  count?: number;
  /** Não filtra nada agora (contagem zero): fica recuado até o mouse passar. */
  dimmed?: boolean;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? (activeClassName ?? "border-primary/25 bg-primary/10 text-foreground")
          : "border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        dimmed && !active && "opacity-50 hover:opacity-100",
        className,
      )}
      {...props}
    >
      {leading}
      {children}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  );
}

/** Uma fileira de filtros: rótulo numa coluna fixa, chips à direita. */
export function FilterRow({
  icon,
  label,
  children,
  aside,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  /** Ações da fileira, alinhadas à direita (limpar, gerenciar…). */
  aside?: ReactNode;
}) {
  return (
    // Rótulo e ações ficam na primeira linha quando os chips quebram.
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span className="flex h-7 w-16 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
      {aside && <div className="flex shrink-0 items-center gap-1.5">{aside}</div>}
    </div>
  );
}
