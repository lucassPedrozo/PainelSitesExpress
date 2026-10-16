import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCw,
  Save,
  Settings2,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api/errors";
import type { Project } from "@/lib/api";
import { setGenerationRepository } from "@/lib/api";
import { latestGeneration } from "@/features/projects/project-status";
import { lovableEditorUrl } from "@/features/projects/next-step";
import { deployApi, isRunActive, type WorkflowRun } from "@/lib/api/deploy";
import { projectIdentity } from "@/lib/format";
import { noPermission, usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { requestNotificationPermission } from "@/lib/notifications";
import { Reason } from "@/components/disabled-hint";
import { ErrorNotice } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { errorMessage } from "./error-message";
import type { ValidationErrors } from "./deploy-types";
import { PublicationFields } from "./publication-form";
import { OutdatedWorkflowsAlert } from "./publication-summary";
import {
  publishTargetOf,
  readyToPublish,
  suggestRepository,
} from "./publish-target";
import { RepositoryPicker } from "./repository-picker";
import { SuggestionNote } from "./suggestion-note";
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
 *
 * Molde de diálogo alto: cabeçalho com o projeto, o domínio e o estado;
 * corpo que rola sozinho; rodapé só com "Cancelar" e a ação principal da
 * vez — que antes ficava no fim de uma rolagem, junto com o cabeçalho.
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
      <DialogContent layout="sectioned" className="sm:max-w-2xl">
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
  const podePublicar = usePermissions().can("publicar");
  const formId = useId();

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

  const label = projectIdentity(project).label;
  const dominio = publicacao?.domain || target.domain || "sem domínio na coleta";
  const mostrarPronto = Boolean(repo) && pronto && !editing;
  const mostrarFormulario =
    Boolean(repo) && (!pronto || editing) && !repositorio.isCheckingWorkflow;
  const carregando = !painel.status && !painel.statusError;
  const semConfiguracao = Boolean(painel.status?.setupRequired);
  // "Nenhum repositório para este site" só quando a lista respondeu: uma
  // falha ou uma lista que ainda vem a caminho não são a mesma coisa.
  const semRepositorio =
    !repo && painel.reposLoaded && !painel.reposError && !painel.isLoadingRepos;

  /** O estado em poucas palavras, no cabeçalho, ao lado do domínio. */
  const estado = painel.statusError
    ? "sem conexão com a API"
    : carregando
      ? "carregando…"
      : semConfiguracao
        ? "publicação não configurada no painel"
        : dispatchedAt
          ? !execucao
            ? "esperando o GitHub…"
            : isRunActive(execucao)
              ? "publicando…"
              : execucao.conclusion === "success"
                ? "publicado"
                : "a publicação falhou"
          : painel.reposError && !repo
            ? "não foi possível ler os repositórios"
            : !repo
              ? painel.isLoadingRepos || !painel.reposLoaded
                ? "lendo os repositórios…"
                : "sem repositório no GitHub"
              : repositorio.isCheckingWorkflow && !pronto
                ? "conferindo o repositório…"
                : mostrarPronto
                  ? "pronto para publicar"
                  : editing
                    ? "alterando a configuração"
                    : "falta configurar a publicação";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate" title={label}>
          Publicar — {label}
        </DialogTitle>
        <DialogDescription>
          {dominio} · {estado}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        {painel.statusError ? (
          <ErrorNotice
            title="Não foi possível conectar à API"
            error={painel.statusError}
            onRetry={() => void painel.reloadStatus()}
          />
        ) : carregando ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando a configuração de publicação…
          </p>
        ) : semConfiguracao ? (
          <p className="text-sm text-muted-foreground">
            A publicação ainda não foi configurada (token do GitHub e organização). Isso é feito na
            seção Deploy.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="publish-repo">Repositório</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={painel.isLoadingRepos}
                  onClick={() => void painel.reloadRepos()}
                  title="Um repositório recém-conectado no Lovable aparece depois de reler a lista do GitHub"
                >
                  <RefreshCw className={painel.isLoadingRepos ? "animate-spin" : undefined} />
                  Reler repositórios
                </Button>
              </div>
              <RepositoryPicker
                id="publish-repo"
                repos={painel.repos}
                selected={repo}
                loading={painel.isLoadingRepos}
                configured={publicacoes.configured}
                domains={publicacoes.domains}
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
            </div>

            {painel.reposError && !repo ? (
              <ErrorNotice
                title="Não foi possível ler os repositórios do GitHub"
                error={painel.reposError}
                onRetry={() => void painel.reloadRepos()}
                className="rounded-lg border"
              />
            ) : (
              semRepositorio && (
                <ConnectGitHubNote
                  organization={painel.status?.organization ?? ""}
                  repoName={target.lovableRepoNames[0] ?? null}
                  editorUrl={lovableEditorUrl(project)}
                />
              )
            )}

            {repo && repositorio.isCheckingWorkflow && !pronto && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Conferindo o repositório…
              </p>
            )}

            {/* Não deu para ler os workflows: o formulário continua (salvar
                grava tudo de novo), mas a tela não finge que eles não existem. */}
            {repo && Boolean(repositorio.workflowsError) && !repositorio.isCheckingWorkflow && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Não foi possível conferir os workflows do repositório</AlertTitle>
                <AlertDescription>
                  <span className="block">
                    {errorMessage(repositorio.workflowsError) ?? "Tente de novo em alguns instantes."}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="px-0"
                    onClick={() => void repositorio.reloadWorkflows()}
                  >
                    Tentar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* O aviso de versão antiga aparece uma vez, com a mesma
                instrução do resumo na seção Deploy. */}
            {repo && repositorio.outdatedWorkflows.length > 0 && <OutdatedWorkflowsAlert />}

            {mostrarPronto && (
              <div className="flex flex-wrap items-start gap-3 rounded-lg border p-4">
                <p className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>
                    Tudo configurado para <b className="font-medium">{publicacao?.domain}</b>. A
                    senha FTP já está no repositório; publicar roda o build e o envio por FTP no
                    GitHub Actions, e o selo do projeto acompanha até o fim.
                  </span>
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Settings2 />
                  Alterar configuração
                </Button>
              </div>
            )}

            {mostrarFormulario && (
              <form id={formId} onSubmit={saveAndPublish} noValidate>
                <PublicationFields
                  settings={settings.settings}
                  errors={errors}
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
                />
              </form>
            )}

            {dispatchedAt && <RunProgress run={execucao} />}
          </>
        )}

        {/* Sem configuração, abrir a seção Deploy já é a ação principal, no
            rodapé — aqui ela só repetiria. */}
        {!semConfiguracao && (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="px-0 text-muted-foreground"
            onClick={onOpenDeployTab}
          >
            Abrir na seção Deploy (simulação, workflows e histórico)
          </Button>
        )}
      </DialogBody>

      {/* Rodapé só com ações: "Cancelar" ao lado da principal da vez. O
          motivo de a principal estar travada fica escrito, à esquerda. */}
      <DialogFooter>
        {(mostrarPronto || mostrarFormulario) && !podePublicar && (
          <Reason className="sm:mr-auto">{noPermission.publicar}</Reason>
        )}
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {dispatchedAt ? "Fechar" : "Cancelar"}
          </Button>
        </DialogClose>
        {semConfiguracao ? (
          <Button type="button" onClick={onOpenDeployTab}>
            Abrir a seção Deploy
          </Button>
        ) : mostrarPronto ? (
          <Button
            type="button"
            disabled={busy !== null || !podePublicar}
            onClick={() => void dispatch()}
          >
            {busy === "dispatching" ? <Loader2 className="animate-spin" /> : <PlayCircle />}
            Publicar agora
          </Button>
        ) : mostrarFormulario ? (
          <Button type="submit" form={formId} disabled={busy !== null || !podePublicar}>
            {busy !== null ? <Loader2 className="animate-spin" /> : <Save />}
            {busy !== null ? "Gravando..." : "Salvar e publicar"}
          </Button>
        ) : null}
      </DialogFooter>
    </>
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
        . Depois, volte aqui e clique em <b className="font-medium">Reler repositórios</b>.
      </p>
      {editorUrl && (
        <Button asChild size="sm" variant="outline">
          <a href={editorUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
            Abrir no Lovable
          </a>
        </Button>
      )}
    </div>
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
