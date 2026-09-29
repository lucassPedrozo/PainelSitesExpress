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

  const busy = list.loading || list.refreshing;

  // A tela de configuração aparece para quem tem a permissão `configurar` —
  // no localhost ou pela rede, a mesma regra: quem decide é a chave de acesso.
  const { can } = usePermissions();
  const canConfigure = can("configurar");

  return (
    <div className="min-h-svh bg-background">
      <AppHeader
        section={section}
        onSectionChange={(next) => {
          setSettingsFocus(null);
          setSection(next);
        }}
        canConfigure={canConfigure}
      >
        {section === "projects" && (
          <>
            <div className="relative ml-auto w-full max-w-sm min-w-32">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={list.query}
                onChange={(event) => list.setQuery(event.target.value)}
                placeholder="Buscar projeto ou domínio..."
                className="pl-8"
              />
            </div>

            <Button
              variant="outline"
              className="shrink-0"
              disabled={busy}
              onClick={() => list.load(true)}
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </>
        )}
      </AppHeader>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        {section === "settings" && canConfigure ? (
          <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
            <SettingsView focusSection={settingsFocus} />
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
