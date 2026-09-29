import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCw,
  Settings2,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/access-token";
import type { Project } from "@/lib/api";
import { setGenerationRepository } from "@/lib/api";
import { latestGeneration } from "@/features/projects/project-status";
import { lovableEditorUrl } from "@/features/projects/next-step";
import { deployApi, isRunActive, type WorkflowRun } from "@/lib/api/deploy";
import { projectIdentity } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ValidationErrors } from "./deploy-types";
import { PublicationForm } from "./publication-form";
import {
  publishTargetOf,
  readyToPublish,
  suggestRepository,
  type RepositorySuggestion,
} from "./publish-target";
import { RepositoryPicker } from "./repository-picker";
import { configuredRepositories } from "./settings-store";
import {
  useDeployStatus,
  usePublications,
  useRepositoryData,
} from "./use-deploy-data";
import { usePublicationSettings } from "./use-publication-settings";
import { serverErrorField, validateSettings } from "./validation";

/**
 * Publicar sem sair do projeto.
 *
 * O "Publicar" do card levava à aba Deploy: 66 repositórios, dois botões em
 * sequência e o dry-run no meio do caminho. Aqui fica o caso de todo dia —
 * o repositório já sugerido, a configuração pronta quando o painel já
 * publicou este domínio, e um botão. O formulário só aparece quando falta
 * alguma coisa, e salvar já publica. A aba Deploy continua para o resto.
 */
