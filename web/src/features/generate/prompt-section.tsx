import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { BuildPackage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { OtherBriefsNotice } from "@/features/projects/other-briefs-notice";
import type { SelectionSummary } from "./generation-prompt";

/** O campo das observações — a faixa "O que vai no envio" foca por este id. */
export const OBSERVATIONS_INPUT_ID = "observacoes";

/** A coluna do prompt: o briefing editável e as observações do operador. */
export function PromptSection({
  pkg,
  prompt,
  onPromptChange,
  observations,
  onObservationsChange,
  summary,
  assistant,
}: {
  pkg: BuildPackage;
  prompt: string;
  onPromptChange: (value: string) => void;
  observations: string;
  onObservationsChange: (value: string) => void;
  summary: SelectionSummary;
  /**
   * O assistente (Gemini), logo abaixo das observações que ele preenche. Na
   * faixa do topo ele empurrava as duas colunas para fora da tela; aqui a
   * coluna rola, e a dos anexos continua inteira.
   */
  assistant?: ReactNode;
}) {
  return (
    // min-w-0: sem isso o `min-width: auto` do grid deixa os nomes longos de
    // arquivo esticarem a coluna e vazarem do diálogo. Em duas colunas a seção
    // rola por dentro: com a análise aberta e observações longas, o conteúdo
    // passava da altura e vazava por cima do rodapé.
    <section className="flex min-h-0 min-w-0 flex-col gap-2 p-6 lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="briefing" className="shrink-0 text-sm font-medium whitespace-nowrap">
          Briefing do cliente
        </Label>
        {pkg.prompt.file ? (
          <a
            href={pkg.prompt.file.webViewLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
            title={`Abrir “${pkg.prompt.file.name}” no Drive`}
          >
            <ExternalLink className="size-3" />
            <span className="truncate">{pkg.prompt.file.name}</span>
          </a>
        ) : (
          <Badge variant="warning">Sem “Informações do Site” no Drive</Badge>
        )}
      </div>
      <OtherBriefsNotice others={pkg.prompt.others} />

      {/* O texto do cliente, em sans como no "Ver prompt": em monoespaçada de
          12 px os parágrafos dele viravam código. */}
      <Textarea
        id="briefing"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={
          pkg.prompt.found
            ? "O texto do briefing, como será enviado."
            : "Sem briefing no Drive. Descreva o site nas observações abaixo — ou cole aqui."
        }
        // Numa coluna só (janela estreita) o flex-1 não tem altura para dividir
        // e o prompt de 16 mil caracteres cabia em quatro linhas. Em duas
        // colunas, uma altura mínima: sem ela, as observações crescendo
        // esmagavam o briefing até uma fresta.
        className="max-h-[45vh] min-h-56 flex-1 resize-none overflow-y-auto text-sm leading-relaxed lg:max-h-none lg:min-h-40"
      />

      <div className="space-y-1.5">
        <Label htmlFor={OBSERVATIONS_INPUT_ID} className="text-sm font-medium">
          Observações adicionais
        </Label>
        <Textarea
          id={OBSERVATIONS_INPUT_ID}
          rows={3}
          value={observations}
          onChange={(event) => onObservationsChange(event.target.value)}
          placeholder={
            pkg.prompt.found
              ? "O que o briefing não diz: serviços, público, paleta, seções a evitar, referências…"
              : "Descreva o site: empresa, serviços, público, contato, tom."
          }
          // A caixa cresce com o texto, mas até um teto: depois disso rola por
          // dentro, em vez de empurrar o resto da coluna para fora.
          className="max-h-48 resize-none overflow-y-auto text-sm leading-relaxed"
        />
        <p className="text-xs text-muted-foreground">
          Vão ao Lovable como um bloco próprio, depois do briefing. O arquivo do
          Drive não é alterado.
        </p>
      </div>

      {assistant}

      <p
        className={cn(
          "text-xs tabular-nums text-muted-foreground",
          summary.promptTooLong && "text-destructive",
        )}
      >
        {summary.promptChars.toLocaleString("pt-BR")} de{" "}
        {pkg.limits.maxPromptChars.toLocaleString("pt-BR")} caracteres no envio
        {observations.trim() &&
          ` · ${observations.trim().length.toLocaleString("pt-BR")} de observações`}
      </p>
    </section>
  );
}
