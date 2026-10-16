import { useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import type { ClaudeEffort, ClaudeOptions, ClaudeRunChoices } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EFFORT_HELP,
  EFFORT_HINT,
  MODEL_HELP,
  MODEL_HINT,
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
 * A explicação longa de uma opção, no "?" ao lado do rótulo: no hover vem
 * como dica; no toque e no teclado, o clique abre o texto inteiro.
 */
export function HelpTip({ children }: { children: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          // Genérico de propósito: com o nome do campo, o botão disputaria o
          // rótulo com o próprio campo.
          aria-label="Mais sobre esta opção"
          title={children}
        >
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** O rótulo de um campo, com o "?" da explicação longa quando há. */
export function OptionLabel({ id, label, help }: { id: string; label: string; help?: string }) {
  return (
    // A dica fica fora do <label>: dentro, o nome dela entraria no nome do campo.
    <div className="flex min-h-6 items-center gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {help && <HelpTip>{help}</HelpTip>}
    </div>
  );
}

/**
 * Uma opção com "padrão do painel": a primeira escolha do seletor não escolhe
 * nada (`null`) e diz o que o padrão é hoje. Embaixo, uma frase curta com o
 * que a opção muda no site; a explicação inteira fica no "?" do rótulo.
 */
export function OptionSelect({
  id,
  label,
  value,
  onChange,
  defaultText,
  options,
  help,
  moreHelp,
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
  /** Uma frase curta, à vista. */
  help?: ReactNode;
  /** A explicação longa, no "?" ao lado do rótulo. */
  moreHelp?: string;
  disabled?: boolean;
  className?: string;
  /** Um controle a mais, entre o seletor e a frase (a caixa de "outro modelo"). */
  children?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <OptionLabel id={id} label={label} help={moreHelp} />
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
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
        <p>
          Não foi possível ler o modelo e o esforço deste projeto ({errorMessage(query.error)}). O pedido segue
          com os que estiverem gravados.
        </p>
        <Button type="button" variant="link" size="xs" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
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
            : MODEL_HINT
        }
        moreHelp={MODEL_HELP}
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
        help={EFFORT_HINT}
        moreHelp={EFFORT_HELP}
        disabled={disabled}
      />
    </div>
  );
}