export default function PublishDialog({
  project,
  onOpenChange,
  onOpenDeployTab,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  /** A tela completa, com dry-run, workflows e histórico. */
  onOpenDeployTab: (project: Project) => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-y-auto sm:max-w-2xl">
        {project && (
          <PublishContent
            key={project.id}
            project={project}
            onOpenDeployTab={() => onOpenDeployTab(project)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PublishContent({
  project,
  onOpenDeployTab,
}: {
  project: Project;
  onOpenDeployTab: () => void;
}) {
  const queryClient = useQueryClient();
  const painel = useDeployStatus();
  const publicacoes = usePublications();
  const target = useMemo(() => publishTargetOf(project), [project]);

  const [chosenId, setChosenId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const sugestao = suggestRepository(painel.repos, publicacoes.byDomain, target);
  const escolhido = painel.repos.find((item) => item.id === chosenId);
  const repo = escolhido ?? sugestao?.repo;
  const site = latestGeneration(project);

  const repositorio = useRepositoryData({
    repo,
    deployWorkflowFile: painel.deployWorkflowFile,
    templateVersion: painel.templateVersion,
  });
  const publicacao = repo ? publicacoes.byRepo.get(repo.fullName) : undefined;
  const settings = usePublicationSettings({
    repoFullName: repo?.fullName ?? "",
    defaultFtpHost: painel.status?.defaultFtpHost ?? "",
    initialDomain: target.domain,
    knownDomain: publicacao?.domain,
    knownSettings: publicacao?.settings,
    detectedAutoDeploy: repositorio.detectedAutoDeploy,
  });

  const pronto = readyToPublish({
    canDeploy: repositorio.canDeploy,
    publication: publicacao,
    domain: target.domain,
  });
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"saving" | "dispatching" | null>(null);
  /** Momento do disparo: a execução que interessa é a primeira depois dele. */
  const [dispatchedAt, setDispatchedAt] = useState<number | null>(null);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.publications });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };

  /**
   * Publicar confirma o repositório: fica ligado ao site, e da próxima vez
   * ele vem certo, sem palpite. Falhar aqui não desfaz a publicação.
   */
  const bindRepository = async () => {
    if (!repo || !site?.id || site.repoFullName === repo.fullName) return;
    try {
      await setGenerationRepository(project.id, site.id, repo.fullName);
    } catch (error) {
      console.warn("Não foi possível ligar o repositório ao site:", error);
    }
  };

  const falhar = (error: unknown, title: string) => {
    if (error instanceof ApiError && error.status === 401) return;
    const message = error instanceof Error ? error.message : "Tente novamente.";
    const field =
      error instanceof ApiError && error.status === 400 ? serverErrorField(message) : undefined;
    if (field) {
      setErrors({ [field]: message });
      if (field === "serverDir" || field === "port" || field === "buildEnv") setAdvancedOpen(true);
    }
    toast.error(title, { description: message });
  };

  const dispatch = async () => {
    if (!repo) return;
    requestNotificationPermission();
    setBusy("dispatching");
    try {
      await deployApi.dispatchDeploy(
        repo.owner,
        repo.name,
        repo.defaultBranch,
        false,
        painel.deployWorkflowFile,
      );
      setDispatchedAt(Date.now());
      toast.success("Publicação iniciada", {
        description: "O painel avisa quando terminar.",
      });
      await bindRepository();
      refreshAll();
      window.setTimeout(() => void repositorio.reloadRuns(), 2500);
    } catch (error) {
      falhar(error, "Falha ao disparar a publicação");
    } finally {
      setBusy(null);
    }
  };

  const saveAndPublish = async (event: FormEvent) => {
    event.preventDefault();
    if (!repo) return;
    const next = validateSettings(settings.settings, { hasRepo: true });
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.serverDir || next.port || next.buildEnv) setAdvancedOpen(true);
      toast.error("Revise os campos destacados.");
      return;
    }

    setBusy("saving");
    try {
      await deployApi.configurePublication({
        ...settings.settings,
        domain: settings.settings.domain.trim(),
        ftpServer: settings.settings.ftpServer.trim(),
        ftpLogin: settings.settings.ftpLogin.trim(),
        serverDir: settings.settings.serverDir.trim(),
        port: settings.settings.port.trim(),
        owner: repo.owner,
        repo: repo.name,
        branch: repo.defaultBranch,
      });
      settings.persist();
      setEditing(false);
      await repositorio.reloadWorkflows();
    } catch (error) {
      setBusy(null);
      falhar(error, "Falha ao configurar a publicação");
      return;
    }
    // Os workflows acabaram de ser gravados; o disparo espera o GitHub
    // registrá-los (a API tenta de novo por alguns segundos).
    await dispatch();
  };

  // Canceladas ficam de fora: com vários pushes juntos, a concorrência do
  // workflow cancela as anteriores, e quem publica é a seguinte.
  const execucao = dispatchedAt
    ? repositorio.runs.find(
        (run) =>
          Date.parse(run.createdAt) >= dispatchedAt - 60_000 &&
          run.conclusion !== "cancelled",
      )
    : undefined;

  // A lista de execuções só se atualiza sozinha com uma delas em andamento; a
  // recém-disparada leva alguns segundos para aparecer no GitHub.
  const { reloadRuns } = repositorio;
  const esperandoExecucao = Boolean(dispatchedAt) && !execucao;
  useEffect(() => {
    if (!esperandoExecucao) return;
    const timer = window.setInterval(() => void reloadRuns(), 4000);
    return () => window.clearInterval(timer);
  }, [esperandoExecucao, reloadRuns]);

  if (painel.status?.setupRequired) {
    return (
      <>
        <Header project={project} />
        <p className="text-sm text-muted-foreground">
          A publicação ainda não foi configurada (token do GitHub e organização).
        </p>
        <Button className="self-start" onClick={onOpenDeployTab}>
          Configurar na aba Deploy
        </Button>
      </>
    );
  }

  return (
    <>
      <Header project={project} />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="publish-repo">Repositório</Label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            disabled={painel.isLoadingRepos}
            onClick={() => void painel.reloadRepos()}
            title="Reler a lista do GitHub — um repositório recém-conectado aparece aqui"
          >
            <RefreshCw className={painel.isLoadingRepos ? "size-3 animate-spin" : "size-3"} />
            Atualizar
          </Button>
        </div>
        <RepositoryPicker
          id="publish-repo"
          repos={painel.repos}
          selected={repo}
          loading={painel.isLoadingRepos}
          configured={configuredRepositories()}
          domains={
            new Map(
              publicacoes.items
                .filter((item) => item.domain)
                .map((item) => [item.repoFullName, item.domain as string]),
            )
          }
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(item) => {
            setChosenId(item.id);
            setErrors({});
            setPickerOpen(false);
          }}
        />
        {!escolhido && sugestao && (
          <SuggestionNote suggestion={sugestao} lovableName={site?.lovableName ?? null} />
        )}
        {!repo && !painel.isLoadingRepos && (
          <ConnectGitHubNote
            organization={painel.status?.organization ?? ""}
            repoName={target.lovableRepoNames[0] ?? null}
            editorUrl={lovableEditorUrl(project)}
          />
        )}
      </div>

      {repo && repositorio.isCheckingWorkflow && !pronto && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Conferindo o repositório…
        </p>
      )}

      {repo && pronto && !editing && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <span>
              Tudo configurado para <b className="font-medium">{publicacao?.domain}</b>.
              A senha FTP já está no repositório.
            </span>
          </p>
          {repositorio.outdatedWorkflows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Os workflows são de uma versão antiga do painel — publicam
              normalmente, mas sem a conferência da assinatura Joinvix no build.
              “Alterar configuração” atualiza (pede a senha FTP).
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" disabled={busy !== null} onClick={() => void dispatch()}>
              {busy === "dispatching" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PlayCircle className="size-4" />
              )}
              Publicar agora
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Settings2 className="size-4" />
              Alterar configuração
            </Button>
          </div>
        </div>
      )}

      {repo && (!pronto || editing) && !repositorio.isCheckingWorkflow && (
        <form onSubmit={saveAndPublish} noValidate>
          {repositorio.outdatedWorkflows.length > 0 && (
            <p className="mb-3 text-xs text-warning">
              Os workflows deste repositório são de uma versão antiga do painel —
              salvar atualiza.
            </p>
          )}
          <PublicationForm
            settings={settings.settings}
            errors={errors}
            isSaving={busy !== null}
            disabled={busy !== null}
            suggestedDomain={target.domain}
            advancedOpen={advancedOpen}
            onAdvancedOpenChange={setAdvancedOpen}
            onChange={(patch) => {
              settings.update(patch);
              setErrors((current) => {
                const next = { ...current };
                for (const key of Object.keys(patch)) delete next[key as keyof ValidationErrors];
                return next;
              });
            }}
            submitLabel="Salvar e publicar"
            showStep={false}
          />
        </form>
      )}

      {dispatchedAt && <RunProgress run={execucao} />}

      <button
        type="button"
        className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={onOpenDeployTab}
      >
        Abrir na aba Deploy (simulação, workflows e histórico)
      </button>
    </>
  );
}

