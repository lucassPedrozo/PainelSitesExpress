import { ChevronRight, Globe, History } from "lucide-react";
import type { Publication } from "@/lib/api/deploy";
import { formatDateTime } from "@/lib/format";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { When } from "@/components/when";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { deployAuthor } from "./deploy-author";

/**
 * Quais domínios estão no ar e desde quando.
 *
 * O painel sabia disso repositório por repositório, consultando o GitHub — e o
 * domínio, que só existe como secret, não voltava de lá. Agora ele é gravado no
 * momento em que a configuração é salva, e cada disparo fica registrado com
 * quem o fez.
 *
 * Vale para a organização inteira, então aparece também antes de escolher um
 * repositório — e é um atalho para ele.
 */
export function PublicationsCard({
  items,
  loading,
  error,
  onRetry,
  selectedRepoFullName,
  onOpen,
}: {
  items: Publication[];
  loading: boolean;
  /** A leitura falhou: não é o mesmo que "nenhuma publicação ainda". */
  error: unknown;
  onRetry: () => void;
  selectedRepoFullName?: string;
  /** Abre o repositório da publicação; ausente, a lista é só leitura. */
  onOpen?: (publication: Publication) => void;
}) {
  return (
    <SectionCard
      title="Publicações"
      description={`Domínios configurados por este painel e o último envio de cada um${
        onOpen ? ". Clique num domínio para abrir o repositório dele." : "."
      }`}
    >
      <div className="overflow-hidden rounded-lg border">
        {error && items.length === 0 ? (
          <ErrorNotice
            title="Não foi possível ler as publicações"
            error={error}
            onRetry={onRetry}
          />
        ) : loading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyNotice
            icon={<History />}
            title="Nenhuma publicação ainda"
            description="O histórico começa na primeira configuração salva."
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const ultimo = item.deploys?.[0];
              const tentativa = item.lastRun;
              const atual = item.repoFullName === selectedRepoFullName;
              const abrivel = Boolean(onOpen) && !atual;
              const nome = item.domain ?? item.repoFullName;
              const autor = deployAuthor(item);
              return (
                <li
                  key={item.repoFullName}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5",
                    abrivel && "cursor-pointer hover:bg-muted/50",
                    atual && "bg-muted/40",
                  )}
                  onClick={abrivel ? () => onOpen?.(item) : undefined}
                >
                  <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    {/* A linha inteira responde ao clique, mas só um botão
                        de verdade entra na ordem do teclado. */}
                    {abrivel ? (
                      <button
                        type="button"
                        title={nome}
                        className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen?.(item);
                        }}
                      >
                        {nome}
                      </button>
                    ) : (
                      <p className="truncate text-sm font-medium" title={nome}>
                        {nome}
                      </p>
                    )}
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={`${item.repoFullName}${item.branch ? ` · ${item.branch}` : ""}`}
                    >
                      {item.repoFullName}
                      {item.branch ? ` · ${item.branch}` : ""}
                    </p>
                    {/* O estado fica no selo; esta linha diz quando e quem. */}
                    <p className="truncate text-xs text-muted-foreground">
                      {item.lastDeployAt ? (
                        <When at={item.lastDeployAt} prefix="último envio" />
                      ) : (
                        "configurado, nunca publicado"
                      )}
                      {autor ? ` · por ${autor}` : ""}
                      {tentativa?.status === "failure" && tentativa.runUrl && (
                        <>
                          {" · "}
                          <a
                            href={tentativa.runUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-destructive underline underline-offset-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            ver o erro
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  {/* O resultado da execução, não o disparo: "no ar" só
                      depois de o GitHub terminar o envio com sucesso. */}
                  {tentativa?.status === "failure" ? (
                    <Badge
                      variant="destructive"
                      className="shrink-0"
                      title={`A última publicação falhou em ${formatDateTime(tentativa.at)}`}
                    >
                      falhou
                    </Badge>
                  ) : tentativa?.status === "pending" ? (
                    <Badge variant="info" className="shrink-0">
                      publicando
                    </Badge>
                  ) : item.lastDeployAt ? (
                    <Badge variant="success" className="shrink-0">
                      no ar
                    </Badge>
                  ) : null}
                  {ultimo?.dryRun && (
                    <Badge variant="secondary" className="shrink-0">
                      último foi simulação
                    </Badge>
                  )}
                  {/* Abrir precisa estar à vista, não só no hover. */}
                  {abrivel && (
                    <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" aria-hidden>
                      Abrir
                      <ChevronRight className="size-3.5" />
                    </span>
                  )}
                  {atual && (
                    <Badge variant="outline" className="shrink-0">
                      aberto
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
