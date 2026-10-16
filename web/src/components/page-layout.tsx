import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * O molde das telas do painel, tirado da tela de Projetos: o `PageHeader` no
 * topo e, abaixo, o conteúdo principal com uma coluna lateral de 20rem à
 * direita a partir de 1600 px (`lateral:grid-aside`). Abaixo disso a coluna
 * lateral desce para baixo do conteúdo, em duas colunas no tablet e uma no
 * celular. Todas as telas usam as mesmas medidas: 20 px entre blocos, 16 px
 * entre os cartões da coluna lateral.
 */

/**
 * O conteúdo principal e a coluna lateral.
 *
 * `asideFirst`: abaixo de 1600 px a coluna lateral vem antes do conteúdo —
 * para quando ela é o índice da página (Configurações), que embaixo de tudo
 * não serviria para nada.
 */
export function PageColumns({
  children,
  aside,
  asideLabel,
  asideFirst = false,
  asideClassName,
}: {
  children: ReactNode;
  aside?: ReactNode;
  /** O nome da coluna lateral para o leitor de tela. */
  asideLabel: string;
  asideFirst?: boolean;
  asideClassName?: string;
}) {
  return (
    <div className="grid items-start gap-5 lateral:grid-aside">
      {/* min-w-0: item de grade nasce com min-width auto, e um nome longo
          esticaria a coluna até a tela ganhar rolagem de lado. */}
      <div className="min-w-0 space-y-5">{children}</div>
      {aside && (
        <aside
          aria-label={asideLabel}
          className={cn(
            "grid min-w-0 items-start gap-4 md:grid-cols-2 lateral:grid-cols-1",
            asideFirst && "order-first lateral:order-none",
            asideClassName,
          )}
        >
          {aside}
        </aside>
      )}
    </div>
  );
}

/**
 * O rodapé de uma lista dentro do cartão: quantos itens e qual recorte à
 * esquerda, a hora da última leitura à direita.
 */
export function ListFooter({ children, updatedAt }: { children: ReactNode; updatedAt?: ReactNode }) {
  return (
    <footer className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
      <span>{children}</span>
      {updatedAt && <span>Atualizado às {updatedAt}</span>}
    </footer>
  );
}

/** A tela carregando, no desenho do molde: o título, o conteúdo e a coluna lateral. */
export function PageSkeleton({ aside = true }: { aside?: boolean }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full rounded-lg" />
        <Skeleton className="h-4 w-full max-w-xl rounded-md" />
      </div>
      <PageColumns asideLabel="Carregando" aside={aside ? <Skeleton className="h-64 rounded-xl" /> : undefined}>
        <Skeleton className="h-96 rounded-xl" />
      </PageColumns>
    </div>
  );
}
