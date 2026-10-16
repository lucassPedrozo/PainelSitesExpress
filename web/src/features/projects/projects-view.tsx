import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, MoreHorizontal, Plus, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { checkAllSharePreviews, deleteProject, fetchDevAreaStatus, type Project } from "@/lib/api";
import { formatTime, pluralize, projectIdentity, timeOf } from "@/lib/format";
import { noPermission, usePermissions } from "@/lib/permissions";
import { useMinute } from "@/lib/use-now";
import { GenerateSiteDialog } from "@/features/generate/generate-site-dialog";
import type { GenerationEngine } from "@/features/generate/engine-choice";
import { ClaudePushDialog } from "@/features/claude/claude-push-dialog";
import { ClaudeQueueButton } from "@/features/claude/claude-queue";
import { QuickGenerateDialog } from "@/features/generate/quick-generate-dialog";
import { ReplyAgentDialog } from "@/features/generate/reply-agent-dialog";
import { ProjectFilesDialog, type ProjectTab } from "@/features/project-files/project-files-dialog";
import { ManageTagsDialog } from "@/features/tags/manage-tags-dialog";
import type { TagsController } from "@/features/tags/use-tags";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { ErrorNotice, PageHeader } from "@/components/page-header";
import { ListFooter, PageColumns } from "@/components/page-layout";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActivityFeed } from "./activity-feed";
import { BulkActionsBar } from "./bulk-actions-bar";
import { ChangeProjectDialog } from "./change-project-dialog";
import { publishToApprovalArea, sendToClient, verifyClientLink } from "./client-delivery";
import { LinkSiteDialog } from "./link-site-dialog";
import { ListFilters } from "./list-filters";
import { NewProjectDialog } from "./new-project-dialog";
import type { ProjectActionHandlers } from "./project-actions";
import { latestGeneration } from "./project-status";
import { lastActivityOf } from "./last-activity";
import { collectedAtOf, countTags } from "./project-filters";
import { ProjectTable, ProjectTableEmpty, ProjectTableSkeleton } from "./project-table";
import { PushSiteDialog } from "./push-site-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import { ETAPAS, workGroupOf } from "./stage";
import type { ProjectList } from "./use-project-list";
import { MonthIntakeChart } from "./month-intake-chart";

/**
 * Sob demanda, como a aba Deploy: traz o cliente do GitHub e o formulário de
 * publicação, que não precisam estar no carregamento inicial.
 */
const PublishDialog = lazy(() => import("@/features/deploy/publish-dialog"));

type ProjectsViewProps = {
  tags: TagsController;
  /** Vem do App porque a busca e o "Atualizar" moram no cabeçalho. */
  list: ProjectList;
  /** A aba Deploy, a partir de um projeto — para o que o diálogo não cobre. */
  onOpenDeployTab: (project: Project) => void;
};

/**
 * A tela Projetos: "Fazer agora", a lista com os filtros numa linha, a
 * atividade recente ao lado e os diálogos que se abrem a partir de um
 * projeto. Cada linha responde em que etapa o projeto está, o que aconteceu
 * por último e o que fazer agora — com um botão só.
 */
