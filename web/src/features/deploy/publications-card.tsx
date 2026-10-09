import { Globe, History, Loader2 } from "lucide-react";
import type { Publication } from "@/lib/api/deploy";
import { formatDateTime, relativeTime } from "@/lib/format";
import { EmptyNotice } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  selectedRepoFullName,
  onOpen,
}: {
  items: Publication[];
  loading: boolean;
  selectedRepoFullName?: string;
  /** Abre o repositório da publicação; ausente, a lista é só leitura. */
  onOpen?: (publication: Publication) => void;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Publicações</CardTitle>
          {loading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <CardDescription>
          Domínios configurados por este painel e o último envio de cada um
          {onOpen ? " — clique num domínio para abrir o repositório dele." : "."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          {loading ? (
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
                return (
                  <li
                    key={item.repoFullName}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5",
                      onOpen && !atual && "cursor-pointer hover:bg-muted/50",
                      atual && "bg-muted/40",
                    )}
                    onClick={onOpen && !atual ? () => onOpen(item) : undefined}
                    title={
                      onOpen && !atual ? "Abrir este repositório" : undefined
                    }
                  >
                    <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      {/* A linha inteira responde ao clique, mas só um botão
                          de verdade entra na ordem do teclado. */}
                      {onOpen && !atual ? (
                        <button
                          type="button"
                          className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(item);
                          }}
                        >
                          {item.domain ?? item.repoFullName}
                        </button>
                      ) : (
                        <p className="truncate text-sm font-medium">
                          {item.domain ?? item.repoFullName}
                        </p>
                      )}
                      <p className="truncate text-xs text-muted-foreground">
                        {item.repoFullName}
                        {item.branch ? ` · ${item.branch}` : ""}
                      </p>
                      {/* O resultado da execução, não o disparo: "no ar" só
                          depois de o GitHub terminar o envio com sucesso. */}
                      {tentativa?.status === "failure" && (
                        <p className="truncate text-xs text-destructive">
                          última publicação falhou {relativeTime(tentativa.at)}
                          {tentativa.runUrl && (
                            <>
                              {" · "}
                              <a
                                href={tentativa.runUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline underline-offset-2"
                                onClick={(event) => event.stopPropagation()}
                              >
                                ver erro
                              </a>
                            </>
                          )}
                        </p>
                      )}
                      {tentativa?.status === "pending" && (
                        <p className="truncate text-xs text-info">
                          publicando agora…
                        </p>
                      )}
                      <p className="truncate text-xs text-muted-foreground">
                        {item.lastDeployAt ? (
                          <span title={formatDateTime(item.lastDeployAt)}>
                            último envio {relativeTime(item.lastDeployAt)}
                          </span>
                        ) : (
                          "configurado, nunca publicado"
                        )}
                        {/* O envio pode ter vindo de um push do Lovable, sem
                            ninguém do painel por trás. */}
                        {tentativa?.event === "push"
                          ? " · por edição no Lovable"
                          : ultimo?.by
                            ? ` · por ${ultimo.by}`
                            : ""}
                      </p>
                    </div>
                    {tentativa?.status === "failure" ? (
                      <Badge variant="destructive" className="shrink-0">
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
