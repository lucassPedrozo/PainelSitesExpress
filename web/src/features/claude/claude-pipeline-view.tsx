import { useState } from "react";
import { Check, ChevronRight, Circle, CircleDot, Loader2, Minus } from "lucide-react";
import type { ClaudeCritique, ClaudeSite } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MUITOS_PROBLEMAS,
  critiqueGroups,
  critiqueScores,
  pipelineNote,
  pipelineSteps,
  problemsSummary,
  scoresSentence,
  type PipelineStepState,
} from "./claude-pipeline";

const stepClass: Record<PipelineStepState, string> = {
  done: "border-transparent text-muted-foreground",
  current: "border-info/30 bg-info/10 font-medium text-info",
  todo: "border-transparent text-muted-foreground/70",
  skipped: "border-transparent text-muted-foreground/70 line-through",
};

/** O estado do passo por extenso, para quem não vê a cor nem o ícone. */
const stepText: Record<PipelineStepState, string> = {
  done: "concluído",
  current: "é onde o site está",
  todo: "pela frente",
  skipped: "dispensado",
};

/**
 * Onde o site está na criação: direção, geração, revisão, a crítica e o refino
 * de cada rodada, e a entrega. É uma linha só, que quebra em telas estreitas.
 */
export function ClaudePipelineLine({
  site,
  running,
}: {
  site: ClaudeSite;
  /** Há uma execução deste site rodando agora: o passo atual gira. */
  running: boolean;
}) {
  const passos = pipelineSteps(site.pipeline, site.critica);
  const nota = pipelineNote(site.pipeline, site.critica);

  return (
    <div className="space-y-1.5">
      <ol aria-label="Andamento da criação do site" className="flex flex-wrap items-center gap-x-0.5 gap-y-1 text-xs">
        {passos.map((passo, indice) => (
          <li key={passo.key} className="flex items-center gap-0.5">
            {indice > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />}
            <span
              aria-current={passo.state === "current" ? "step" : undefined}
              className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5", stepClass[passo.state])}
            >
              {passo.state === "done" ? (
                <Check className="size-3 shrink-0 text-success" aria-hidden />
              ) : passo.state === "current" ? (
                running ? (
                  <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <CircleDot className="size-3 shrink-0" aria-hidden />
                )
              ) : passo.state === "skipped" ? (
                <Minus className="size-3 shrink-0" aria-hidden />
              ) : (
                <Circle className="size-3 shrink-0" aria-hidden />
              )}
              {passo.label}
              <span className="sr-only">, {stepText[passo.state]}</span>
            </span>
          </li>
        ))}
      </ol>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

const severityVariant = { grave: "destructive", media: "warning", leve: "outline" } as const;

/** Parecer mais longo que isto começa encurtado, com "Ler o parecer inteiro". */
const PARECER_CURTO = 280;

/**
 * O parecer da última crítica: o veredito, as notas, o resumo e os problemas
 * por gravidade. É o que diz por que o site ainda está sendo trabalhado — ou
 * por que foi dado por pronto. Cabe numa coluna estreita (as notas em duas
 * colunas, o parecer encurtado) e se abre quando tem a largura toda.
 */
export function ClaudeCritiqueCard({ critica }: { critica: ClaudeCritique }) {
  const notas = critiqueScores(critica.notas);
  const grupos = critiqueGroups(critica.problemas);
  const aprovado = critica.veredito === "aprovado";
  const longo = critica.resumo.length > PARECER_CURTO;
  const [inteiro, setInteiro] = useState(false);

  return (
    <section aria-labelledby="claude-critica" className="@container space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 id="claude-critica" className="text-sm font-semibold">
          Última crítica · rodada {critica.rodada}
        </h4>
        <Badge variant={aprovado ? "success" : "warning"}>{aprovado ? "Aprovou o site" : "Pediu refino"}</Badge>
      </div>

      {notas.length > 0 && (
        <div className="space-y-1.5">
          <dl className="grid grid-cols-2 gap-x-4 text-xs @lg:grid-cols-4">
            {notas.map((nota) => (
              <div key={nota.key} className="flex items-baseline justify-between gap-2 border-b py-1">
                <dt className="truncate text-muted-foreground first-letter:uppercase" title={nota.label}>
                  {nota.label}
                </dt>
                <dd className={cn("font-medium tabular-nums", !nota.passing && "text-warning")}>{nota.score}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{scoresSentence(notas)}</p>
        </div>
      )}

      <div>
        <p className={cn("max-w-prose text-sm leading-relaxed text-muted-foreground", longo && !inteiro && "line-clamp-5")}>
          {critica.resumo}
        </p>
        {longo && (
          <Button variant="link" size="xs" className="px-0" aria-expanded={inteiro} onClick={() => setInteiro((valor) => !valor)}>
            {inteiro ? "Mostrar menos" : "Ler o parecer inteiro"}
          </Button>
        )}
      </div>

      {critica.problemas.length > 0 && (
        <details open={critica.problemas.length <= MUITOS_PROBLEMAS} className="text-xs">
          <summary className="cursor-pointer font-medium select-none hover:text-foreground">
            {problemsSummary(critica.problemas)}
          </summary>
          <div className="mt-2 space-y-3">
            {grupos.map((grupo) => (
              <div key={grupo.gravidade} className="space-y-1.5">
                <h5 className="flex items-center gap-2">
                  <Badge variant={severityVariant[grupo.gravidade]}>{grupo.label}</Badge>
                  <span className="tabular-nums text-muted-foreground">{grupo.items.length}</span>
                </h5>
                <ul className="space-y-1.5">
                  {grupo.items.map((problema, indice) => (
                    <li key={indice} className="space-y-0.5 rounded-md border bg-muted/30 px-2.5 py-2 leading-relaxed">
                      <p className="font-medium">{problema.onde}</p>
                      <p>{problema.problema}</p>
                      <p className="text-muted-foreground">Correção pedida: {problema.correcao}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
