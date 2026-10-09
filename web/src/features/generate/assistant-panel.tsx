import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import type { BriefingAnalysis } from "@/lib/api";
import { analyzeBriefing, fetchAssistantStatus } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * O assistente (Gemini) na tela de geração: lê o briefing como está na caixa
 * e sugere o que completar — resumo, o que falta, instruções prontas para as
 * observações e buscas para o banco de imagens. Mora na coluna do briefing,
 * abaixo das observações que ele preenche.
 *
 * Tudo é sugestão: nada entra no envio ao Lovable sem a pessoa clicar em
 * "Inserir", e a análise não gasta crédito do Lovable (usa a cota gratuita do
 * Gemini, uma chamada por clique, guardada por 24 h). Sem chave no servidor o
 * bloco não aparece.
 */
export function AssistantPanel({
  projectId,
  projectName,
  briefing,
  observations,
  fileNames,
  stockEnabled,
  onInsertObservation,
  onUseImageQueries,
  className,
}: {
  projectId: string;
  projectName: string;
  briefing: string;
  observations: string;
  /** Os arquivos da pasta: o modelo sabe se há logo e fotos sem abri-los. */
  fileNames: string[];
  /** Há chave do Pixabay: as buscas sugeridas podem rodar. */
  stockEnabled: boolean;
  onInsertObservation: (text: string) => void;
  onUseImageQueries: (queries: BriefingAnalysis["imageQueries"]) => void;
  className?: string;
}) {
  const status = useQuery({
    queryKey: queryKeys.assistantStatus,
    queryFn: fetchAssistantStatus,
    staleTime: 5 * 60_000,
  });
  const [analysis, setAnalysis] = useState<BriefingAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  /** Índices das sugestões já inseridas e se as buscas já foram usadas. */
  const [inserted, setInserted] = useState<ReadonlySet<number>>(() => new Set());
  const [searched, setSearched] = useState(false);

  if (!status.data?.configured) return null;

  const temTexto = Boolean(briefing.trim() || observations.trim());

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const resultado = await analyzeBriefing(projectId, { briefing, observations, projectName, fileNames });
      setAnalysis(resultado);
      setInserted(new Set());
      setSearched(false);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "A análise falhou.");
    } finally {
      setBusy(false);
    }
  };

  const inserir = (index: number, text: string) => {
    onInsertObservation(text);
    setInserted((atual) => new Set(atual).add(index));
  };

  const titulo = temTexto
    ? "Lê o briefing e as observações e sugere o que completar. Não gasta crédito do Lovable; usa a cota gratuita do Gemini."
    : "Escreva o briefing ou as observações para analisar.";

  return (
    <div className={cn("space-y-2", className)}>
      {/* Antes da primeira análise, o botão e o que ele faz; depois, o botão
          mora no cabeçalho do painel — o diálogo tem pouca altura a dividir. */}
      {!analysis && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button variant="outline" size="sm" disabled={!temTexto || busy} onClick={() => void run()} title={titulo}>
            {busy ? <Loader2 className="animate-spin" /> : <WandSparkles />}
            {busy ? "Analisando…" : "Analisar com Gemini"}
          </Button>
          {error ? (
            <span className="text-xs text-destructive">{error}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Resumo, o que falta, complementos para as observações e fotos de banco. Nada
              entra no envio sem você inserir.
            </span>
          )}
        </div>
      )}

      {analysis && (
        <section aria-label="Análise do Gemini" className="rounded-lg border bg-muted/30 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
            <Sparkles className="size-4 shrink-0 text-info" />
            <h3 className="font-medium">Análise do Gemini</h3>
            <span className="truncate text-xs text-muted-foreground">
              {analysis.model}
              {analysis.cached && " · guardada de uma análise anterior"}
            </span>
            {error && <span className="text-xs text-destructive">{error}</span>}
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="xs" disabled={!temTexto || busy} onClick={() => void run()} title={titulo}>
                {busy ? <Loader2 className="animate-spin" /> : <WandSparkles />}
                {busy ? "Analisando…" : "Analisar de novo"}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-expanded={open}
                aria-label={open ? "Recolher a análise" : "Mostrar a análise"}
                onClick={() => setOpen((atual) => !atual)}
              >
                <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />
              </Button>
            </div>
          </div>

          {/* Sem rolagem própria: a coluna do briefing já rola, e dois
              rolamentos aninhados cortavam a análise no meio. */}
          {open && (
            <div className="space-y-3 border-t px-3 py-3">
              {analysis.summary && <p>{analysis.summary}</p>}

              {analysis.missing.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">O que falta no briefing</h4>
                  <ul className="space-y-1 text-xs">
                    {analysis.missing.map((item) => (
                      <li key={item.label} className="flex gap-1.5">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" />
                        <span>
                          <b className="font-medium text-foreground">{item.label}:</b> {item.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.suggestions.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-muted-foreground">
                    Sugestões para as observações
                  </h4>
                  <ul className="space-y-1.5">
                    {analysis.suggestions.map((sugestao, index) => {
                      const feita = inserted.has(index);
                      return (
                        <li
                          key={index}
                          className="flex items-start gap-2 rounded-md border bg-card px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">{sugestao.title}</p>
                            <p className="text-xs whitespace-pre-line text-muted-foreground">{sugestao.text}</p>
                          </div>
                          <Button
                            size="xs"
                            variant={feita ? "ghost" : "outline"}
                            disabled={feita}
                            className="shrink-0"
                            onClick={() => inserir(index, sugestao.text)}
                            title="Acrescenta este texto às observações adicionais"
                          >
                            {feita ? <Check /> : <Plus />}
                            {feita ? "Inserida" : "Inserir"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {analysis.imageQueries.length > 0 && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h4 className="text-xs font-medium text-muted-foreground">Fotos de banco sugeridas</h4>
                    <Button
                      size="xs"
                      variant={searched ? "ghost" : "outline"}
                      disabled={!stockEnabled || searched}
                      title={
                        stockEnabled
                          ? "Preenche a aba Banco de imagens com estas buscas e busca agora. Não gasta crédito."
                          : "A busca de imagens de banco está desligada: configure a chave do Pixabay em Configurações → Geração de sites."
                      }
                      onClick={() => {
                        onUseImageQueries(analysis.imageQueries);
                        setSearched(true);
                      }}
                    >
                      {searched ? <Check /> : <ImageIcon />}
                      {searched ? "Buscadas" : "Buscar estas fotos"}
                    </Button>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {analysis.imageQueries.map((busca) => (
                      <li key={`${busca.section}\u0000${busca.term}`}>
                        <Badge variant="outline" className="font-normal" title={busca.reason ?? undefined}>
                          <span className="text-muted-foreground">{busca.section} ·</span> {busca.term}
                          <span className="text-muted-foreground">×{busca.quantity}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-2xs text-muted-foreground">
                Sugestões do modelo: confira antes de inserir. Nada entra no envio sem você
                inserir, e a análise não gasta crédito do Lovable.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
