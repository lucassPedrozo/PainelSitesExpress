import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FolderTree, Sparkles, X } from "lucide-react";
import { fetchDevAreaStatus, type Project } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { DatedGroup } from "@/features/projects/date-groups";
import { GenerateSiteDialog } from "@/features/generate/generate-site-dialog";
import { QuickGenerateDialog } from "@/features/generate/quick-generate-dialog";
import { ReplyAgentDialog } from "@/features/generate/reply-agent-dialog";
import { ProjectFilesDialog } from "@/features/project-files/project-files-dialog";
import { TagFilterBar } from "@/features/tags/tag-filter-bar";
import type { TagsController } from "@/features/tags/use-tags";
import {
  publishToApprovalArea,
  sendToClient,
  verifyClientLink,
} from "./client-delivery";
import type { ProjectActionHandlers } from "./project-actions";
import { ProjectGrid, ProjectTable } from "./project-list";
import { latestGeneration, stageLabels } from "./project-status";
import { ProjectsToolbar, type ProjectsLayout } from "./projects-toolbar";
import { BulkActionsBar } from "./bulk-actions-bar";
import { RenameProjectDialog } from "./rename-project-dialog";
import { LinkSiteDialog } from "./link-site-dialog";
import { ChangeProjectDialog } from "./change-project-dialog";
import { StageFilter } from "./stage-filter";
import type { ProjectList } from "./use-project-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/page-header";
import { cn } from "@/lib/utils";

/**
 * Sob demanda, como a aba Deploy: traz o cliente do GitHub e o formulário de
 * publicação, que não precisam estar no carregamento inicial.
 */
const PublishDialog = lazy(() => import("@/features/deploy/publish-dialog"));

type ProjectsViewProps = {
  tags: TagsController;
  /** Vem do App porque a busca e o "Atualizar" moram no cabeçalho. */
  list: ProjectList;
  /** Também no App: a escolha sobrevive à ida e volta pela seção de Deploy. */
  layout: ProjectsLayout;
  onLayoutChange: (layout: ProjectsLayout) => void;
  /** A aba Deploy, a partir de um projeto — para o que o diálogo não cobre. */
  onOpenDeployTab: (project: Project) => void;
};

/**
 * A seção de projetos: resumo, filtros, a grade (ou lista) e os diálogos que
 * se abrem a partir de um projeto.
 */