export function ProjectsView({ tags, list, onOpenDeployTab }: ProjectsViewProps) {
  const { projects, visible, loading, error, fetchedAt } = list;
  // Em quantos projetos cada tag está, contando todos (não só os filtrados).
  const tagUsage = useMemo(() => countTags(projects), [projects]);
  // O "agora" das faixas de data: o instante da leitura, ou o relógio da página.
  const relogio = useMinute();
  const agora = timeOf(fetchedAt) ?? relogio;

  // As faixas de data acompanham a ordem: pela coleta, ou pela última
  // atividade. Na ordem por prioridade ou por nome a lista corre sem faixas.
  const groupDate = useMemo(() => {
    if (list.sort === "coleta-recente" || list.sort === "coleta-antiga") return collectedAtOf;
    if (list.sort === "atividade") return (project: Project) => new Date(timeOf(lastActivityOf(project)?.at) ?? 0);
    return null;
  }, [list.sort]);

  // A atividade recente não conta os ocultos.
  const naoOcultos = useMemo(() => projects.filter((project) => !project.details?.hidden), [projects]);

  // Os responsáveis já usados: as sugestões do campo na edição.
  const responsibles = useMemo(
    () =>
      [...new Set(projects.map((project) => project.details?.responsible).filter((nome): nome is string => Boolean(nome)))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [projects],
  );
  const { can } = usePermissions();

  const [selected, setSelected] = useState<Project | null>(null);
  /** O projeto foi aberto por "Criar link": o campo de colar já vem em foco. */
  const [focusShare, setFocusShare] = useState(false);
  /** O que o diálogo do projeto mostra primeiro. */
  const [projectTab, setProjectTab] = useState<ProjectTab>("summary");
  /** O projeto na tela de geração, e o motor que já vem escolhido (ou o padrão). */
  const [generating, setGenerating] = useState<{ project: Project; engine: GenerationEngine | null } | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [linking, setLinking] = useState<Project | null>(null);
  const [changing, setChanging] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingTags, setManagingTags] = useState(false);
  /** Projeto criado no painel cujo site vai ao GitHub. */
  const [pushing, setPushing] = useState<Project | null>(null);
  /** Projeto cujo site, gerado pelo Claude, vai ao GitHub. */
  const [pushingClaude, setPushingClaude] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  /** Envio em lote: a fila de um grupo inteiro, ou da seleção. */
  const [quick, setQuick] = useState<Project[] | null>(null);
  const [replying, setReplying] = useState<Project | null>(null);
  const [publishing, setPublishing] = useState<Project | null>(null);
  const [checkingLinks, setCheckingLinks] = useState(false);
  const { patchGeneration, load } = list;

  const open = useCallback((project: Project, tab: ProjectTab, focus = false) => {
    setFocusShare(focus);
    setProjectTab(tab);
    setSelected(project);
  }, []);
  const openProject = useCallback((project: Project) => open(project, "summary"), [open]);
  const openForShareLink = useCallback((project: Project) => open(project, "summary", true), [open]);
  const openTimeline = useCallback((project: Project) => open(project, "timeline"), [open]);
  /** O projeto na aba do Claude: acompanhar, revisar, aprovar, ver o erro. */
  const openClaude = useCallback((project: Project) => open(project, "claude"), [open]);
  const openFiles = useCallback((project: Project) => open(project, "files"), [open]);
  // Pela referência: a lista muda a cada leitura, e as ações das linhas
  // precisam ser estáveis (as linhas são memorizadas).
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  const openProjectById = useCallback(
    (projectId: string) => {
      const alvo = projectsRef.current.find((item) => item.id === projectId);
      if (alvo) open(alvo, "summary");
      else toast.error("A outra coleta não está na lista", { description: "Atualize a lista e tente de novo." });
    },
    [open],
  );

  const reply = useCallback((project: Project) => {
    setSelected(null);
    setReplying(project);
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

  /** Um diálogo de cada vez: abrir o gerador fecha o do projeto. */
  const startGeneration = useCallback((project: Project) => {
    setSelected(null);
    setGenerating({ project, engine: null });
  }, []);

  /** A mesma tela, já no motor Claude — o primeiro passo dele é o briefing. */
  const startClaudeGeneration = useCallback((project: Project) => {
    setSelected(null);
    setGenerating({ project, engine: "claude" });
  }, []);

  /** Vários projetos vão para o envio em lote; um só abre a tela de conferência. */
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

  /** Recém-criado: relê a lista e abre o que a pessoa veio fazer com ele. */
  const afterCreate = useCallback(
    async (projectId: string, kind: "site" | "files") => {
      setCreating(false);
      await load();
      const agora = new Date().toISOString();
      const fresh: Project = {
        id: projectId,
        source: "panel",
        purpose: kind,
        name: "",
        alias: null,
        description: null,
        createdTime: agora,
        modifiedTime: agora,
        webViewLink: "",
        owner: null,
        fileCount: 0,
        folderCount: 0,
        totalSize: 0,
        kinds: {},
        lastActivity: agora,
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
      else openFiles(fresh);
    },
    [load, openFiles],
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

  /** Confere agora todos os links de cliente (o painel também confere sozinho). */
  const checkLinks = useCallback(async () => {
    setCheckingLinks(true);
    try {
      const { checked, summary } = await checkAllSharePreviews();
      if (!checked) toast.info("Nenhum link de cliente registrado ainda");
      else if (summary.dead) {
        toast.error(pluralize(summary.dead, "link de cliente não abre", "links de cliente não abrem"), {
          description: "Os projetos afetados aparecem em “Resolver”.",
        });
      } else {
        toast.success(pluralize(checked, "link conferido", "links conferidos"), {
          description: summary.unknown ? `${pluralize(summary.unknown, "link")} sem resposta.` : "Todos abrem para o cliente.",
        });
      }
      await load();
    } catch (err) {
      toast.error("Falha ao verificar os links", {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setCheckingLinks(false);
    }
  }, [load]);

  /** As ações de cada projeto — as mesmas na lista e no diálogo, e estáveis. */
  // Ocultar e mostrar: um clique, com "Desfazer" no aviso.
  const { applyDetails } = list;
  const toggleHidden = useCallback(
    (project: Project) => {
      const ocultar = !project.details?.hidden;
      const nome = projectIdentity(project).label;
      setSelected(null);
      void applyDetails(project, { hidden: ocultar })
        .then(() =>
          toast.success(ocultar ? `${nome} foi ocultado` : `${nome} voltou à lista`, {
            description: ocultar ? "Ele fica na aba Ocultos, fora dos contadores e do Dashboard." : undefined,
            action: { label: "Desfazer", onClick: () => void applyDetails(project, { hidden: !ocultar }) },
          }),
        )
        .catch((err: unknown) =>
          toast.error(ocultar ? "Não foi possível ocultar" : "Não foi possível mostrar de novo", {
            description: err instanceof Error ? err.message : undefined,
          }),
        );
    },
    [applyDetails],
  );

  const actions: ProjectActionHandlers = useMemo(
    () => ({
      onToggleHidden: toggleHidden,
      onGenerate: startGeneration,
      onReply: reply,
      onPublish: startPublication,
      onEdit: setEditing,
      onCreateLink: openForShareLink,
      onSendToClient: sendLink,
      onVerifyLink: verifyLink,
      onPublishToApprovalArea: approvalAreaReady ? publishApproval : undefined,
      onFindDomain: list.setQuery,
      onOpenProjectById: openProjectById,
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
      onOpenFiles: openFiles,
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
      toggleHidden,
      startGeneration,
      reply,
      startPublication,
      openForShareLink,
      sendLink,
      verifyLink,
      approvalAreaReady,
      publishApproval,
      list.setQuery,
      openProjectById,
      openTimeline,
      openFiles,
      openClaude,
      startClaudeGeneration,
    ],
  );

  /** O que está filtrando, por extenso — o rodapé e a lista vazia dizem. */
  const filtros = [
    list.query.trim() && `busca “${list.query.trim()}”`,
    list.group && `“${workGroupOf(list.group).label}”`,
    list.etapa && (list.etapa === "problema" ? "com problema" : `etapa ${ETAPAS[list.etapa].label}`),
    list.tagFilter.untaggedOnly && "sem tag",
    list.tagFilter.tagIds.length > 0 &&
      `${list.tagFilter.tagIds.length === 1 ? "tag" : "tags"} ${list.tagFilter.tagIds
        .map((id) => tags.byId.get(id)?.name)
        .filter(Boolean)
        .map((nome) => `“${nome}”`)
        .join(list.tagFilter.matchAll ? " e " : " ou ")}`,
  ].filter(Boolean) as string[];

  // Com o contador "Gerar" ligado, gerar todos de uma vez — o lote abre a
  // lista para conferir, e nada é enviado antes da confirmação.
  const loteGerar =
    list.group === "gerar" && visible.length > 1 ? (
      <DisabledHint reason={can("gerar") ? null : noPermission.gerar}>
        <Button variant="outline" disabled={!can("gerar")} onClick={() => generateMany(visible)}>
          <Sparkles />
          Gerar os {visible.length} em lote
        </Button>
      </DisabledHint>
    ) : null;

  const vazio = () => {
    if (list.filtersActive) {
      return (
        <ProjectTableEmpty
          title="Nenhum projeto com estes filtros"
          description={`Nada ${list.tab === "ativos" ? "entre os ativos" : list.tab === "no-ar" ? "entre os que estão no ar" : "entre os finalizados"} com ${filtros.join(", ")}.`}
          action={
            <Button variant="outline" onClick={list.clearFilters}>
              <X />
              Limpar filtros
            </Button>
          }
        />
      );
    }
    if (projects.length === 0) {
      return (
        <ProjectTableEmpty
          title="Nenhum projeto ainda"
          description="As pastas da coleta no Drive aparecem aqui. Se a pasta raiz tem coletas, confira se ela foi compartilhada com a service account."
        />
      );
    }
    if (list.tab === "finalizados") {
      return (
        <ProjectTableEmpty
          title="Nenhum projeto finalizado"
          description="Marque um projeto com a tag “Finalizado” (ou use “Finalizar” na seleção) para ele sair da lista de trabalho e vir para cá."
        />
      );
    }
    if (list.tab === "no-ar") {
      return <ProjectTableEmpty title="Nenhum site no ar ainda" description="Os projetos publicados no domínio do cliente aparecem aqui." />;
    }
    return (
      <ProjectTableEmpty
        title="Nada ativo agora"
        description="Todos os projetos estão no ar ou finalizados."
        action={
          <Button variant="outline" onClick={() => list.setTab("no-ar")}>
            Ver os que estão no ar
          </Button>
        }
      />
    );
  };

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Fila de produção dos sites: em que etapa cada um está e o que fazer agora."
        actions={
          <>
            <ClaudeQueueButton projects={projects} onOpenProject={openClaude} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Mais ações da página" title="Mais ações">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem disabled={checkingLinks} onSelect={() => void checkLinks()}>
                  <Link2 />
                  {checkingLinks ? "Verificando os links…" : "Verificar todos os links agora"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!can("organizar")} onSelect={() => setManagingTags(true)} className="items-start">
                  <Settings2 className="mt-0.5" />
                  <span>
                    <span className="block">Gerenciar tags</span>
                    {!can("organizar") && <span className="block text-xs text-muted-foreground">{noPermission.organizar}</span>}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DisabledHint reason={can("organizar") ? null : noPermission.organizar}>
              <Button onClick={() => setCreating(true)} disabled={!can("organizar")}>
                <Plus />
                Novo projeto
              </Button>
            </DisabledHint>
          </>
        }
      >
        {!can("organizar") && <Reason>{noPermission.organizar} Criar projeto e mexer em tags ficam desligados.</Reason>}
      </PageHeader>

      <MonthIntakeChart
        projects={projects}
        finishedTagId={tags.finishedTagId}
        reference={agora}
        loading={loading}
        unavailable={Boolean(error) && projects.length === 0}
      />

      <PageColumns
        asideLabel="Ao lado da lista"
        aside={
          // Sem a lista, "nada aconteceu" seria falso: a falha já está escrita ao lado.
          !(error && projects.length === 0) && <ActivityFeed projects={naoOcultos} loading={loading} onOpen={openTimeline} />
        }
      >
        {/* `overflow-clip` recorta os cantos sem virar área de rolagem: a faixa
            de data consegue ficar presa no topo da página. Com o nome da faixa
            na margem (`margem:`), o cartão deixa ele passar da borda — nada
            encosta nos cantos ali: o topo são os filtros e o fim, o rodapé. */}
        <Card className="min-w-0 gap-0 overflow-clip py-0 margem:overflow-visible">
          <ListFilters list={list} tags={tags} onManageTags={() => setManagingTags(true)} action={loteGerar} />
          {error ? (
            <ErrorNotice
              title="Não foi possível carregar os projetos"
              error={error}
              onRetry={() => void list.load(true)}
              className="py-14"
            />
          ) : loading ? (
            <ProjectTableSkeleton />
          ) : visible.length === 0 ? (
            vazio()
          ) : (
            <ProjectTable
              projects={visible}
              tags={tags}
              tagUsage={tagUsage}
              onOpen={openProject}
              onTagsChange={list.applyTags}
              selectedIds={list.selectedIds}
              onToggleSelect={list.toggleSelected}
              actions={actions}
              groupDate={groupDate}
              reference={agora}
            />
          )}
          {!loading && !error && (
            <ListFooter updatedAt={fetchedAt && formatTime(fetchedAt)}>
              {pluralize(visible.length, "projeto")}
              {filtros.length > 0 ? ` · filtrando por ${filtros.join(", ")}` : list.sort === "prioridade" ? " · o que pede ação primeiro" : ""}
            </ListFooter>
          )}
        </Card>
      </PageColumns>

      {/* A barra de seleção fica fixa no rodapé: a folga evita que ela cubra a última linha. */}
      {list.selectedIds.size > 0 && <div aria-hidden className="h-16" />}
      <BulkActionsBar
        list={list}
        tags={tags}
        visible={visible}
        approvalAreaReady={approvalAreaReady}
        onGenerate={generateMany}
        responsibles={responsibles}
      />

      <ProjectFilesDialog
        project={selected ? (projects.find((p) => p.id === selected.id) ?? selected) : null}
        tags={tags}
        tab={projectTab}
        onTabChange={setProjectTab}
        focusShareInput={focusShare}
        onOpenChange={(value) => !value && setSelected(null)}
        actions={actions}
        onTagsChange={list.applyTags}
        onGenerationChange={list.patchGeneration}
      />

      <GenerateSiteDialog
        project={generating?.project ?? null}
        engine={generating?.engine ?? null}
        onOpenChange={(value) => !value && setGenerating(null)}
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
        onOpenChange={(value) => !value && setQuick(null)}
        onReview={(project) => {
          setQuick(null);
          startGeneration(project);
        }}
        onGenerated={() => void list.load(true)}
      />

      <ReplyAgentDialog project={replying} onOpenChange={(value) => !value && setReplying(null)} onReplied={patchGeneration} />

      {publishing && (
        <Suspense fallback={null}>
          <PublishDialog
            project={publishing}
            onOpenChange={(value) => !value && setPublishing(null)}
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
        onOpenChange={(value) => !value && setLinking(null)}
        // O vínculo pode ter mudado a publicação também ("já está no ar"):
        // relê a lista inteira em vez de remendar só a geração.
        onLinked={() => list.load()}
      />

      <ChangeProjectDialog
        project={changing}
        approvalAreaReady={approvalAreaReady}
        onOpenChange={(value) => !value && setChanging(null)}
        onChanged={() => list.load()}
      />

      <NewProjectDialog open={creating} onOpenChange={setCreating} onCreated={afterCreate} />

      <ManageTagsDialog
        controller={tags}
        counts={tagUsage}
        onTagRemoved={list.forgetTag}
        open={managingTags}
        onOpenChange={setManagingTags}
      />

      <PushSiteDialog
        project={pushing ? (projects.find((p) => p.id === pushing.id) ?? pushing) : null}
        approvalAreaReady={approvalAreaReady}
        onOpenChange={(value) => !value && setPushing(null)}
        onPushed={() => list.load()}
      />

      <ClaudePushDialog
        project={pushingClaude ? (projects.find((p) => p.id === pushingClaude.id) ?? pushingClaude) : null}
        onOpenChange={(value) => !value && setPushingClaude(null)}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleting ? projectIdentity(deleting).label : "o projeto"}?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto sai do painel junto com os arquivos guardados nele, as tags e o registro do site. Não dá para
              desfazer. O repositório no GitHub e o site já publicado continuam como estão.
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

      <EditProjectDialog
        project={editing ? (projects.find((p) => p.id === editing.id) ?? editing) : null}
        responsibles={responsibles}
        onOpenChange={(value) => !value && setEditing(null)}
        onSubmit={list.applyDetails}
      />
    </>
  );
}
