import { createElement, useMemo, useState, useEffect } from "react";
import { ErrorNotice, PageHeader } from "@/components/page-header";
import { PageColumns, PageSkeleton } from "@/components/page-layout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2, RotateCw, Save, ShieldCheck, Undo2 } from "lucide-react";
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
import { SectionCard } from "@/components/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FieldRow } from "./settings-field";
import { sectionIcon } from "./section-icons";
import {
  engineStatus,
  FIELD_GRID,
  initialDrafts,
  sectionStatus,
  sectionUpdates,
  type Drafts,
  type FieldDraft,
} from "./settings-form";
import { ClaudeStateRow, ClaudeTest } from "./settings-claude";
import { GeminiTest, GithubTest } from "./settings-tests";

/**
 * A tela de configuração: todas as chaves do `.env`, por assunto.
 *
 * No topo, o estado de cada integração num relance; embaixo, uma seção por
 * assunto, com os campos numa coluna só — nome à esquerda, controle e ajuda à
 * direita —, o mesmo selo de estado no título e o teste que ela tem (GitHub,
 * Gemini, Claude) no rodapé. A seção grava sozinha e diz o que só vale depois
 * de reiniciar. Segredos nunca voltam para o navegador: aparece só a dica.
 */

/*
 * Onde o topo de uma seção para ao rolar: abaixo do cabeçalho fixo do painel
 * (56px a partir de `md`; uns 105px no celular, com as seções numa segunda
 * linha) e com o respiro do topo da página. Um valor só, na variável
 * --topo-secao, para o menu lateral grudado, o destino dos links e a faixa que
 * marca a seção atual — antes eram três números soltos (top-24, scroll-mt-24 e
 * -96px), presos a um cabeçalho que mudou de altura.
 */
const TOPO_SECAO = "[--topo-secao:7.5rem] md:[--topo-secao:5rem]";

