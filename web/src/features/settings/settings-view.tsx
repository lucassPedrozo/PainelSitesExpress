import { useMemo, useState, useEffect } from "react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCw, Save, ShieldCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  fetchSettings,
  saveSettings,
  SettingsValidationError,
  type EngineStatus,
  type SettingSection,
  type SettingsResponse,
} from "@/lib/api/settings";
import { pluralize } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FieldRow } from "./settings-field";
import { FIELD_GRID, initialDrafts, sectionUpdates, type Drafts, type FieldDraft } from "./settings-form";
import { ClaudeStateRow, ClaudeTest } from "./settings-claude";
import { GeminiTest, GithubTest } from "./settings-tests";

/**
 * A tela de configuração: todas as chaves do `.env`, por assunto.
 *
 * Cada seção é um cartão com os campos numa coluna só — nome à esquerda,
 * controle e ajuda à direita —, o estado da integração no título e o teste
 * que ela tem (GitHub, Gemini, Claude) no rodapé. A seção grava sozinha
 * e diz o que só vale depois de reiniciar. Segredos nunca voltam para o
 * navegador: aparece só a dica.
 */

/** Seções cujo estado é "configurado" quando os segredos delas estão gravados. */
const SECOES_COM_ESTADO = new Set(["assistant", "github", "dev-area", "shortlinks"]);

function sectionStatus(section: SettingSection, engines: EngineStatus[]) {
  // O motor Claude não tem segredo: o estado dele é o pacote e a trava.
  if (section.id === "claude") {
    const motor = engines.find((engine) => engine.id === "claude");
    if (!motor) return null;
    if (!motor.available) return { label: "Não instalado", variant: "warning" as const };
    return motor.details.enabled
      ? { label: "Uso liberado", variant: "success" as const }
      : { label: "Uso desligado", variant: "outline" as const };
  }
  if (!SECOES_COM_ESTADO.has(section.id)) return null;
  const segredos = section.fields.filter((campo) => campo.type === "secret");
  const definidos = segredos.filter((campo) => campo.set).length;
  if (segredos.length === 0) return null;
  if (definidos === segredos.length) return { label: "Configurado", variant: "success" as const };
  if (definidos === 0) return { label: "Não configurado", variant: "outline" as const };
  return { label: "Incompleto", variant: "warning" as const };
}

