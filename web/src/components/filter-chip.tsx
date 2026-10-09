import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * O chip de filtro do painel — etapas, tags e "Sem tag" usam o mesmo, com a
 * mesma altura (28px, igual aos botões `sm`), raio, contador e estados.
 *
 * Desligado ele é um pino claro com fio de borda, sobre o fundo da página —
 * os filtros não têm mais caixa própria, e o preenchimento `muted` de antes
 * sumia nesse fundo. Ligado, assume a cor de quem ele representa
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
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium pointer-coarse:h-10 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? (activeClassName ?? "border-primary/25 bg-primary/10 text-foreground")
          : "border-border bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        // Recuado pelo traço, não pela opacidade: a 50% o texto caía para
        // 2:1 de contraste.
        dimmed && !active && "border-dashed bg-transparent shadow-none",
        className,
      )}
      {...props}
    >
      {leading}
      {children}
      {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
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
    // Rótulo e ações ficam na primeira linha quando os chips quebram. Na tela
    // estreita os chips viram um trilho que rola de lado — empilhados, as
    // duas fileiras tomavam metade da primeira tela do celular — e as ações
    // descem para uma linha própria, à direita.
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span className="flex h-7 w-16 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      {/* O trilho sangra até a borda da tela (`-mr-6` desfaz o `px-6` da
          página): um chip cortado pela borda é o sinal de que há mais. O
          respiro vertical (`py-1 -my-1`) é para o anel de foco não ser
          cortado pelo trilho que rola. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 max-sm:-my-1 max-sm:-mr-6 max-sm:overflow-x-auto max-sm:py-1 max-sm:pr-6 sm:min-w-48 sm:flex-wrap">
        {children}
      </div>
      {aside && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 max-sm:basis-full max-sm:justify-end">
          {aside}
        </div>
      )}
    </div>
  );
}
