import { useState, type ReactNode } from "react";
import type { ClaudeEffort, ClaudeOptions, ClaudeRunChoices } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EFFORT_HELP,
  MODEL_HELP,
  OUTRO_MODELO,
  PADRAO,
  defaultLabel,
  effortLabel,
  modelLabel,
  modelSelection,
} from "./claude-options";
import { errorMessage } from "./claude-text";
import type { useClaudeOptions } from "./use-claude";

/**
 * Uma opção com "padrão do painel": a primeira escolha do seletor não escolhe
 * nada (`null`) e diz o que o padrão é hoje. Embaixo, uma frase com o que a
 * opção muda no site.
 */
export function OptionSelect({
  id,
  label,
  value,
  onChange,
  defaultText,
  options,
  help,
  disabled = false,
  className,
  children,
}: {
  id: string;
  label: string;
  /** `null`: o padrão do painel. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** O que o padrão é hoje, para o rótulo "Padrão do painel (…)". */
  defaultText: string | null;
  options: Array<{ value: string; label: string }>;
  help?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Um controle a mais, entre o seletor e a frase (a caixa de "outro modelo"). */
  children?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select
        value={value ?? PADRAO}
        onValueChange={(escolhido) => onChange(escolhido === PADRAO ? null : escolhido)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PADRAO}>{defaultLabel(defaultText)}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/**
 * O modelo e o esforço das execuções do projeto — ao pedir o briefing e na
 * revisão antes de gerar o site, sempre os mesmos valores gravados.
 *
 * Enquanto as opções do projeto não chegam, a tela não inventa um valor: o
 * pedido segue com o que estiver gravado.
 */
export function RunChoicesFields({
  idPrefix,
  query,
  value,
  onChange,
  disabled = false,
  className,
}: {
  idPrefix: string;
  query: ReturnType<typeof useClaudeOptions>;
  /** O que vale agora: o que a pessoa mexeu ou, sem mexer, o gravado. */
  value: ClaudeRunChoices | null;
  onChange: (choices: ClaudeRunChoices) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (query.error) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Não foi possível ler o modelo e o esforço deste projeto ({errorMessage(query.error)}). O pedido segue com
        os que estiverem gravados.{" "}
        <Button variant="link" size="xs" className="h-auto p-0" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </p>
    );
  }
  if (!query.data || !value) {
    return (
      <div className={cn("grid gap-x-4 gap-y-3 sm:grid-cols-2", className)} aria-busy>
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
    );
  }
  return (
    <Fields
      idPrefix={idPrefix}
      defaults={query.data.defaults}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
    />
  );
}

function Fields({
  idPrefix,
  defaults,
  value,
  onChange,
  disabled,
  className,
}: {
  idPrefix: string;
  defaults: ClaudeOptions["defaults"];
  value: ClaudeRunChoices;
  onChange: (choices: ClaudeRunChoices) => void;
  disabled: boolean;
  className?: string;
}) {
  /** A pessoa pediu a caixa para digitar um id que não está na lista. */
  const [digitando, setDigitando] = useState(false);
  const modelo = modelSelection(value.modelo, defaults.modelos, digitando);

  return (
    <div className={cn("grid gap-x-4 gap-y-3 sm:grid-cols-2", className)}>
      <OptionSelect
        id={`${idPrefix}-modelo`}
        label="Modelo"
        value={modelo === PADRAO ? null : modelo}
        onChange={(escolhido) => {
          setDigitando(escolhido === OUTRO_MODELO);
          onChange({ ...value, modelo: escolhido === OUTRO_MODELO ? null : escolhido });
        }}
        defaultText={modelLabel(defaults.modelo, defaults.modelos)}
        options={[
          ...defaults.modelos.map((item) => ({ value: item.id, label: item.rotulo })),
          { value: OUTRO_MODELO, label: "Outro modelo…" },
        ]}
        help={
          modelo === OUTRO_MODELO
            ? "O id ou o apelido de um modelo do Claude Code. Vazio, vale o padrão do painel; o painel confere o id ao conferir o pedido."
            : MODEL_HELP
        }
        disabled={disabled}
      >
        {modelo === OUTRO_MODELO && (
          <Input
            value={value.modelo ?? ""}
            disabled={disabled}
            spellCheck={false}
            autoCapitalize="none"
            aria-label="Id do modelo"
            placeholder="claude-opus-5-5 ou um apelido, como sonnet"
            onChange={(event) => {
              // Apagar o texto para digitar outro não fecha a caixa.
              setDigitando(true);
              onChange({ ...value, modelo: event.target.value.trim() || null });
            }}
          />
        )}
      </OptionSelect>

      <OptionSelect
        id={`${idPrefix}-esforco`}
        label="Esforço"
        value={value.esforco}
        onChange={(escolhido) => onChange({ ...value, esforco: escolhido as ClaudeEffort | null })}
        defaultText={effortLabel(defaults.esforco)}
        options={defaults.esforcos.map((nivel) => ({ value: nivel, label: effortLabel(nivel) }))}
        help={EFFORT_HELP}
        disabled={disabled}
      />
    </div>
  );
}