export function SettingsView({ focusSection }: { focusSection?: string | null } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.settings, queryFn: fetchSettings });
  const data = query.data;

  // Aberta a partir de outra tela ("GitHub e token" no Deploy): vai direto à
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
      // O Deploy lê token, organização e FTP destas chaves; a geração lê o
      // Pixabay e o Gemini. Sem isto, cada tela mostraria o estado antigo.
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stockImagesStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assistantStatus });
      // A trava, o modelo e os programas do motor Claude valem na hora.
      void queryClient.invalidateQueries({ queryKey: queryKeys.claudeStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.claudeDiagnostics });
      // E os padrões dele são o que cada projeto mostra em "Padrão do painel (…)".
      void queryClient.invalidateQueries({ queryKey: ["claude", "options"] });
      void queryClient.invalidateQueries({ queryKey: ["claude", "project"] });
      setErrors({});
      toast.success(pluralize(resposta.saved.length, "configuração gravada", "configurações gravadas"), {
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

  const comMudancas = new Set(
    data.sections.filter((secao) => Object.keys(sectionUpdates(secao, drafts)).length > 0).map((secao) => secao.id),
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="hidden lg:block" aria-label="Seções da configuração">
        <ul className="sticky top-24 space-y-0.5 text-sm">
          {data.sections.map((secao) => (
            <li key={secao.id}>
              <a
                href={`#config-${secao.id}`}
                aria-current={atual === secao.id ? "location" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors",
                  atual === secao.id
                    ? "bg-card font-medium text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="truncate">{secao.title}</span>
                {comMudancas.has(secao.id) && (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" title="Alterações não salvas" />
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Formulário largo demais cansa: o conteúdo para em 56rem. */}
      <div className="min-w-0 max-w-4xl space-y-8">
        <PageHeader
          title="Configurações"
          description="Credenciais e integrações do painel, gravadas no .env desta máquina. Senhas e chaves nunca voltam para a tela: aparece só uma dica para reconhecer qual está lá."
        >
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={data.envPath}>
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="truncate">
              Gravado em <code className="rounded bg-muted px-1 font-mono">{data.envPath}</code>
            </span>
          </p>
        </PageHeader>

        {pendentes.length > 0 && (
          <Alert variant="warning">
            <RotateCw />
            <AlertTitle>Reinicie o painel para estas mudanças valerem</AlertTitle>
            <AlertDescription>{pendentes.map((f) => f.label).join(" · ")}</AlertDescription>
          </Alert>
        )}

        {data.sections.map((secao) => (
          <SectionCard
            key={secao.id}
            section={secao}
            drafts={drafts}
            errors={errors}
            engines={data.engines}
            saving={
              salvar.isPending &&
              salvar.variables !== undefined &&
              Object.keys(salvar.variables).some((k) => secao.fields.some((f) => f.key === k))
            }
            onDraft={setDraft}
            onDiscard={() => setDrafts((atual) => ({ ...atual, ...initialDrafts([secao]) }))}
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
  engines: EngineStatus[];
  saving: boolean;
  onDraft: (key: string, draft: FieldDraft) => void;
  onDiscard: () => void;
  onSave: (updates: Record<string, string | null>) => void;
}) {
  const updates = sectionUpdates(section, drafts);
  const mudancas = Object.keys(updates).length;
  const estado = sectionStatus(section, engines);

  return (
    <Card id={`config-${section.id}`} className="scroll-mt-24 gap-0 p-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-6 py-5">
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug font-semibold">{section.title}</h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{section.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {estado && <Badge variant={estado.variant}>{estado.label}</Badge>}
          {mudancas > 0 && <Badge variant="warning">Não salvo</Badge>}
        </div>
      </div>

      <div className="divide-y border-t">
        {section.id === "generation" && <EnginesRow engines={engines} />}
        {section.id === "claude" && <ClaudeStateRow />}
        {section.fields.map((campo) => (
          <FieldRow
            // Depois de gravar, o segredo renasce: a caixa de troca fecha.
            key={`${campo.key}:${campo.set ?? ""}:${campo.hint ?? ""}`}
            field={campo}
            draft={drafts[campo.key]}
            error={errors[campo.key]}
            onChange={(draft) => onDraft(campo.key, draft)}
          />
        ))}
      </div>

      {section.id === "github" && <GithubTest drafts={drafts} />}
      {section.id === "assistant" && <GeminiTest drafts={drafts} />}
      {section.id === "claude" && <ClaudeTest unsaved={mudancas > 0} />}

      {/* Salvar mora no rodapé, perto de onde a pessoa acabou de editar —
          no topo ele sumia da tela nas seções longas. */}
      {mudancas > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-muted/40 px-6 py-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {pluralize(mudancas, "alteração não salva", "alterações não salvas")} nesta seção
          </span>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>
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

/** O estado de cada motor de geração, como uma linha da seção. */
function EnginesRow({ engines }: { engines: EngineStatus[] }) {
  return (
    <div className={FIELD_GRID}>
      <div className="md:pt-0.5">
        <p className="text-sm font-medium">Motores</p>
        <p className="text-2xs text-muted-foreground">O que cada um pode fazer agora</p>
      </div>
      <ul className="space-y-3">
        {engines.map((motor) => (
          <li key={motor.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{motor.label}</span>
              <Badge variant={motor.available ? "success" : "warning"}>
                {motor.available ? "Disponível" : "Indisponível"}
              </Badge>
            </div>
            <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{motor.description}</p>
            {motor.reason && <p className="mt-0.5 text-xs text-warning">{motor.reason}</p>}
            {motor.id === "claude" && motor.available && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {motor.details.enabled
                  ? "Uso liberado: cada execução consome a assinatura do Claude Code."
                  : "Uso desligado: o painel monta e confere o pedido, mas não dispara o Claude Code. A trava fica em Motor Claude."}
              </p>
            )}
          </li>
        ))}
      </ul>
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
