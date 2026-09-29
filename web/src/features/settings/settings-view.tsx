import { useMemo, useState, useEffect } from "react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RotateCw,
  Save,
  ShieldCheck,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  checkAiKey,
  checkGithubAccess,
  fetchSettings,
  saveSettings,
  SettingsValidationError,
  type AiKeyCheck,
  type EngineStatus,
  type SettingField,
  type SettingSection,
  type SettingsResponse,
} from "@/lib/api/settings";
import type { AccessCheckResult } from "@/lib/api/deploy";
import { queryKeys } from "@/lib/query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toneBadge } from "@/lib/tone";
import { initialDrafts, sectionUpdates, type Drafts, type FieldDraft } from "./settings-form";

/**
 * A tela de configuração: todas as chaves do `.env`, por assunto.
 *
 * Antes só o GitHub e a chave do painel tinham tela (Deploy → Configurações);
 * o resto era editar o arquivo à mão. Aqui cada seção grava sozinha, diz o que
 * só vale depois de reiniciar e testa o que dá para testar (GitHub, chave de
 * IA). Segredos nunca voltam para o navegador: aparece só a dica.
 */

/** O Select não aceita valor vazio; "vazio" é uma opção de verdade aqui. */
const VAZIO = "__vazio__";

export function SettingsView({ focusSection }: { focusSection?: string | null } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.settings, queryFn: fetchSettings });
  const data = query.data;

  // Aberta a partir de outra tela ("Configurar" no Deploy): vai direto à
  // seção que interessa, assim que ela existe na página.
  const temDados = Boolean(data);
  useEffect(() => {
    if (!focusSection || !temDados) return;
    document.getElementById(`config-${focusSection}`)?.scrollIntoView({ block: "start" });
  }, [focusSection, temDados]);

  const idsSecoes = useMemo(() => data?.sections.map((secao) => secao.id) ?? [], [data]);
  const atual = useActiveSection(idsSecoes);
  // Dados novos (carga ou gravação) zeram o rascunho. O rascunho guarda de
  // que resposta nasceu, e é trocado durante a renderização quando ela muda —
  // sem efeito, sem uma renderização a mais com o rascunho velho.
  const [rascunho, setRascunho] = useState<{ fonte?: SettingsResponse; drafts: Drafts }>({ drafts: {} });
  if (data && rascunho.fonte !== data) {
    setRascunho({ fonte: data, drafts: initialDrafts(data.sections) });
  }
  const drafts = rascunho.drafts;
  const setDrafts = (update: (atual: Drafts) => Drafts) =>
    setRascunho((atual) => ({ ...atual, drafts: update(atual.drafts) }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pendentes = useMemo(
    () => data?.sections.flatMap((s) => s.fields.filter((f) => f.pendingRestart)) ?? [],
    [data],
  );

  const salvar = useMutation({
    mutationFn: (updates: Record<string, string | null>) => saveSettings(updates),
    onSuccess: (resposta) => {
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, resposta);
      // O Deploy lê token, organização e FTP destas chaves: sem isto ele
      // mostraria o estado antigo até alguém clicar em Atualizar.
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories });
      setErrors({});
      toast.success(`${resposta.saved.length} ${resposta.saved.length === 1 ? "configuração gravada" : "configurações gravadas"}`, {
        description: resposta.restartRequired.length
          ? `Reinicie o painel para valer: ${resposta.restartRequired.join(", ")}.`
          : "Já está valendo.",
      });
      if (resposta.sessionsClosed > 0) {
        toast.info("A chave do administrador mudou", {
          description: "As sessões abertas foram encerradas. Entre de novo com a chave nova.",
        });
        setTimeout(() => window.location.reload(), 2500);
      }
    },
    onError: (erro) => {
      if (erro instanceof SettingsValidationError) setErrors(erro.fieldErrors);
      toast.error("Nada foi gravado", { description: erro instanceof Error ? erro.message : undefined });
    },
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  if (query.error || !data) {
    return (
      <EmptyState
        tone="danger"
        icon={<AlertTriangle />}
        title="Não foi possível abrir as configurações"
        description={query.error instanceof Error ? query.error.message : "Tente novamente."}
      />
    );
  }

  const setDraft = (key: string, draft: FieldDraft) => {
    setDrafts((atual) => ({ ...atual, [key]: draft }));
    setErrors((atual) => {
      if (!(key in atual)) return atual;
      const { [key]: _removido, ...resto } = atual;
      return resto;
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
      <nav className="hidden lg:block" aria-label="Seções da configuração">
        <ul className="sticky top-24 space-y-0.5 text-sm">
          {data.sections.map((secao) => (
            <li key={secao.id}>
              <a
                href={`#config-${secao.id}`}
                aria-current={atual === secao.id ? "location" : undefined}
                className={cn(
                  "block rounded-md border-l-2 px-3 py-1.5 transition-colors",
                  atual === secao.id
                    ? "border-primary bg-card font-medium text-foreground shadow-xs"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {secao.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-6">
        <PageHeader
          title="Configurações"
          description="Credenciais e integrações do painel. Senhas e chaves nunca voltam para a tela depois de gravadas — aparece só uma dica para reconhecer qual está lá."
        >
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={data.envPath}>
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="truncate">
              Gravado em <code className="rounded bg-muted px-1 font-mono">{data.envPath}</code>
            </span>
          </p>
        </PageHeader>

        {pendentes.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
            <RotateCw className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">Reinicie o painel para estas mudanças valerem</p>
              <p className="text-muted-foreground">{pendentes.map((f) => f.label).join(" · ")}</p>
            </div>
          </div>
        )}

        {data.sections.map((secao) => (
          <SectionCard
            key={secao.id}
            section={secao}
            drafts={drafts}
            errors={errors}
            engines={secao.id === "generation" ? data.engines : null}
            saving={salvar.isPending && salvar.variables !== undefined && Object.keys(salvar.variables).some((k) => secao.fields.some((f) => f.key === k))}
            onDraft={setDraft}
            onDiscard={() =>
              setDrafts((atual) => ({ ...atual, ...initialDrafts([secao]) }))
            }
            onSave={(updates) => salvar.mutate(updates)}
          />
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  drafts,
  errors,
  engines,
  saving,
  onDraft,
  onDiscard,
  onSave,
}: {
  section: SettingSection;
  drafts: Drafts;
  errors: Record<string, string>;
  engines: EngineStatus[] | null;
  saving: boolean;
  onDraft: (key: string, draft: FieldDraft) => void;
  onDiscard: () => void;
  onSave: (updates: Record<string, string | null>) => void;
}) {
  const updates = sectionUpdates(section, drafts);
  const mudancas = Object.keys(updates).length;

  return (
    <Card id={`config-${section.id}`} className="scroll-mt-24 gap-0 p-0">
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug font-semibold">{section.title}</h3>
          <p className="text-sm text-muted-foreground">{section.description}</p>
        </div>
        {mudancas > 0 && (
          <Badge variant="outline" className="border-warning/35 bg-warning/10 text-warning">
            Não salvo
          </Badge>
        )}
      </div>

      {engines && <EnginesList engines={engines} />}

      <div className="grid gap-x-6 gap-y-5 px-5 py-5 md:grid-cols-2">
        {section.fields.map((campo) => (
          <FieldInput
            key={campo.key}
            field={campo}
            draft={drafts[campo.key]}
            error={errors[campo.key]}
            onChange={(draft) => onDraft(campo.key, draft)}
          />
        ))}
      </div>

      {section.id === "github" && <GithubTest drafts={drafts} />}
      {section.id === "ai" && <AiTest drafts={drafts} />}

      {/* Salvar mora no rodapé, perto de onde a pessoa acabou de editar —
          no topo ele sumia da tela nas seções longas. */}
      {mudancas > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-muted/40 px-5 py-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {mudancas} {mudancas === 1 ? "alteração não salva" : "alterações não salvas"} nesta seção
          </span>
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>
            <Undo2 />
            Descartar
          </Button>
          <Button onClick={() => onSave(updates)} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Salvar seção
          </Button>
        </div>
      )}
    </Card>
  );
}

function FieldInput({
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

  let controle;
  if (draft.kind === "secret") {
    controle = (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {draft.clear ? (
            <Badge variant="destructive">Será apagada ao salvar</Badge>
          ) : field.set ? (
            <Badge variant="secondary">
              <KeyRound className="size-3" />
              Definida {field.hint ? `· ${field.hint}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">Não definida</Badge>
          )}
          {field.set && (
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => onChange({ ...draft, clear: !draft.clear, replacement: "" })}
            >
              {draft.clear ? "Desfazer" : "Apagar"}
            </button>
          )}
        </div>
        {!draft.clear && (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            placeholder={field.set ? "Novo valor (vazio mantém o atual)" : "Valor"}
            value={draft.replacement}
            onChange={(event) => onChange({ ...draft, replacement: event.target.value })}
            aria-invalid={Boolean(error)}
          />
        )}
      </div>
    );
  } else if (field.type === "boolean") {
    controle = (
      <div className="flex items-center gap-2 pt-1">
        <Switch
          id={id}
          checked={draft.value === "1"}
          onCheckedChange={(ligado) => onChange({ kind: "value", value: ligado ? "1" : "0" })}
        />
        <span className="text-sm text-muted-foreground">{draft.value === "1" ? "Ligado" : "Desligado"}</span>
      </div>
    );
  } else if (field.type === "select") {
    const temVazio = field.options?.some((o) => o.value === "");
    controle = (
      <Select
        value={draft.value === "" ? (temVazio ? VAZIO : undefined) : draft.value}
        onValueChange={(valor) => onChange({ kind: "value", value: valor === VAZIO ? "" : valor })}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
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
  } else {
    controle = (
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
      />
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* O nome da variável fica no título: útil a quem edita o .env, ruído
            para quem só usa a tela. */}
        <Label htmlFor={id} title={field.key}>
          {field.label}
        </Label>
        {field.required && <span className="text-2xs text-muted-foreground">· obrigatório</span>}
        {field.restart && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-2xs",
              field.pendingRestart ? "text-warning" : "text-muted-foreground",
            )}
            title="O painel lê este valor só ao iniciar: a mudança vale depois de reiniciar."
          >
            <RotateCw className="size-3" />
            {field.pendingRestart ? "reinicie para valer" : "ao reiniciar"}
          </span>
        )}
      </div>
      {controle}
      {(error ?? field.help) && (
        <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? field.help}
        </p>
      )}
    </div>
  );
}

function EnginesList({ engines }: { engines: EngineStatus[] }) {
  return (
    <ul className="grid gap-3 border-b px-5 py-4 md:grid-cols-2">
      {engines.map((motor) => (
        <li key={motor.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">{motor.label}</span>
            <Badge
              variant="outline"
              className={cn("ml-auto", motor.available ? toneBadge.success : motor.id === "own" ? toneBadge.info : toneBadge.warning)}
            >
              {motor.available ? "Disponível" : motor.id === "own" ? "Em preparação" : "Indisponível"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{motor.description}</p>
          {motor.reason && <p className="mt-1 text-xs text-warning">{motor.reason}</p>}
          {motor.id === "own" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Modelo de IA:{" "}
              {motor.details.aiConfigured
                ? `${String(motor.details.provider)} · ${String(motor.details.model)}`
                : "chave não configurada"}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

const valorDe = (drafts: Drafts, key: string) => {
  const draft = drafts[key];
  if (!draft) return undefined;
  if (draft.kind === "secret") return draft.replacement.trim() || undefined;
  return draft.value.trim() || undefined;
};

function GithubTest({ drafts }: { drafts: Drafts }) {
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<AccessCheckResult | null>(null);

  const testar = async () => {
    setTestando(true);
    try {
      setResultado(
        await checkGithubAccess({ token: valorDe(drafts, "GITHUB_TOKEN"), organization: valorDe(drafts, "GITHUB_ORG") }),
      );
    } catch (erro) {
      toast.error("Falha ao testar", { description: erro instanceof Error ? erro.message : undefined });
    } finally {
      setTestando(false);
    }
  };

  return (
    <TestFooter
      label="Testar o acesso ao GitHub"
      hint="Usa o token digitado acima ou, vazio, o gravado. Só lê."
      testing={testando}
      onTest={() => void testar()}
    >
      {resultado && (
        <ul className="space-y-1 text-xs">
          {resultado.identity && <li className="text-muted-foreground">Conta: {resultado.identity.login}</li>}
          {resultado.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-1.5">
              {check.ok ? (
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-px size-3.5 shrink-0 text-destructive" />
              )}
              <span>
                <b className="font-medium">{check.label}:</b> {check.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TestFooter>
  );
}

function AiTest({ drafts }: { drafts: Drafts }) {
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<AiKeyCheck | null>(null);

  const testar = async () => {
    setTestando(true);
    try {
      setResultado(
        await checkAiKey({
          provider: valorDe(drafts, "AI_PROVIDER"),
          apiKey: valorDe(drafts, "AI_API_KEY"),
          model: valorDe(drafts, "AI_MODEL"),
        }),
      );
    } catch (erro) {
      toast.error("Falha ao testar", { description: erro instanceof Error ? erro.message : undefined });
    } finally {
      setTestando(false);
    }
  };

  return (
    <TestFooter
      label="Testar a chave"
      hint="Lista os modelos que a chave alcança — não gera nada e não custa nada."
      testing={testando}
      onTest={() => void testar()}
    >
      {resultado &&
        (resultado.ok ? (
          <p className="flex items-start gap-1.5 text-xs">
            <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
            <span>
              Chave válida · {resultado.models.length} modelos disponíveis ·{" "}
              {resultado.modelAvailable
                ? `${resultado.model} disponível para esta chave.`
                : `${resultado.model} não aparece para esta chave — escolha outro modelo.`}
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <XCircle className="mt-px size-3.5 shrink-0" />
            {resultado.reason}
          </p>
        ))}
    </TestFooter>
  );
}

function TestFooter({
  label,
  hint,
  testing,
  onTest,
  children,
}: {
  label: string;
  hint: string;
  testing: boolean;
  onTest: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 border-t bg-muted/30 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {label}
        </Button>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * A seção que está na tela, para o menu lateral marcar onde a pessoa está —
 * a primeira cujo topo já passou do cabeçalho fixo.
 */
function useActiveSection(ids: string[]) {
  const [atual, setAtual] = useState<string | null>(null);
  useEffect(() => {
    if (ids.length === 0) return;
    const elementos = ids
      .map((id) => document.getElementById(`config-${id}`))
      .filter((el): el is HTMLElement => el !== null);
    const visiveis = new Map<string, boolean>();
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          visiveis.set(entrada.target.id.replace(/^config-/, ""), entrada.isIntersecting);
        }
        const primeira = ids.find((id) => visiveis.get(id));
        if (primeira) setAtual(primeira);
      },
      // Uma faixa logo abaixo do cabeçalho: a seção que a cruza é a atual.
      { rootMargin: "-96px 0px -60% 0px" },
    );
    elementos.forEach((el) => observador.observe(el));
    return () => observador.disconnect();
  }, [ids]);
  return atual ?? ids[0] ?? null;
}
