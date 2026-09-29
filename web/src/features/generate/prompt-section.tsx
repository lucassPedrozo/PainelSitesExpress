import { ExternalLink } from "lucide-react";
import type { BuildPackage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { OtherBriefsNotice } from "@/features/projects/other-briefs-notice";
import type { SelectionSummary } from "./generation-prompt";

/** A coluna do prompt: o briefing editável e as observações do operador. */
export function PromptSection({
  pkg,
  prompt,
  onPromptChange,
  observations,
  onObservationsChange,
  summary,
}: {
  pkg: BuildPackage;
  prompt: string;
  onPromptChange: (value: string) => void;
  observations: string;
  onObservationsChange: (value: string) => void;
  summary: SelectionSummary;
}) {
  return (
    // min-w-0: sem isso o `min-width: auto` do grid deixa os nomes longos de
    // arquivo esticarem a coluna e vazarem do diálogo.
    <section className="flex min-h-0 min-w-0 flex-col gap-2 p-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Prompt</h3>
        {pkg.prompt.file ? (
          <a
            href={pkg.prompt.file.webViewLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
            title={pkg.prompt.file.name}
          >
            <ExternalLink className="size-3" />
            <span className="truncate">{pkg.prompt.file.name}</span>
          </a>
        ) : (
          <Badge variant="secondary">
            Sem “Informações do Site” — use as observações
          </Badge>
        )}
      </div>
      <OtherBriefsNotice others={pkg.prompt.others} />

      <Textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Descreva o site que o Lovable deve criar..."
        // Numa coluna só (janela estreita) o flex-1 não tem altura para dividir
        // e o prompt de 16 mil caracteres cabia em quatro linhas.
        className="max-h-[45vh] min-h-56 flex-1 resize-none overflow-y-auto font-mono text-xs leading-relaxed lg:max-h-none lg:min-h-0"
      />

      <div className="space-y-1.5">
        <Label htmlFor="observacoes" className="text-xs">
          Observações adicionais
        </Label>
        <Textarea
          id="observacoes"
          rows={3}
          value={observations}
          onChange={(event) => onObservationsChange(event.target.value)}
          placeholder={
            pkg.prompt.found
              ? "Instruções suas, além do briefing: paleta, seções a evitar, referências…"
              : "Sem briefing no Drive — descreva aqui o site que o Lovable deve criar."
          }
          className="resize-none text-xs leading-relaxed"
        />
        <p className="text-xs text-muted-foreground">
          Vão ao Lovable como um bloco próprio, depois do briefing. O arquivo do
          Drive não é alterado.
        </p>
      </div>

      <p
        className={cn(
          "text-xs tabular-nums text-muted-foreground",
          summary.promptTooLong && "text-destructive",
        )}
      >
        {summary.promptChars.toLocaleString("pt-BR")} de{" "}
        {pkg.limits.maxPromptChars.toLocaleString("pt-BR")} caracteres
        {observations.trim() &&
          ` · ${observations.trim().length.toLocaleString("pt-BR")} de observações`}
      </p>
    </section>
  );
}
