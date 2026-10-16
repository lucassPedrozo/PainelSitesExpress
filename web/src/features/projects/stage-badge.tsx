import { Loader2, PenLine } from "lucide-react";
import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { stageOf, toneClass, type StageView } from "./stage";

/**
 * O selo de etapa do projeto — o mesmo na tabela, nos cartões do celular, no
 * diálogo e no Dashboard. Diz onde o projeto está (Material, Geração, Link,
 * Cliente, Publicação, No ar) ou, quando há, o problema dele, em vermelho ou
 * âmbar. Gira enquanto o painel acompanha algo em curso. O porquê vem ao
 * lado, na frase do próximo passo; aqui ele fica no tooltip.
 */
export function StageBadge({
  project,
  view,
  size = "default",
  className,
}: {
  project?: Project;
  /** `sm` em listas densas (o Gantt do Dashboard). */
  size?: "sm" | "default";
  /** Já calculado por quem chama — evita refazer o estado. */
  view?: StageView;
  className?: string;
}) {
  const stage = view ?? (project ? stageOf(project) : null);
  if (!stage) return null;
  const Icon = stage.running ? Loader2 : stage.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-2xs" : "h-6 px-2.5 text-xs",
        toneClass[stage.tone].soft,
        className,
      )}
      title={stage.detail}
    >
      <Icon className={cn("size-3.5 shrink-0", stage.running && "animate-spin")} aria-hidden />
      <span className="truncate">{stage.label}</span>
      {/* Escolhida à mão: a marca diz que o selo não veio do cálculo; o porquê está no tooltip. */}
      {stage.manual && <PenLine className="size-3 shrink-0 opacity-70" aria-hidden />}
      {stage.manual && <span className="sr-only">(definida à mão)</span>}
      {stage.running && <span className="sr-only">(em andamento)</span>}
    </span>
  );
}
