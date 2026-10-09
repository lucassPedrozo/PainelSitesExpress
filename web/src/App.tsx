import { lazy, Suspense, useCallback, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { Project } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import type { PublishTarget } from "@/features/deploy/publish-target";
import { publishTargetOf } from "@/features/deploy/publish-target";
import { ProjectsView } from "@/features/projects/projects-view";
import type { ProjectsLayout } from "@/features/projects/projects-toolbar";
import { useProjectList } from "@/features/projects/use-project-list";
import { useStageAlerts } from "@/features/projects/use-stage-alerts";
import { useTags } from "@/features/tags/use-tags";
import { AppHeader, type PanelSection } from "@/app-header";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A seção de Deploy carrega sob demanda. Ela traz consigo o cliente do GitHub,
 * o seletor com busca e os cartões de workflow — e raramente é a primeira tela
 * que se abre. Sem isso, tudo isso entrava no bundle inicial de quem só quer
 * ver os projetos.
 */
const DeployView = lazy(() =>
  import("@/features/deploy/deploy-view").then((m) => ({
    default: m.DeployView,
  })),
);

/** O dashboard também: só quem o abre baixa a linha do tempo e as tabelas. */
const DashboardView = lazy(() =>
  import("@/features/dashboard/dashboard-view").then((m) => ({
    default: m.DashboardView,
  })),
);

/** A tela de configuração também carrega sob demanda. */
const SettingsView = lazy(() =>
  import("@/features/settings/settings-view").then((m) => ({
    default: m.SettingsView,
  })),
);

export default function App() {
  const tags = useTags();
  /**
   * Carga, filtro, ordenação, agrupamento e escritas otimistas vivem no hook.
   * Ele fica aqui, e não na seção de projetos, porque a busca e o "Atualizar"
   * moram no cabeçalho.
   */
  const list = useProjectList(tags);
  // Aqui, e não na seção de projetos: o aviso vale também com o Deploy aberto.
  useStageAlerts(list.projects);

  const [layout, setLayout] = useState<ProjectsLayout>("grid");
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

  /** Do dashboard à seção de projetos, já com o projeto na tela. */
  const showInProjects = useCallback(
    (project: Project) => {
      list.clearFilters();
      list.setQuery(project.alias ?? project.name);
      const finished = tags.finishedTagId;
      list.setView(finished && project.tagIds.includes(finished) ? "finished" : "all");
      setSection("projects");
    },
    [list, tags.finishedTagId],
  );

  const openQueue = useCallback(() => {
    list.clearFilters();
    list.setView("queue");
    setSection("projects");
  }, [list]);

  const busy = list.loading || list.refreshing;

  // A tela de configuração aparece para quem tem a permissão `configurar` —
  // no localhost ou pela rede, a mesma regra: quem decide é a chave de acesso.
  const { can } = usePermissions();
  const canConfigure = can("configurar");

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
      >
        {(section === "projects" || section === "dashboard") && (
          <>
            {section === "projects" && (
            <div className="relative w-full min-w-32 md:max-w-sm">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={list.query}
                onChange={(event) => list.setQuery(event.target.value)}
                placeholder="Buscar projeto ou domínio..."
                aria-label="Buscar projeto ou domínio"
                className="pl-8"
              />
            </div>
            )}

            <Button
              variant="outline"
              className="shrink-0"
              disabled={busy}
              onClick={() => list.load(true)}
              aria-label="Atualizar"
              title="Atualizar a lista de projetos"
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              <span className="hidden lg:inline">Atualizar</span>
            </Button>
          </>
        )}
      </AppHeader>

      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-[1400px] space-y-6 px-6 py-6 outline-none">
        {section === "settings" && canConfigure ? (
          <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
            <SettingsView focusSection={settingsFocus} />
          </Suspense>
        ) : section === "dashboard" ? (
          <Suspense
            fallback={
              <div className="space-y-6">
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-96 rounded-xl" />
              </div>
            }
          >
            <DashboardView
              list={list}
              finishedTagId={tags.finishedTagId}
              onShowInProjects={showInProjects}
              onOpenQueue={openQueue}
            />
          </Suspense>
        ) : section === "deploy" ? (
          <Suspense
            fallback={
              <div className="space-y-6">
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-96 rounded-xl" />
              </div>
            }
          >
            <DeployView
              target={publishTarget}
              onTargetConsumed={() => setPublishTarget(null)}
              onOpenSettings={canConfigure ? openSettings : undefined}
            />
          </Suspense>
        ) : (
          <ProjectsView
            tags={tags}
            list={list}
            layout={layout}
            onLayoutChange={setLayout}
            onOpenDeployTab={startPublication}
          />
        )}
      </main>

      <Toaster position="bottom-right" />
    </div>
  );
}
