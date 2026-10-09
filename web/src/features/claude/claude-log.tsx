import { useEffect, useRef } from "react";
import type { ClaudeLogLine } from "@/lib/api";
import { cn } from "@/lib/utils";

/** O tom de cada tipo de linha. O texto já chega filtrado pelo servidor. */
const lineClass: Record<ClaudeLogLine["tipo"], string> = {
  sessao: "text-muted-foreground",
  etapa: "font-semibold text-info",
  ferramenta: "text-muted-foreground",
  comando: "text-muted-foreground",
  imagem: "text-muted-foreground",
  texto: "text-foreground",
  saida: "text-muted-foreground",
  erro: "text-destructive",
  aviso: "text-warning",
  resultado: "font-semibold text-foreground",
};

/**
 * O log de uma execução do Claude, em linhas legíveis: a etapa que abriu, o
 * comando que rodou, o que o agente disse. Acompanha o fim enquanto a pessoa
 * não rolar para cima para ler algo.
 */
export function ClaudeLog({
  lines,
  live = false,
  empty,
  className,
}: {
  lines: ClaudeLogLine[];
  /** Ainda rodando: novas linhas são anunciadas a leitores de tela. */
  live?: boolean;
  /** O que dizer enquanto não há linha nenhuma. */
  empty: string;
  className?: string;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  /** A pessoa está lendo o fim: só então a tela acompanha as linhas novas. */
  const noFim = useRef(true);

  useEffect(() => {
    const el = caixa.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={caixa}
      role="log"
      aria-live={live ? "polite" : "off"}
      aria-label="Log da execução do Claude"
      tabIndex={0}
      onScroll={(event) => {
        const el = event.currentTarget;
        noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
      className={cn(
        "overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
    >
      {lines.length === 0 ? (
        <p className="font-sans text-muted-foreground">{empty}</p>
      ) : (
        lines.map((linha, indice) => (
          <p key={indice} className={cn("break-words whitespace-pre-wrap", lineClass[linha.tipo])}>
            {linha.texto}
          </p>
        ))
      )}
    </div>
  );
}