const TITULO = "Configurações";
const DESCRICAO = "Credenciais e integrações do painel; senhas e chaves gravadas nunca voltam para a tela.";

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
      // O que só vale depois de reiniciar já aparece na faixa do topo e no
      // próprio campo: o toast só confirma a gravação, sem repetir o aviso.
      toast.success(pluralize(resposta.saved.length, "configuração gravada", "configurações gravadas"), {
        description: resposta.restartRequired.length ? undefined : "Já está valendo.",
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

  if (query.isPending) return <PageSkeleton />;
  if (query.error || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title={TITULO} description={DESCRICAO} />
        <Card className="py-0">
          <ErrorNotice
            title="Não foi possível abrir as configurações"
            error={query.error}
            onRetry={query.isFetching ? undefined : () => void query.refetch()}
            className="py-14"
          />
        </Card>
      </div>
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
    <div className={cn("space-y-5", TOPO_SECAO)}>
      <PageHeader title={TITULO} description={DESCRICAO}>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={data.envPath}>
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            Gravado em <code className="font-mono">{data.envPath}</code>
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

      {/* O molde da tela de Projetos: as seções na coluna principal e, na
          lateral, o índice com o estado de cada integração — grudado no
          topo a partir de 1600 px; abaixo disso, antes das seções. */}
      <PageColumns
        asideLabel="Seções da configuração"
        asideFirst
        asideClassName="md:grid-cols-1 lateral:sticky lateral:top-(--topo-secao)"
        aside={<SectionIndex sections={data.sections} engines={data.engines} current={atual} changed={comMudancas} />}
      >
        {data.sections.map((secao) => (
          <SettingsSection
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
      </PageColumns>
    </div>
  );
}

/**
 * O índice da página e o estado de cada integração num relance, num cartão
 * só: o clique leva à seção, a seção que está na tela fica marcada e um ponto
 * diz onde há mudança não salva. Antes eram dois — um menu à esquerda e a
 * visão das integrações no topo —, com os mesmos nomes.
 */
function SectionIndex({
  sections,
  engines,
  current,
  changed,
}: {
  sections: SettingSection[];
  engines: EngineStatus[];
  current: string | null;
  changed: Set<string>;
}) {
  return (
    <SectionCard title="Nesta página" bodyClassName="px-3 pb-3">
      <ul className="grid gap-x-4 sm:grid-cols-2 lateral:grid-cols-1">
        {sections.map((section) => {
          const status = sectionStatus(section, engines);
          const falta = status?.missing?.length ? `Falta: ${status.missing.join(", ")}` : null;
          const aqui = current === section.id;
          return (
            <li key={section.id}>
              <a
                href={`#config-${section.id}`}
                aria-current={aqui ? "location" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  aqui ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {createElement(sectionIcon(section.id), { className: "size-4 shrink-0" })}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", aqui && "font-medium")} title={section.title}>
                    {section.title}
                  </span>
                  {falta && (
                    <span className="block truncate text-2xs text-muted-foreground" title={falta}>
                      {falta}
                    </span>
                  )}
                </span>
                {/* O ponto é o único "não salvo" fora da própria seção (que
                    tem o rodapé com Salvar); o leitor de tela ouve o texto. */}
                {changed.has(section.id) && (
                  <>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" title="Alterações não salvas" />
                    <span className="sr-only">, alterações não salvas</span>
                  </>
                )}
                {status && <Badge variant={status.variant}>{status.label}</Badge>}
              </a>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function SettingsSection({
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
    <SectionCard
      id={`config-${section.id}`}
      className="scroll-mt-(--topo-secao)"
      title={section.title}
      icon={createElement(sectionIcon(section.id))}
      description={<span className="block max-w-prose">{section.description}</span>}
      actions={estado && <Badge variant={estado.variant}>{estado.label}</Badge>}
      bodyClassName="p-0"
    >
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
          no topo ele sumia da tela nas seções longas. É também o único
          "não salvo" dentro da seção. */}
      {mudancas > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/40 px-5 py-3">
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
    </SectionCard>
  );
}

/**
 * Os motores de geração, um por linha, com o estado de cada um. O Claude tem
 * seção própria, com a trava e o diagnóstico: aqui fica só o selo e o caminho
 * até lá — antes a mesma explicação aparecia nas duas seções.
 */
function EnginesRow({ engines }: { engines: EngineStatus[] }) {
  return (
    <div className={FIELD_GRID}>
      <div className="md:pt-0.5">
        <p className="text-sm font-medium">Motores</p>
        <p className="text-2xs text-muted-foreground">Cada geração escolhe o seu</p>
      </div>
      <ul className="space-y-2">
        {engines.map((motor) => {
          const estado = engineStatus(motor);
          return (
            <li key={motor.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{motor.label}</span>
                <Badge variant={estado.variant}>{estado.label}</Badge>
                {motor.id === "claude" && (
                  <Button asChild variant="link" size="xs">
                    <a href="#config-claude">
                      Ver em Motor Claude
                      <ArrowDown />
                    </a>
                  </Button>
                )}
              </div>
              {motor.id !== "claude" && (
                <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{motor.reason ?? motor.description}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A seção que está na tela, para o menu lateral marcar onde a pessoa está —
 * a primeira que cruza a faixa logo abaixo do cabeçalho fixo.
 */
function useActiveSection(ids: string[]) {
  const [atual, setAtual] = useState<string | null>(null);
  useEffect(() => {
    if (ids.length === 0) return;
    const elementos = ids
      .map((id) => document.getElementById(`config-${id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (elementos.length === 0) return;
    // A faixa começa onde um link deixa o topo da seção: o scroll-margin dela,
    // que é a --topo-secao já em px (o IntersectionObserver não aceita rem).
    const topo = Math.round(Number.parseFloat(getComputedStyle(elementos[0]).scrollMarginTop) || 0);
    const visiveis = new Map<string, boolean>();
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          visiveis.set(entrada.target.id.replace(/^config-/, ""), entrada.isIntersecting);
        }
        const primeira = ids.find((id) => visiveis.get(id));
        if (primeira) setAtual(primeira);
      },
      { rootMargin: `-${topo}px 0px -60% 0px` },
    );
    elementos.forEach((el) => observador.observe(el));
    return () => observador.disconnect();
  }, [ids]);
  return atual ?? ids[0] ?? null;
}