/** Por que este repositório — só o palpite pede conferência. */
function SuggestionNote({
  suggestion,
  lovableName,
}: {
  suggestion: RepositorySuggestion;
  lovableName: string | null;
}) {
  const texto = {
    bound: "Confirmado para este site na publicação anterior.",
    published: "É o repositório que já publicou este domínio.",
    "lovable-name": `Tem o nome do projeto no Lovable${lovableName ? ` (“${lovableName}”)` : ""}.`,
    guess: "Palpite pelo nome da coleta — confira antes de publicar.",
  }[suggestion.reason];
  return (
    <p
      className={
        suggestion.reason === "guess"
          ? "text-xs text-warning"
          : "text-xs text-muted-foreground"
      }
    >
      {texto}
    </p>
  );
}

/**
 * Sem repositório ainda: o projeto não foi conectado ao GitHub no Lovable.
 * O MCP não faz essa conexão, então o painel diz exatamente o que fazer — e
 * o nome que o repositório vai ter, que é como ele será reconhecido.
 */
function ConnectGitHubNote({
  organization,
  repoName,
  editorUrl,
}: {
  organization: string;
  repoName: string | null;
  editorUrl: string | null;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
      <p>
        Nenhum repositório para este site ainda. No Lovable, conecte o projeto ao
        GitHub{organization ? <> na organização <b className="font-medium text-foreground">{organization}</b></> : null}
        {repoName ? (
          <>
            {" "}— o repositório vai se chamar{" "}
            <code className="rounded bg-muted px-1 text-foreground">{repoName}</code>
          </>
        ) : null}
        . Depois, volte aqui e clique em <b className="font-medium">Atualizar</b>.
      </p>
      {editorUrl && (
        <Button asChild size="sm" variant="outline">
          <a href={editorUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            Abrir no Lovable
          </a>
        </Button>
      )}
    </div>
  );
}

function Header({ project }: { project: Project }) {
  return (
    <DialogHeader>
      <DialogTitle>Publicar — {projectIdentity(project).label}</DialogTitle>
      <DialogDescription>
        Build e envio por FTP no GitHub Actions. O selo do card acompanha até o fim.
      </DialogDescription>
    </DialogHeader>
  );
}

/** A execução disparada, ao vivo — as consultas se atualizam enquanto ela roda. */
function RunProgress({ run }: { run: WorkflowRun | undefined }) {
  if (!run) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Esperando o GitHub criar a execução…
      </p>
    );
  }
  const ativo = isRunActive(run);
  const ok = run.conclusion === "success";
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      {ativo ? (
        <Loader2 className="size-4 animate-spin text-info" />
      ) : ok ? (
        <CheckCircle2 className="size-4 text-success" />
      ) : (
        <XCircle className="size-4 text-destructive" />
      )}
      {ativo ? "Publicando…" : ok ? "Publicado com sucesso." : "A publicação falhou."}
      <a
        href={run.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Ver no GitHub
        <ExternalLink className="size-3" />
      </a>
    </p>
  );
}