export function ProjectsView({
  tags,
  list,
  layout,
  onLayoutChange,
  onOpenDeployTab,
}: ProjectsViewProps) {
  const { projects, visible, groups, summary, loading, error, fetchedAt } = list;

  const [selected, setSelected] = useState<Project | null>(null);
  /** O projeto foi aberto por "Criar link": o campo de colar já vem em foco. */
  const [focusShare, setFocusShare] = useState(false);
  const [generating, setGenerating] = useState<Project | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [linking, setLinking] = useState<Project | null>(null);
  const [changing, setChanging] = useState<Project | null>(null);
  /** Envio padrão: um projeto, ou a fila de um grupo inteiro. */
  const [quick, setQuick] = useState<Project[] | null>(null);
  const [replying, setReplying] = useState<Project | null>(null);
  const [publishing, setPublishing] = useState<Project | null>(null);
  const { patchGeneration } = list;

  const quickGenerate = useCallback((project: Project) => {
    setSelected(null);
    setQuick([project]);
  }, []);

  const reply = useCallback((project: Project) => {
    setSelected(null);
    setReplying(project);
  }, []);

  const openProject = useCallback((project: Project) => {
    setFocusShare(false);
    setSelected(project);
  }, []);

  const openForShareLink = useCallback((project: Project) => {
    setFocusShare(true);
    setSelected(project);
  }, []);

  const sendLink = useCallback(
    async (project: Project) => {
      const site = latestGeneration(project);
      if (site) await sendToClient(project, site, patchGeneration);
    },
    [patchGeneration],
  );

  const verifyLink = useCallback(
    async (project: Project) => {
      const site = latestGeneration(project);
      if (site) await verifyClientLink(project, site, patchGeneration);
    },
    [patchGeneration],
  );

  // A área de aprovação só existe com as credenciais no .env; sem elas o
  // item do menu nem aparece.
  const approvalArea = useQuery({
    queryKey: ["dev-area-status"],
    queryFn: fetchDevAreaStatus,
    staleTime: 5 * 60_000,
  });
  const approvalAreaReady = approvalArea.data?.configured === true;

  const publishApproval = useCallback(
    async (project: Project) => {
      const site = latestGeneration(project);
      if (site) await publishToApprovalArea(project, site, patchGeneration);
    },
    [patchGeneration],
  );

  /** Um modal de cada vez: abrir o gerador fecha a lista de arquivos. */
  const startGeneration = useCallback((project: Project) => {
    setSelected(null);
    setGenerating(project);
  }, []);

  /** Publica ali mesmo, sem sair da lista. */
  const startPublication = useCallback((project: Project) => {
    setSelected(null);
    setPublishing(project);
  }, []);

  /** As ações do card e do modal — as mesmas nos dois, e estáveis. */
  const actions: ProjectActionHandlers = useMemo(
    () => ({
      onGenerate: startGeneration,
      onQuickGenerate: quickGenerate,
      onReply: reply,
      onPublish: startPublication,
      onRename: setRenaming,
      onCreateLink: openForShareLink,
      onSendToClient: sendLink,
      onVerifyLink: verifyLink,
      onPublishToApprovalArea: approvalAreaReady ? publishApproval : undefined,
      onFindDomain: list.setQuery,
      onLinkSite: (project: Project) => {
        setSelected(null);
        setLinking(project);
      },
      onChangeProject: (project: Project) => {
        setSelected(null);
        setChanging(project);
      },
    }),
    [
      startGeneration,
      quickGenerate,
      reply,
      startPublication,
      openForShareLink,
      sendLink,
      verifyLink,
      approvalAreaReady,
      publishApproval,
      list.setQuery,
    ],
  );

  /**
   * Na fila, o grupo "Gerar o site" oferece gerar todos de uma vez. Qualquer
   * outro conjunto sai da seleção (caixa no card) e da barra de ações.
   */
  const groupAction = (group: DatedGroup<Project>) =>
    group.key === "generate" && group.items.length > 1 ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setQuick(group.items)}
        title="Abre a lista dos projetos deste grupo para conferir e confirmar. Nada é enviado ao Lovable antes da confirmação."
      >
        <Sparkles className="size-3.5" />
        Gerar os {group.items.length} em lote
      </Button>
    ) : null;

  const filtrosAtivos = [
    list.query.trim() && `busca “${list.query.trim()}”`,
    list.stage && `etapa “${stageLabels[list.stage]}”`,
    list.tagFilter.untaggedOnly && "sem tag",
    list.tagFilter.tagIds.length > 0 &&
      `${list.tagFilter.tagIds.length === 1 ? "tag" : "tags"} ${list.tagFilter.tagIds
        .map((id) => tags.byId.get(id)?.name)
        .filter(Boolean)
        .map((nome) => `“${nome}”`)
        .join(list.tagFilter.matchAll ? " e " : " ou ")}`,
  ].filter(Boolean) as string[];

  const limparFiltros = (
    <Button variant="ghost" size="xs" onClick={list.clearFilters}>
      <X className="size-3.5" />
      Limpar filtros
    </Button>
  );

  const ProjectCollection = layout === "grid" ? ProjectGrid : ProjectTable;

  return (
    <>
      {/* Uma linha, não um cartão: são números de contexto, não um painel
          para agir. O quanto está visível também mora aqui — antes o total
          aparecia duas vezes, aqui e no fim da barra de ferramentas. */}
      {/* A vista e a ordenação primeiro: decidem o que os filtros abaixo
          filtram. Antes a barra vinha por último, depois das fileiras que
          ela mesma alterava. */}
      <ProjectsToolbar
        list={list}
        layout={layout}
        onLayoutChange={onLayoutChange}
      />

      {/* Os dois filtros num painel só, com os rótulos numa coluna: antes
          eram fileiras soltas no fundo da página, cada uma com 24px de
          distância, e liam como seções diferentes. Logo abaixo, colado, o
          resumo do que o filtro deixou na tela. */}
      <div className="space-y-3">
        <section
          aria-label="Filtros"
          className="space-y-2.5 rounded-xl bg-card px-4 py-3 shadow-xs ring-1 ring-foreground/10"
        >
          <StageFilter
            counts={list.stageCounts}
            value={list.stage}
            onChange={list.setStage}
          />
          <TagFilterBar
            controller={tags}
            counts={list.tagCounts}
            filter={list.tagFilter}
            onChange={list.setTagFilter}
            onTagRemoved={list.forgetTag}
            hiddenTagIds={tags.finishedTagId ? [tags.finishedTagId] : []}
          />
        </section>

      {/* O que está na tela e por quê: quantos, de quantos, e os filtros
          ligados — com um "Limpar" só para todos. */}
      {loading ? (
        <Skeleton className="h-4 w-80" />
      ) : (
        <div className="flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground tabular-nums">{visible.length}</b>{" "}
            {visible.length === 1 ? "projeto" : "projetos"}
            {list.view === "queue" && " com algo a fazer"}
            {list.view === "finished" && " finalizados"}
          </span>
          {filtrosAtivos.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>filtrando por {filtrosAtivos.join(", ")}</span>
              {limparFiltros}
            </>
          )}
          {list.view === "queue" && list.doneCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => list.setView("all")}
                title="Os que estão no ar não têm nada a fazer e ficam fora da fila. A vista “Todos” mostra também eles."
              >
                {list.doneCount} no ar, fora da fila
              </button>
            </>
          )}
          <span className="ml-auto hidden sm:inline">
            {projects.length} no Drive · {summary.recent} {summary.recent === 1 ? "coleta" : "coletas"} nos
            últimos 30 dias · {summary.files.toLocaleString("pt-BR")} arquivos · {formatBytes(summary.size)}
          </span>
        </div>
      )}
      </div>

      {error ? (
        <EmptyState
          tone="danger"
          icon={<AlertCircle />}
          title="Falha ao carregar os projetos"
          description={
            <>
              <p>{error}</p>
              <p className="mt-1 text-xs">Confira se o painel está rodando (no lançador ou com npm start).</p>
            </>
          }
          action={<Button onClick={() => list.load(true)}>Tentar novamente</Button>}
        />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[277px] rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 && list.view === "queue" && list.doneCount > 0 ? (
        <EmptyState
          icon={<FolderTree />}
          title="Nada a fazer agora"
          description={`${list.doneCount === 1 ? "O projeto deste filtro está" : `Os ${list.doneCount} projetos deste filtro estão`} no ar.`}
          action={
            <Button variant="outline" onClick={() => list.setView("all")}>
              Ver na vista “Todos”
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FolderTree />}
          title={list.view === "finished" && !list.filtersActive
              ? "Nenhum projeto finalizado"
              : "Nenhum projeto encontrado"}
          description={list.filtersActive
              ? `Nada ${list.view === "finished" ? "entre os finalizados " : ""}com ${filtrosAtivos.join(", ")}.`
              : list.view === "finished"
                ? "Marque um projeto com a tag “Finalizado” (ou use “Finalizar” na seleção) para ele sair das vistas de trabalho e vir para cá."
                : "Confirme se a pasta raiz foi compartilhada com a service account."}
          action={list.filtersActive && (
            <Button variant="outline" onClick={list.clearFilters}>
              <X />
              Limpar filtros
            </Button>
          )}
        />
      ) : (
        <ProjectCollection
          projects={visible}
          groups={groups}
          tags={tags}
          onOpen={openProject}
          {...actions}
          onTagsChange={list.applyTags}
          renderGroupAction={list.view === "queue" ? groupAction : undefined}
          selectedIds={list.selectedIds}
          onToggleSelect={list.toggleSelected}
        />
      )}

      <BulkActionsBar
        list={list}
        tags={tags}
        visible={visible}
        approvalAreaReady={approvalAreaReady}
        onGenerate={(selecionados) => setQuick(selecionados)}
      />

      {fetchedAt && !loading && (
        <p
          className={cn(
            "pb-4 text-center text-xs text-muted-foreground",
            // A barra de seleção fica fixa no rodapé: sem esta folga, ela
            // cobria as ações da última fileira de cards.
            list.selectedIds.size > 0 && "pb-20",
          )}
        >
          Dados sincronizados em {formatDateTime(fetchedAt)}
        </p>
      )}

      <ProjectFilesDialog
        project={
          selected
            ? (projects.find((p) => p.id === selected.id) ?? selected)
            : null
        }
        tags={tags}
        focusShareInput={focusShare}
        onOpenChange={(open) => !open && setSelected(null)}
        actions={actions}
        onTagsChange={list.applyTags}
        onGenerationChange={list.patchGeneration}
      />

      <GenerateSiteDialog
        project={generating}
        onOpenChange={(open) => !open && setGenerating(null)}
        onGenerated={() => void list.load(true)}
      />

      <QuickGenerateDialog
        projects={quick}
        onOpenChange={(open) => !open && setQuick(null)}
        onReview={(project) => {
          setQuick(null);
          startGeneration(project);
        }}
        onGenerated={() => void list.load(true)}
      />

      <ReplyAgentDialog
        project={replying}
        onOpenChange={(open) => !open && setReplying(null)}
        onReplied={patchGeneration}
      />

      {publishing && (
        <Suspense fallback={null}>
          <PublishDialog
            project={publishing}
            onOpenChange={(open) => !open && setPublishing(null)}
            onOpenDeployTab={(project) => {
              setPublishing(null);
              onOpenDeployTab(project);
            }}
          />
        </Suspense>
      )}

      <LinkSiteDialog
        project={linking}
        approvalAreaReady={approvalAreaReady}
        onOpenChange={(open) => !open && setLinking(null)}
        // O vínculo pode ter mudado a publicação também ("já está no ar"):
        // relê a lista inteira em vez de remendar só a geração.
        onLinked={() => list.load()}
      />

      <ChangeProjectDialog
        project={changing}
        approvalAreaReady={approvalAreaReady}
        onOpenChange={(open) => !open && setChanging(null)}
        onChanged={() => list.load()}
      />

      <RenameProjectDialog
        project={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSubmit={list.applyName}
      />
    </>
  );
}
