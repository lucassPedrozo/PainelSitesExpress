import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Um bloco de uma tela, com o cabeçalho padrão: título de seção, uma linha de
 * explicação e as ações à direita; o conteúdo logo abaixo, com o mesmo
 * respiro em todo lugar.
 */
export function SectionCard({
  title,
  description,
  actions,
  icon,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** `p-0` para tabelas e listas que encostam nas bordas. */
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <Card id={id} className={cn("gap-0 py-0", className)}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        {/* basis-60: sem espaço para o título e as ações lado a lado (no
            celular), as ações descem, em vez de espremer o título. */}
        <div className="min-w-0 flex-1 basis-60 space-y-0.5">
          <h2 className="flex items-center gap-2 text-section [&_svg]:size-4 [&_svg]:text-muted-foreground">
            {icon}
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children !== undefined && <div className={cn("px-5 pb-5", bodyClassName)}>{children}</div>}
    </Card>
  );
}
