import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * O topo de cada seção do painel: o título da página, uma linha dizendo para
 * que a tela serve e as ações dela à direita — mesmo tamanho e mesma
 * distância em todas. O título é o `h1` da página: o nome do painel, no
 * cabeçalho, não é título.
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
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-page">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Estado vazio, de erro ou de "escolha algo para começar", do tamanho de uma
 * seção: ícone num círculo, título, explicação curta e, se houver, a ação que
 * resolve.
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
          tone === "danger" ? "bg-destructive-soft text-destructive" : "bg-muted text-muted-foreground",
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

/**
 * Estado vazio **dentro** de uma lista ou cartão (workflows, execuções,
 * chaves…): o mesmo desenho do `EmptyState`, sem o cartão em volta e mais
 * baixo.
 */
export function EmptyNotice({
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
    <div className={cn("flex flex-col items-center gap-2 px-6 py-8 text-center", className)}>
      <div
        className={cn(
          "grid size-9 place-items-center rounded-full [&_svg]:size-4",
          tone === "danger" ? "bg-destructive-soft text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="max-w-sm space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {action}
    </div>
  );
}

/**
 * A leitura falhou — dentro de uma lista ou cartão. Separado do vazio de
 * propósito: antes uma falha aparecia como "Nenhuma publicação ainda", e quem
 * lia achava que não havia nada.
 */
export function ErrorNotice({
  title = "Não foi possível carregar",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message = error instanceof Error && error.message ? error.message : typeof error === "string" ? error : null;
  return (
    <EmptyNotice
      tone="danger"
      icon={<AlertCircle />}
      title={title}
      description={message ?? "Confira se o painel está rodando e tente de novo."}
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Tentar novamente
          </Button>
        )
      }
      className={className}
    />
  );
}
