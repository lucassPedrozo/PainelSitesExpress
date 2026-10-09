import { useState } from "react";
import { KeyRound, RotateCw } from "lucide-react";
import type { SettingField } from "@/lib/api/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FIELD_GRID, humanUnit, type FieldDraft } from "./settings-form";

/**
 * Uma linha da tela de configuração: o nome do campo à esquerda, o controle e
 * a ajuda à direita, numa coluna só.
 *
 * Antes os campos ficavam numa grade de duas colunas, com a ajuda de cada um
 * esticando a linha do vizinho, e os segredos empilhavam selo, link e caixa.
 * Numa coluna, o olho desce uma vez; o segredo mostra que está definido e só
 * abre a caixa quando a pessoa pede para trocar.
 */

/** O Select não aceita valor vazio; "vazio" é uma opção de verdade aqui. */
const VAZIO = "__vazio__";

export function FieldRow({
  field,
  draft,
  error,
  onChange,
}: {
  field: SettingField;
  draft: FieldDraft | undefined;
  error: string | undefined;
  onChange: (draft: FieldDraft) => void;
}) {
  if (!draft) return null;
  const id = `campo-${field.key}`;

  return (
    <div className={FIELD_GRID}>
      <div className="space-y-0.5 md:pt-1.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {field.label}
        </Label>
        {/* O nome da variável, para quem lê o .env; o resto é o que o campo
            exige e quando vale. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
          <code className="font-mono">{field.key}</code>
          {field.required && <span>obrigatório</span>}
          {field.restart && (
            <span
              className={cn("inline-flex items-center gap-0.5", field.pendingRestart && "text-warning")}
              title="O painel lê este valor só ao iniciar: a mudança vale depois de reiniciar."
            >
              <RotateCw className="size-3" />
              {field.pendingRestart ? "reinicie para valer" : "vale ao reiniciar"}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Control id={id} field={field} draft={draft} error={error} onChange={onChange} />
        {(error ?? field.help) && (
          <p className={cn("max-w-prose text-xs", error ? "text-destructive" : "text-muted-foreground")}>
            {error ?? field.help}
          </p>
        )}
      </div>
    </div>
  );
}

function Control({
  id,
  field,
  draft,
  error,
  onChange,
}: {
  id: string;
  field: SettingField;
  draft: FieldDraft;
  error: string | undefined;
  onChange: (draft: FieldDraft) => void;
}) {
  if (draft.kind === "secret") {
    return <SecretControl id={id} field={field} draft={draft} error={error} onChange={onChange} />;
  }

  if (field.type === "boolean") {
    const ligado = draft.value === "1";
    return (
      <div className="flex h-8 items-center gap-2.5">
        <Switch id={id} checked={ligado} onCheckedChange={(on) => onChange({ kind: "value", value: on ? "1" : "0" })} />
        <span className="text-sm">{ligado ? "Ligado" : "Desligado"}</span>
      </div>
    );
  }

  if (field.type === "select") {
    const temVazio = field.options?.some((o) => o.value === "");
    return (
      <Select
        value={draft.value === "" ? (temVazio ? VAZIO : undefined) : draft.value}
        onValueChange={(valor) => onChange({ kind: "value", value: valor === VAZIO ? "" : valor })}
      >
        <SelectTrigger id={id} className="w-full max-w-md" aria-invalid={Boolean(error)}>
          <SelectValue placeholder="Padrão" />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((opcao) => (
            <SelectItem key={opcao.value || VAZIO} value={opcao.value || VAZIO} disabled={opcao.disabled}>
              {opcao.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const unidade = field.type === "number" ? humanUnit(field.key, draft.value) : null;
  return (
    <div className="flex max-w-md items-center gap-3">
      <Input
        id={id}
        type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
        inputMode={field.type === "number" ? "numeric" : undefined}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        placeholder={field.placeholder ?? undefined}
        value={draft.value}
        onChange={(event) => onChange({ kind: "value", value: event.target.value })}
        aria-invalid={Boolean(error)}
        className={cn("min-w-0 flex-1", field.type === "number" && "max-w-48 tabular-nums")}
      />
      {/* Milissegundos e bytes lidos como gente: "60000" é "1 min". */}
      {unidade && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">= {unidade}</span>}
    </div>
  );
}

function SecretControl({
  id,
  field,
  draft,
  error,
  onChange,
}: {
  id: string;
  field: SettingField;
  draft: Extract<FieldDraft, { kind: "secret" }>;
  error: string | undefined;
  onChange: (draft: FieldDraft) => void;
}) {
  const [trocando, setTrocando] = useState(false);
  // A caixa aparece quando não há nada gravado, quando a pessoa pediu para
  // trocar, ou quando já digitou algo (um rascunho que sobreviveu).
  const editando = !field.set || trocando || draft.replacement !== "";

  if (draft.clear) {
    return (
      <div className="flex h-8 flex-wrap items-center gap-2">
        <Badge variant="destructive">Será apagada ao salvar</Badge>
        <Button variant="ghost" size="xs" onClick={() => onChange({ ...draft, clear: false })}>
          Desfazer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {field.set && (
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          <Badge variant="success">
            <KeyRound />
            Definida{field.hint ? ` · ${field.hint}` : ""}
          </Badge>
          {!editando && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setTrocando(true);
                // A caixa só existe depois desta renderização.
                requestAnimationFrame(() => document.getElementById(id)?.focus());
              }}
            >
              Trocar
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => onChange({ ...draft, clear: true, replacement: "" })}
          >
            Apagar
          </Button>
        </div>
      )}
      {editando && (
        <div className="flex max-w-md items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            placeholder={field.set ? "Novo valor" : "Cole a chave"}
            value={draft.replacement}
            onChange={(event) => onChange({ ...draft, replacement: event.target.value })}
            aria-invalid={Boolean(error)}
            className="min-w-0 flex-1"
          />
          {field.set && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTrocando(false);
                onChange({ ...draft, replacement: "" });
              }}
            >
              Cancelar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
