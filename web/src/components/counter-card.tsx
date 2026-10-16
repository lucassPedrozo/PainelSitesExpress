import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Um número que filtra: o ícone no tom do que ele conta, o número em tamanho
 * de título e o rótulo. Ligado, ganha o contorno da ação principal; clicar de
 * novo desliga.
 *
 * Sem `onClick` ele só mostra o número (os indicadores do Dashboard), no
 * mesmo desenho; `detail` põe embaixo do rótulo o que o número mede.
 */
export function CounterCard({
  count,
  label,
  icon,
  toneClassName,
  active,
  onClick,
  hint,
  detail,
  countClassName,
  className,
}: {
  /** `null` enquanto a lista não chegou (ou falhou): mostra "—", não um 0. */
  count: ReactNode;
  label: string;
  icon: ReactNode;
  /** Fundo e cor do círculo do ícone (`toneClass[...].soft`). */
  toneClassName: string;
  /** Ligado ou desligado, quando o contador é um filtro; sem ele, o clique só leva a algum lugar. */
  active?: boolean;
  onClick?: () => void;
  /** O que entra na conta — vai para o leitor de tela e para o tooltip. */
  hint?: string;
  /** Uma linha à vista sob o rótulo: o que o número mede. */
  detail?: ReactNode;
  countClassName?: string;
  className?: string;
}) {
  const vazio = count === 0 || count === null;
  const conteudo = (
    <>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4", toneClassName)}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-numeral tabular-nums", countClassName)}>{count ?? "—"}</span>
        <span className="block text-xs leading-tight text-muted-foreground">{label}</span>
        {detail && <span className="mt-1 block text-2xs leading-tight text-muted-foreground">{detail}</span>}
      </span>
      {hint && <span className="sr-only">{hint}</span>}
    </>
  );
  const base = cn(
    "relative flex min-w-0 gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs",
    detail ? "items-start" : "items-center",
  );

  if (!onClick) {
    return (
      <div title={hint} className={cn(base, className)}>
        {conteudo}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={hint}
      className={cn(
        base,
        "transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/60",
        active && "border-primary ring-1 ring-primary",
        vazio && !active && "opacity-70",
        className,
      )}
    >
      {conteudo}
    </button>
  );
}
