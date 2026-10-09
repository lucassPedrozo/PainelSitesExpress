import { useState } from "react";
import { Braces, ListChecks, Plus, Trash2 } from "lucide-react";
import type { ClaudeBriefing } from "@/lib/api";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BRIEFING_GROUPS,
  briefingToJson,
  fieldValue,
  listToLines,
  parseBriefingJson,
  servicesOf,
  withDifferentials,
  withField,
  withServices,
  type Service,
} from "./briefing-fields";

/**
 * O editor do briefing: os campos que mais se corrigem à mão num formulário,
 * e o documento inteiro em JSON para o resto (depoimentos, perguntas, fotos).
 * As duas vistas editam o mesmo rascunho; quem grava é a tela que o usa.
 */
export function BriefingEditor({
  briefing,
  onChange,
  disabled = false,
  onInvalidChange,
}: {
  briefing: ClaudeBriefing;
  onChange: (briefing: ClaudeBriefing) => void;
  disabled?: boolean;
  /** O texto da vista em JSON não abre: a tela não deixa gravar nem gerar. */
  onInvalidChange: (reason: string | null) => void;
}) {
  const [mode, setMode] = useState<"fields" | "json">("fields");
  /** O texto da vista em JSON, enquanto ela está aberta. */
  const [json, setJson] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  /**
   * O texto dos diferenciais como foi digitado. A lista gravada não guarda
   * linha vazia; sem este rascunho, o Enter no fim do texto sumiria na hora.
   */
  const [diferenciais, setDiferenciais] = useState(() => listToLines(briefing.diferenciais));

  const trocarVista = (next: "fields" | "json") => {
    // Com o JSON quebrado, os campos mostrariam o rascunho de antes dele.
    if (next === "fields" && erro) return;
    if (next === "json") setJson(briefingToJson(briefing));
    else setDiferenciais(listToLines(briefing.diferenciais));
    setMode(next);
  };

  const editarJson = (texto: string) => {
    setJson(texto);
    const lido = parseBriefingJson(texto);
    const motivo = lido.ok ? null : lido.error;
    setErro(motivo);
    onInvalidChange(motivo);
    if (lido.ok) onChange(lido.value);
  };

  const servicos = servicesOf(briefing);
  const trocarServico = (indice: number, patch: Partial<Service>) =>
    onChange(withServices(briefing, servicos.map((servico, i) => (i === indice ? { ...servico, ...patch } : servico))));

  return (
    <div className="space-y-3">
      <Segmented
        label="Como editar o briefing"
        value={mode}
        onChange={trocarVista}
        options={[
          { value: "fields", label: "Campos", icon: <ListChecks />, title: erro ? "Corrija o JSON para voltar aos campos" : undefined },
          { value: "json", label: "JSON", icon: <Braces /> },
        ]}
      />

      {mode === "json" ? (
        <div className="space-y-1.5">
          <Label htmlFor="briefing-json" className="sr-only">
            Briefing em JSON
          </Label>
          <Textarea
            id="briefing-json"
            value={json}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={Boolean(erro)}
            onChange={(event) => editarJson(event.target.value)}
            className="max-h-[50vh] min-h-64 resize-y overflow-y-auto font-mono text-xs leading-relaxed"
          />
          <p className={cn("text-xs", erro ? "text-destructive" : "text-muted-foreground")}>
            {erro ?? "O documento inteiro, como o motor o lê. Campo sem informação fica de fora: apague a chave."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {BRIEFING_GROUPS.map((grupo) => (
            <fieldset key={grupo.title} className="space-y-2" disabled={disabled}>
              <legend className="text-xs font-medium text-muted-foreground">{grupo.title}</legend>
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {grupo.fields.map((campo) => {
                  const id = `briefing-${campo.path}`;
                  const valor = fieldValue(briefing, campo.path);
                  return (
                    <div key={campo.path} className={cn("space-y-1", campo.multiline && "sm:col-span-2")}>
                      <Label htmlFor={id} className="text-xs">
                        {campo.label}
                        {campo.required && <span className="text-muted-foreground"> · obrigatório</span>}
                      </Label>
                      {campo.multiline ? (
                        <Textarea
                          id={id}
                          rows={3}
                          value={valor}
                          placeholder={campo.placeholder}
                          aria-invalid={campo.required && !valor.trim()}
                          onChange={(event) => onChange(withField(briefing, campo.path, event.target.value))}
                          className="max-h-48 resize-y text-sm leading-relaxed"
                        />
                      ) : (
                        <Input
                          id={id}
                          value={valor}
                          placeholder={campo.placeholder}
                          aria-invalid={campo.required && !valor.trim()}
                          onChange={(event) => onChange(withField(briefing, campo.path, event.target.value))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-xs font-medium text-muted-foreground">Serviços · pelo menos um</legend>
            <ul className="space-y-2">
              {servicos.map((servico, indice) => (
                <li key={indice} className="grid gap-2 sm:grid-cols-[1fr_1.6fr_9rem_auto]">
                  <Input
                    value={servico.nome ?? ""}
                    placeholder="Nome do serviço"
                    aria-label={`Nome do serviço ${indice + 1}`}
                    aria-invalid={!servico.nome?.trim()}
                    onChange={(event) => trocarServico(indice, { nome: event.target.value })}
                  />
                  <Input
                    value={servico.descricao ?? ""}
                    placeholder="Uma frase"
                    aria-label={`Descrição do serviço ${indice + 1}`}
                    onChange={(event) => trocarServico(indice, { descricao: event.target.value })}
                  />
                  <Input
                    value={servico.preco ?? ""}
                    placeholder="Preço, se houver"
                    aria-label={`Preço do serviço ${indice + 1}`}
                    onChange={(event) => trocarServico(indice, { preco: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    aria-label={`Tirar o serviço ${indice + 1}`}
                    title="Tirar este serviço"
                    onClick={() => onChange(withServices(briefing, servicos.filter((_, i) => i !== indice)))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...briefing, servicos: [...servicos, { nome: "" }] })}
            >
              <Plus />
              Serviço
            </Button>
          </fieldset>

          <fieldset className="space-y-1" disabled={disabled}>
            <Label htmlFor="briefing-diferenciais" className="text-xs font-medium text-muted-foreground">
              Diferenciais · um fato por linha
            </Label>
            <Textarea
              id="briefing-diferenciais"
              rows={3}
              value={diferenciais}
              onChange={(event) => {
                setDiferenciais(event.target.value);
                onChange(withDifferentials(briefing, event.target.value));
              }}
              className="max-h-48 resize-y text-sm leading-relaxed"
            />
          </fieldset>

          <p className="text-xs text-muted-foreground">
            Depoimentos, perguntas frequentes, números e a lista de fotos ficam na vista em JSON.
          </p>
        </div>
      )}
    </div>
  );
}
