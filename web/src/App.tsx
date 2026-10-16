import { lazy, Suspense, useCallback, useState } from "react";
import type { Project } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import type { PublishTarget } from "@/features/deploy/publish-target";
import { publishTargetOf } from "@/features/deploy/publish-target";
import { ProjectsView } from "@/features/projects/projects-view";
import { tabOf } from "@/features/projects/stage";
import type { WorkFilter } from "@/features/dashboard/dashboard-view";
import { useProjectList } from "@/features/projects/use-project-list";
import { useStageAlerts } from "@/features/projects/use-stage-alerts";
import { useTags } from "@/features/tags/use-tags";
import { AppHeader, type PanelSection } from "@/app-header";
import { Toaster } from "@/components/ui/sonner";
import { PageSkeleton } from "@/components/page-layout";

/**
 * A seção de Deploy carrega sob demanda. Ela traz consigo o cliente do GitHub,
 * o seletor com busca e os cartões de workflow — e raramente é a primeira tela
 * que se abre.
 */
const DeployView = lazy(() => import("@/features/deploy/deploy-view").then((m) => ({ default: m.DeployView })));

/** O dashboard também: só quem o abre baixa a linha do tempo e as tabelas. */
const DashboardView = lazy(() =>
  import("@/features/dashboard/dashboard-view").then((m) => ({ default: m.DashboardView })),
);

/** A tela de configuração também carrega sob demanda. */
const SettingsView = lazy(() =>
  import("@/features/settings/settings-view").then((m) => ({ default: m.SettingsView })),
);

export default function App() {
  const tags = useTags();
  /**
   * Carga, filtro, ordenação e escritas otimistas vivem no hook. Ele fica
   * aqui, e não na seção de projetos, porque a busca e o "Atualizar" moram
   * no cabeçalho, e o Dashboard lê a mesma lista.
   */
  const list = useProjectList(tags);
  // Aqui, e não na seção de projetos: o aviso vale também com o Deploy aberto.
  useStageAlerts(list.projects);
  /** O nome de cada tag — a coluna "Tags" do relatório do Dashboard. */
  const { byId: tagsById } = tags;
  const tagName = useCallback((id: string) => tagsById.get(id)?.name, [tagsById]);

  const [section, setSection] = useState<PanelSection>("projects");
  // A seção de Configurações a mostrar quando outra tela manda para lá.
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  const openSettings = (sectionId: string) => {
    setSettingsFocus(sectionId);
    setSection("settings");
  };
  /** Coleta que originou a publicação: leva domínio e pista do repositório. */
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null);

  const startPublication = useCallback((project: Project) => {
    setPublishTarget(publishTargetOf(project));
    setSection("deploy");
  }, []);

  /** Do Dashboard à seção de projetos, já com o projeto na tela. */
  const { showProject, clearFilters, setTab, toggleGroup } = list;
  const showInProjects = useCallback(
    (project: Project) => {
      showProject(project, tabOf(project, tags.finishedTagId));
      setSection("projects");
    },
    [showProject, tags.finishedTagId],
  );

  /** Do Dashboard à lista, já com o grupo de trabalho ou a etapa ligados. */
  const { setEtapa } = list;
  const openWork = useCallback(
    ({ group, etapa }: WorkFilter) => {
      clearFilters();
      setTab(etapa === "no-ar" ? "no-ar" : "ativos");
      if (group) toggleGroup(group);
      if (etapa && etapa !== "no-ar") setEtapa(etapa);
      setSection("projects");
    },
    [clearFilters, setTab, toggleGroup, setEtapa],
  );

  // A tela de configuração aparece para quem tem a permissão `configurar` —
  // no localhost ou pela rede, a mesma regra: quem decide é a chave de acesso.
  const { can } = usePermissions();
  const canConfigure = can("configurar");
  const showsList = section === "projects" || section === "dashboard";

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#conteudo"
        className="sr-only rounded-md bg-card px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Pular para o conteúdo
      </a>
      <AppHeader
        section={section}
        onSectionChange={(next) => {
          setSettingsFocus(null);
          setSection(next);
        }}
        canConfigure={canConfigure}
        query={list.query}
        onQueryChange={list.setQuery}
        onSearch={() => setSection("projects")}
        onRefresh={showsList ? () => void list.load(true) : null}
        refreshing={list.loading || list.refreshing}
        fetchedAt={list.fetchedAt}
      />

      {/* Todas as telas no molde da tela de Projetos: a mesma largura
          (`max-w-wide`), o título no topo e 20 px entre os blocos. */}
      <main key={section} id="conteudo" tabIndex={-1} className="mx-auto max-w-wide animate-appear space-y-5 px-4 py-6 outline-none md:px-6">
        {section === "settings" && canConfigure ? (
          <Suspense fallback={<PageSkeleton />}>
            <SettingsView focusSection={settingsFocus} />
          </Suspense>
        ) : section === "dashboard" ? (
          <Suspense fallback={<PageSkeleton />}>
            <DashboardView
              list={list}
              finishedTagId={tags.finishedTagId}
              tagName={tagName}
              onShowInProjects={showInProjects}
              onOpenWork={openWork}
            />
          </Suspense>
        ) : section === "deploy" ? (
          <Suspense fallback={<PageSkeleton />}>
            <DeployView
              target={publishTarget}
              onTargetConsumed={() => setPublishTarget(null)}
              onOpenSettings={canConfigure ? openSettings : undefined}
            />
          </Suspense>
        ) : (
          <ProjectsView tags={tags} list={list} onOpenDeployTab={startPublication} />
        )}
      </main>

      <Toaster position="bottom-right" />
    </div>
  );
}
