import { Bot, Sparkles } from "lucide-react";
import { Segmented } from "@/components/segmented";

/** Quem escreve o site: o Lovable, pela conta conectada, ou o Claude Code desta máquina. */
export type GenerationEngine = "lovable" | "claude";

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
    <Segmented
      label="Motor da geração"
      value={value}
      onChange={(engine) => !disabled && onChange(engine)}
      className={disabled ? "pointer-events-none opacity-60" : undefined}
      options={[
        {
          value: "lovable",
          label: "Lovable",
          icon: <Sparkles />,
          title: "O Lovable constrói o site a partir do prompt. Gasta crédito do Lovable.",
        },
        {
          value: "claude",
          label: "Claude",
          icon: <Bot />,
          title: "O Claude Code desta máquina escreve o briefing e o site. Consome a assinatura do Claude Code.",
        },
      ]}
    />
  );
}
