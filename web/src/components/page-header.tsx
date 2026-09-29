import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * O topo de cada seção do painel (Deploy, Configurações): título, uma linha
 * dizendo para que a tela serve e as ações dela à direita — mesmo tamanho,
 * mesma distância, em todas.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Linha extra abaixo da descrição (ex.: onde fica o arquivo). */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg leading-tight font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Estado vazio, de erro ou de "escolha algo para começar": ícone num círculo,
 * título, explicação curta e, se houver, a ação que resolve.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col items-center gap-4 px-6 py-12 text-center", className)}>
      <div
        className={cn(
          "grid size-12 place-items-center rounded-full [&_svg]:size-5",
          tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="max-w-md space-y-1">
        <p className="font-medium">{title}</p>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {action}
    </Card>
  );
}
