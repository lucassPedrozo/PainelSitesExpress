import { ClaudeIcon, LovableIcon } from "@/components/brand-icons";
import { Segmented } from "@/components/segmented";
import { cn } from "@/lib/utils";

/** Quem escreve o site: o Lovable, pela conta conectada, ou o Claude Code desta máquina. */
export type GenerationEngine = "lovable" | "claude";

/** O que cada motor gasta — à vista ao lado da escolha, e não só no hover. */
const engineCost: Record<GenerationEngine, string> = {
  lovable: "Gasta crédito do Lovable",
  claude: "Usa a assinatura do Claude Code",
};

/**
 * A escolha do motor, no cabeçalho de quem gera — vale só para aquela geração
 * (ou aquele lote). O que vem marcado é o padrão das Configurações.
 */
export function EngineChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: GenerationEngine;
  onChange: (engine: GenerationEngine) => void;
  /** No meio de um envio em lote, o motor não muda. */
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* O fieldset desligado desliga os botões de verdade: sem clique, sem
          foco pelo teclado. Antes era só um véu de opacidade. */}
      <fieldset disabled={disabled} className={cn("m-0 min-w-0 border-0 p-0", disabled && "opacity-60")}>
        <Segmented
          label="Motor da geração"
          value={value}
          onChange={onChange}
          options={[
            {
              value: "lovable",
              label: "Lovable",
              icon: <LovableIcon />,
              title: "O Lovable constrói o site a partir do prompt. Gasta crédito do Lovable.",
            },
            {
              value: "claude",
              label: "Claude",
              icon: <ClaudeIcon />,
              title: "O Claude Code desta máquina escreve o briefing e o site. Consome a assinatura do Claude Code.",
            },
          ]}
        />
      </fieldset>
      <span className="text-xs text-muted-foreground">{engineCost[value]}</span>
    </div>
  );
}
