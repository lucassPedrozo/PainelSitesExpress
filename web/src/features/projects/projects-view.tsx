import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FolderTree, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { deleteProject, fetchDevAreaStatus, type Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { formatDateTime } from "@/lib/format";
import { groupAnchor, type DatedGroup } from "@/features/projects/date-groups";
import { GenerateSiteDialog } from "@/features/generate/generate-site-dialog";
import type { GenerationEngine } from "@/features/generate/engine-choice";
import { ClaudePushDialog } from "@/features/claude/claude-push-dialog";
import { QuickGenerateDialog } from "@/features/generate/quick-generate-dialog";
import { ReplyAgentDialog } from "@/features/generate/reply-agent-dialog";
import {
  ProjectFilesDialog,
  type ProjectTab,
} from "@/features/project-files/project-files-dialog";
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
import { NewProjectDialog } from "./new-project-dialog";
import { PushSiteDialog } from "./push-site-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StageFilter } from "./stage-filter";
import { WorkSummary } from "./work-summary";
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
  /** O que o modal do projeto mostra: os arquivos ou a linha do tempo. */
  const [projectTab, setProjectTab] = useState<ProjectTab>("files");
  /** O projeto na tela de geração, e o motor que já vem escolhido (ou o padrão). */
  const [generating, setGenerating] = useState<{ project: Project; engine: GenerationEngine | null } | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [linking, setLinking] = useState<Project | null>(null);
  const [changing, setChanging] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  /** Projeto criado no painel cujo site vai ao GitHub. */
  const [pushing, setPushing] = useState<Project | null>(null);
  /** Projeto cujo site, gerado pelo Claude, vai ao GitHub. */
  const [pushingClaude, setPushingClaude] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  /** Envio padrão: um projeto, ou a fila de um grupo inteiro. */
  const [quick, setQuick] = useState<Project[] | null>(null);
  const [replying, setReplying] = useState<Project | null>(null);
  const [publishing, setPublishing] = useState<Project | null>(null);
  const { patchGeneration } = list;

  const reply = useCallback((project: Project) => {
    setSelected(null);
    setReplying(project);
  }, []);

  const openProject = useCallback((project: Project) => {
    setFocusShare(false);
    setProjectTab("files");
    setSelected(project);
  }, []);

  const openForShareLink = useCallback((project: Project) => {
    setFocusShare(true);
    setProjectTab("files");
    setSelected(project);
  }, []);

  /** Do menu do card, ou de dentro do modal já aberto: só a aba muda. */
  const openTimeline = useCallback((project: Project) => {
    setFocusShare(false);
    setProjectTab("timeline");
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
    setGenerating({ project, engine: null });
  }, []);

  /** A mesma tela, já no motor Claude — o primeiro passo dele é o briefing. */
  const startClaudeGeneration = useCallback((project: Project) => {
    setSelected(null);
    setGenerating({ project, engine: "claude" });
  }, []);

  /** O projeto na aba do Claude: acompanhar, revisar, aprovar, ver o erro. */
  const openClaude = useCallback((project: Project) => {
    setFocusShare(false);
    setProjectTab("claude");
    setSelected(project);
  }, []);

  /**
   * Vários projetos vão para a fila do envio em lote; um só abre a tela de
   * conferência, como o botão do card.
   */
  const generateMany = useCallback(
    (projects: Project[]) => {
      if (projects.length === 1) startGeneration(projects[0]);
      else setQuick(projects);
    },
    [startGeneration],
  );

  /** Publica ali mesmo, sem sair da lista. */
  const startPublication = useCallback((project: Project) => {
    setSelected(null);
    setPublishing(project);
  }, []);

  const { load } = list;

  /** Recém-criado: relê a lista e abre o que a pessoa veio fazer com ele. */
  const afterCreate = useCallback(
    async (projectId: string, kind: "site" | "files") => {
      setCreating(false);
      await load();
      const fresh: Project = {
        id: projectId,
        source: "panel",
        purpose: kind,
        name: "",
        alias: null,
        description: null,
        createdTime: new Date().toISOString(),
        modifiedTime: new Date().toISOString(),
        webViewLink: "",
        owner: null,
        fileCount: 0,
        folderCount: 0,
        totalSize: 0,
        kinds: {},
        lastActivity: new Date().toISOString(),
        tagIds: [],
        brief: null,
        generations: [],
        publication: null,
        domain: null,
        domainCollections: 0,
      };
      // Os diálogos procuram o projeto na lista pelo id: o esqueleto só vale
      // se a releitura ainda não o trouxe.
      if (kind === "site") setPushing(fresh);
      else {
        setFocusShare(false);
        setProjectTab("files");
        setSelected(fresh);
      }
    },
    [load],
  );

  const removeProject = useCallback(
    async (project: Project) => {
      setDeleting(null);
      try {
        await deleteProject(project.id);
        toast.success(`Projeto ${projectIdentity(project).label} excluído`);
      } catch (err) {
        toast.error("Não foi possível excluir o projeto", {
          description: err instanceof Error ? err.message : "Tente novamente.",
        });
      }
      await load();
    },
    [load],
  );

  /** As ações do card e do modal — as mesmas nos dois, e estáveis. */
  const actions: ProjectActionHandlers = useMemo(
    () => ({
      onGenerate: startGeneration,
      onReply: reply,
      onPublish: startPublication,
      onRename: setRenaming,
      onCreateLink: openForShareLink,
      onSendToClient: sendLink,
      onVerifyLink: verifyLink,
      onPublishToApprovalArea: approvalAreaReady ? publishApproval : undefined,
      onFindDomain: list.setQuery,
      onShowTimeline: openTimeline,
      onLinkSite: (project: Project) => {
        setSelected(null);
        setLinking(project);
      },
      onChangeProject: (project: Project) => {
        setSelected(null);
        setChanging(project);
      },
      onPushSite: (project: Project) => {
        setSelected(null);
        setPushing(project);
      },
      onOpenFiles: openProject,
      onDeleteProject: (project: Project) => {
        setSelected(null);
        setDeleting(project);
      },
      onOpenClaude: openClaude,
      onGenerateWithClaude: startClaudeGeneration,
      onPushClaudeSite: (project: Project) => {
        setSelected(null);
        setPushingClaude(project);
      },
    }),
    [
      startGeneration,
      reply,
      startPublication,
      openForShareLink,
      sendLink,
      verifyLink,
      approvalAreaReady,
      publishApproval,
      list.setQuery,
      openTimeline,
      openProject,
      openClaude,
      startClaudeGeneration,
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
        onClick={() => generateMany(group.items)}
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

  // A fila agrupa pelo próximo passo — a não ser que o filtro de etapa peça
  // justamente os que estão no ar; aí a lista volta a ser por data (a mesma
  // regra de `useProjectList`).
  const fila = list.view === "queue" && list.stage !== "live";

  /** Do resumo ao grupo: rola até ele e leva o foco, para teclado e leitor. */
  const jumpToGroup = useCallback((key: string) => {
    const alvo = document.getElementById(groupAnchor(key));
    if (!alvo) return;
    const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    alvo.scrollIntoView({ behavior: semMovimento ? "auto" : "smooth", block: "start" });
    alvo.focus({ preventScroll: true });
  }, []);

  const ProjectCollection = layout === "grid" ? ProjectGrid : ProjectTable;

  return (
    <>
      {/* Duas camadas, do controle ao trabalho.

          A primeira é a "lente": a barra (vista, ordenação, exibição) e, logo
          abaixo, os dois filtros — sem caixa própria. O painel branco que os
          envolvia tinha o mesmo peso dos cards e disputava com eles; sobre o
          fundo da página, com os chips em fio de borda, os filtros leem como
          controle. A vista vem primeiro porque decide o que os filtros
          filtram. */}
      <div className="space-y-4">
        <ProjectsToolbar
          list={list}
          layout={layout}
          onLayoutChange={onLayoutChange}
          onNewProject={() => setCreating(true)}
          onOpenClaude={openClaude}
        />
        <section aria-label="Filtros" className="space-y-2">
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
      </div>

      {/* A segunda camada é o trabalho: um fio separa a lente do resumo, e o
          resumo diz quantos projetos há na tela e quantos esperam cada passo
          — os números que a tela existe para mostrar, em tamanho de título,
          cada um levando ao seu grupo. Os grupos vêm colados a ele. */}
      <div className="space-y-4 border-t pt-4">
      {loading ? (
        <Skeleton className="h-7 w-96 max-w-full" />
      ) : (
        <WorkSummary
          view={list.view}
          visibleCount={visible.length}
          queue={fila ? groups : null}
          doneCount={list.doneCount}
          onShowAll={() => list.setView("all")}
          onJump={jumpToGroup}
          filters={filtrosAtivos}
          onClearFilters={list.clearFilters}
          inventory={{
            total: projects.length,
            recent: summary.recent,
            files: summary.files,
            size: summary.size,
          }}
        />
      )}

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
          description={`${list.doneCount === 1 ? "O projeto deste filtro está" : `Os ${list.doneCount} projetos deste filtro estão`} sem pendência — no ar, ou só guardando arquivos.`}
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
          renderGroupAction={fila ? groupAction : undefined}
          selectedIds={list.selectedIds}
          onToggleSelect={list.toggleSelected}
        />
      )}
      </div>

      <BulkActionsBar
        list={list}
        tags={tags}
        visible={visible}
        approvalAreaReady={approvalAreaReady}
        onGenerate={generateMany}
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
        tab={projectTab}
        onTabChange={setProjectTab}
        focusShareInput={focusShare}
        onOpenChange={(open) => !open && setSelected(null)}
        actions={actions}
        onTagsChange={list.applyTags}
        onGenerationChange={list.patchGeneration}
      />

      <GenerateSiteDialog
        project={generating?.project ?? null}
        engine={generating?.engine ?? null}
        onOpenChange={(open) => !open && setGenerating(null)}
        onGenerated={() => void list.load(true)}
        // O pedido entrou na fila do Claude: o projeto abre na aba dele, onde
        // o log corre e, depois, o briefing aparece para revisar.
        onRequested={(project) => {
          setGenerating(null);
          void list.load();
          openClaude(project);
        }}
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

      <NewProjectDialog open={creating} onOpenChange={setCreating} onCreated={afterCreate} />

      <PushSiteDialog
        project={pushing ? (projects.find((p) => p.id === pushing.id) ?? pushing) : null}
        approvalAreaReady={approvalAreaReady}
        onOpenChange={(open) => !open && setPushing(null)}
        onPushed={() => list.load()}
      />

      <ClaudePushDialog
        project={pushingClaude ? (projects.find((p) => p.id === pushingClaude.id) ?? pushingClaude) : null}
        onOpenChange={(open) => !open && setPushingClaude(null)}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {deleting ? projectIdentity(deleting).label : "o projeto"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O projeto sai do painel junto com os arquivos guardados nele, as tags e o registro do site. Não dá
              para desfazer. O repositório no GitHub e o site já publicado continuam como estão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void removeProject(deleting);
              }}
            >
              Excluir projeto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RenameProjectDialog
        project={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSubmit={list.applyName}
      />
    </>
  );
}
