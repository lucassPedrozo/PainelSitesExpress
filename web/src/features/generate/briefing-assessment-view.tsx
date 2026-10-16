import { Check, Minus, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Assessment, AssessmentKey } from "./briefing-assessment";

/**
 * A faixa "O que vai no envio": um selo por item, verde quando está, âmbar
 * quando falta, e as dicas de como completar. Clicar num selo que avisa leva
 * ao lugar onde se completa (observações, anexos ou banco de imagens).
 */
export function BriefingAssessment({
  assessment,
  onGoTo,
  className,
}: {
  assessment: Assessment;
  /** Onde cada aviso se resolve dentro do diálogo. */
  onGoTo: (key: AssessmentKey) => void;
  className?: string;
}) {
  const dicas = assessment.items.filter((item) => item.status === "warn" && item.hint);

  return (
    <section aria-label="O que vai no envio" className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">O que vai no envio</h3>
        <ul className="flex flex-wrap items-center gap-1.5">
          {assessment.items.map((item) => {
            const Icon = item.status === "ok" ? Check : item.status === "warn" ? TriangleAlert : Minus;
            const chip = (
              <Badge
                variant={item.status === "ok" ? "success" : item.status === "warn" ? "warning" : "outline"}
                className={cn(item.status === "neutral" && "text-muted-foreground")}
              >
                <Icon />
                {item.label}
              </Badge>
            );
            return (
              <li key={item.key}>
                {item.status === "warn" ? (
                  <button
                    type="button"
                    className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    // A dica está escrita na lista logo abaixo: o selo só leva até onde se completa.
                    aria-label={`${item.label}: ir até onde se completa`}
                    onClick={() => onGoTo(item.key)}
                  >
                    {chip}
                  </button>
                ) : (
                  chip
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {dicas.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {dicas.map((item) => (
            <li key={item.key} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" />
              <span>
                <b className="font-medium text-foreground">{item.label.split(" · ")[0]}:</b> {item.hint}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
