import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageColumns, PageSkeleton } from "@/components/page-layout";
import { toast } from "sonner";
import { ApiError } from "@/lib/access-token";
import {
  deployApi,
  type DeleteWorkflowResult,
  type PublicationResult,
  type RepoOption,
  type WorkflowFile,
} from "@/lib/api/deploy";
import type { PreviewContent, ValidationErrors } from "./deploy-types";
import {
  ChooseRepositoryCard,
  DeployHeader,
  DeployStatusError,
  SetupRequiredAlert,
} from "./deploy-placeholders";
import { PublicationForm } from "./publication-form";
import { PublicationSummary } from "./publication-summary";
import { PublishCard } from "./publish-card";
import type { PublishTarget } from "./publish-target";
import { RepositoryBar } from "./repository-bar";
import { PublicationsCard } from "./publications-card";
import { RunsCard } from "./runs-card";
import {
  useDeployStatus,
  usePublications,
  useRepositoryData,
} from "./use-deploy-data";
import { useFirstErrorFocus } from "./use-first-error-focus";
import { usePublicationSettings } from "./use-publication-settings";
import { useSuggestedRepository } from "./use-suggested-repository";
import { serverErrorField, validateSettings } from "./validation";
import { queryKeys } from "@/lib/query";
import { requestNotificationPermission } from "@/lib/notifications";
import { WorkflowCard } from "./workflow-card";
import { ClearWorkflowsDialog, WorkflowPreviewDialog } from "./workflow-dialogs";

type DeployViewProps = {
  /** Publicação aberta a partir de um projeto do Drive. */
  target: PublishTarget | null;
  onTargetConsumed: () => void;
  /** Abre a tela de Configurações numa seção (as credenciais moram lá). */
  onOpenSettings?: (sectionId: string) => void;
};

/**
 * Publicação dos sites: credenciais do repositório, workflows no GitHub e o
 * disparo do deploy.
 *
 * As leituras (status, repositórios, workflows, execuções) moram em
 * `use-deploy-data`; os campos do formulário, em `use-publication-settings`.
 * Aqui fica o que é de tela: o que está selecionado, o que está em andamento e
 * o que cada botão dispara.
 */
export function DeployView({ target, onTargetConsumed, onOpenSettings }: DeployViewProps) {
  const [selectedRepoId, setSelectedRepoId] = useState("");
  /** Repositório já configurado: o formulário só aparece quando pedido. */
  const [editing, setEditing] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [publicationResult, setPublicationResult] =
    useState<PublicationResult | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteWorkflowResult | null>(
    null,
  );

  const queryClient = useQueryClient();
  const painel = useDeployStatus();
  const repos = painel.repos;
  const publicacoes = usePublications();

  const { target: alvo, suggestion, suggested: sugerido } = useSuggestedRepository({
    target,
    onTargetConsumed,
    repos,
    publishedByDomain: publicacoes.byDomain,
  });
  /** Domínio clicado na lista de publicações antes de os repositórios chegarem. */
  const [pendingRepoFullName, setPendingRepoFullName] = useState<string | null>(null);
  const selectedRepo = useMemo(
    () =>
      repos.find((repo) => repo.id === selectedRepoId) ??
      (pendingRepoFullName
        ? repos.find((repo) => repo.fullName === pendingRepoFullName)
        : undefined) ??
      (selectedRepoId ? undefined : (sugerido ?? undefined)),
    [repos, selectedRepoId, pendingRepoFullName, sugerido],
  );

  const repositorio = useRepositoryData({
    repo: selectedRepo,
    deployWorkflowFile: painel.deployWorkflowFile,
    templateVersion: painel.templateVersion,
  });

  const publicacaoAtual = selectedRepo
    ? publicacoes.byRepo.get(selectedRepo.fullName)
    : undefined;

  const settings = usePublicationSettings({
    repoFullName: selectedRepo?.fullName ?? "",
    defaultFtpHost: painel.status?.defaultFtpHost ?? "",
    initialDomain: alvo?.domain,
    knownDomain: publicacaoAtual?.domain,
    knownSettings: publicacaoAtual?.settings,
    detectedAutoDeploy: repositorio.detectedAutoDeploy,
  });

  /**
   * Já configurado: o workflow de deploy está no repositório e o painel
   * gravou uma publicação nele. Aí o caminho comum é só publicar, e o
   * formulário vira um resumo — a um clique para quem precisa mudar algo.
   */
  const configurada = Boolean(
    selectedRepo &&
      repositorio.canDeploy &&
      publicacaoAtual?.configuredAt &&
      !repositorio.isCheckingWorkflow,
  );
  const mostrarFormulario = !configurada || editing;

  /**
   * Publicar muda o histórico e, com ele, o estado do projeto na outra seção
   * ("No ar"). As duas listas são relidas sem cada handler lembrar disso.
   */
  const refreshPublished = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.publications });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };

  /**
   * A lista de publicações chega antes da lista de repositórios (o GitHub
   * demora). Um domínio clicado nesse intervalo fica guardado pelo nome e a
   * seleção é derivada dele assim que a lista chega — antes o clique se
   * perdia. Escolher outro repositório no seletor substitui a escolha.
   */
  const openPublication = (repoFullName: string) => {
    const repo = repos.find((item) => item.fullName === repoFullName);
    if (repo) selectRepository(repo);
    else setPendingRepoFullName(repoFullName);
  };
  const pendingNotFound =
    Boolean(pendingRepoFullName) &&
    !painel.isLoadingRepos &&
    repos.length > 0 &&
    !repos.some((item) => item.fullName === pendingRepoFullName);

  const busy = isPublishing || isClearing || isDispatching;

  const focusFirstError = useFirstErrorFocus(advancedOpen, setAdvancedOpen);

  const handleApiError = (error: unknown, title: string) => {
    // O 401 já foi tratado no cliente HTTP: ele leva o painel de volta à tela
    // da chave de acesso, e um toast aqui só faria ruído.
    if (error instanceof ApiError && error.status === 401) return;

    const message =
      error instanceof Error
        ? error.message
        : "Tente novamente em alguns instantes.";

    // Um 400 da API sempre acusa um campo. Devolvê-lo ao campo evita o
    // "Pasta remota inválida" solto num toast, sem dizer onde corrigir.
    const field =
      error instanceof ApiError && error.status === 400
        ? serverErrorField(message)
        : undefined;
    if (field) {
      const next = { [field]: message } as ValidationErrors;
      setErrors(next);
      focusFirstError(next);
    }

    toast.error(title, { description: message });
  };

  const updateSettings = (patch: Parameters<typeof settings.update>[0]) => {
    settings.update(patch);
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        delete next[key as keyof ValidationErrors];
      }
      return next;
    });
  };

  const selectRepository = (repo: RepoOption) => {
    setSelectedRepoId(repo.id);
    setPendingRepoFullName(null);
    setEditing(false);
    setErrors((current) => ({ ...current, repo: undefined }));
    setPublicationResult(null);
    setDeleteResult(null);
  };

  const handlePublish = async (event: FormEvent) => {
    event.preventDefault();
    const next = validateSettings(settings.settings, {
      hasRepo: Boolean(selectedRepo),
    });
    setErrors(next);
    if (Object.keys(next).length > 0 || !selectedRepo) {
      focusFirstError(next);
      toast.error("Revise os campos destacados.");
      return;
    }

    try {
      setIsPublishing(true);
      setPublicationResult(null);
      setDeleteResult(null);
      const result = await deployApi.configurePublication({
        ...settings.settings,
        domain: settings.settings.domain.trim(),
        ftpServer: settings.settings.ftpServer.trim(),
        ftpLogin: settings.settings.ftpLogin.trim(),
        serverDir: settings.settings.serverDir.trim(),
        port: settings.settings.port.trim(),
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch: selectedRepo.defaultBranch,
      });
      setPublicationResult(result);
      settings.persist();
      setEditing(false);
      toast.success("Publicação configurada", {
        description: "Agora é só “Publicar agora”.",
      });
      refreshPublished();
      await repositorio.reloadWorkflows();
    } catch (error) {
      handleApiError(error, "Falha ao configurar publicação");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDeploy = async () => {
    if (!selectedRepo) return;
    if (!dryRun) requestNotificationPermission();
    try {
      setIsDispatching(true);
      await deployApi.dispatchDeploy(
        selectedRepo.owner,
        selectedRepo.name,
        selectedRepo.defaultBranch,
        dryRun,
        painel.deployWorkflowFile,
      );
      toast.success(dryRun ? "Simulação iniciada" : "Publicação iniciada", {
        description: "Acompanhe o progresso na lista de execuções.",
      });
      // O run leva alguns segundos para aparecer na API; a partir daí o
      // recarregamento automático assume enquanto ele estiver em andamento.
      refreshPublished();
      window.setTimeout(() => void repositorio.reloadRuns(), 2500);
      await repositorio.reloadRuns();
    } catch (error) {
      handleApiError(error, "Falha ao disparar a publicação");
    } finally {
      setIsDispatching(false);
    }
  };

  const confirmClear = async () => {
    if (!selectedRepo || !repositorio.workflowFiles.length) return;
    setIsClearOpen(false);
    try {
      setIsClearing(true);
      setPublicationResult(null);
      setDeleteResult(null);
      const result = await deployApi.deleteWorkflowFiles({
        owner: selectedRepo.owner,
        repo: selectedRepo.name,
        branch: selectedRepo.defaultBranch,
        files: repositorio.workflowFiles,
      });
      setDeleteResult(result);
      if (result.status === "success") {
        toast.success("Workflows removidos");
      } else {
        toast.warning("Limpeza concluída com ressalvas", {
          description: "Alguns arquivos não puderam ser removidos.",
        });
      }
      await repositorio.reloadWorkflows();
    } catch (error) {
      handleApiError(error, "Falha ao limpar workflows");
    } finally {
      setIsClearing(false);
    }
  };

  const previewFile = async (file: WorkflowFile) => {
    if (!selectedRepo) return;
    try {
      const content = await deployApi.getWorkflowPreview(
        selectedRepo.owner,
        selectedRepo.name,
        selectedRepo.defaultBranch,
        file.path,
      );
      setPreview({ name: file.name, content });
    } catch (error) {
      handleApiError(error, "Preview indisponível");
    }
  };

  /** O cartão de publicar: primário sozinho, rebaixado como passo 2. */
  const publishCard = (step?: number) => (
    <PublishCard
      canDeploy={repositorio.canDeploy}
      isCheckingWorkflow={repositorio.isCheckingWorkflow}
      workflowError={repositorio.workflowsError}
      onRetryWorkflow={() => void repositorio.reloadWorkflows()}
      dryRun={dryRun}
      busy={busy}
      isDispatching={isDispatching}
      publicationResult={publicationResult}
      onDeploy={handleDeploy}
      onDryRunChange={setDryRun}
      step={step}
    />
  );

  const status = painel.status;

  if (painel.statusError) {
    return <DeployStatusError error={painel.statusError} onRetry={() => void painel.reloadStatus()} />;
  }

  if (!status) return <PageSkeleton />;

  return (
    <div className="space-y-5">
      <DeployHeader
        isLoadingRepos={painel.isLoadingRepos}
        configurable={status.configurable}
        setupRequired={status.setupRequired}
        onReload={() => void painel.reloadRepos()}
        onOpenSettings={() => onOpenSettings?.("github")}
      />

      {status.setupRequired ? (
        <SetupRequiredAlert
          configurable={status.configurable}
          onOpenSettings={() => onOpenSettings?.("github")}
        />
      ) : (
        <>
          {/* O repositório é o contexto da tela inteira, então vem antes de
              tudo — e uma vez só. Antes ele aparecia duas vezes: como cartão
              "Repositório ativo" e como primeiro campo do formulário. */}
          <RepositoryBar
            organization={status.organization}
            repos={repos}
            selectedRepo={selectedRepo}
            configuredRepos={publicacoes.configured}
            repoDomains={publicacoes.domains}
            loading={painel.isLoadingRepos}
            // Sem repositório escolhido, o cartão de convite já mostra a falha.
            loadError={selectedRepo ? painel.reposError : null}
            onRetry={() => void painel.reloadRepos()}
            error={
              errors.repo ??
              (pendingNotFound
                ? `${pendingRepoFullName} não está na organização configurada — escolha na lista.`
                : undefined)
            }
            pickerOpen={pickerOpen}
            onPickerOpenChange={setPickerOpen}
            onSelect={selectRepository}
            target={alvo}
            suggestion={suggestion}
            overridden={Boolean(selectedRepoId)}
          />

          {selectedRepo ? (
            /* O molde da tela de Projetos: o que se faz na coluna principal e,
               na coluna lateral, o que o repositório mostra (execuções e
               workflows). As publicações ficam fora da grade, embaixo: com a
               coluna lateral descendo (abaixo de 1600 px), as execuções vêm
               logo depois do Publicar, e não depois da lista inteira. */
            <PageColumns
              asideLabel="O que o repositório mostra"
              aside={
                <>
                  <RunsCard
                    runs={repositorio.runs}
                    isLoading={repositorio.isLoadingRuns}
                    error={repositorio.runsError}
                    isLive={repositorio.hasActiveRun}
                    onRefresh={() => void repositorio.reloadRuns()}
                  />

                  {/* Detalhe técnico: recolhido e por último. */}
                  <WorkflowCard
                    files={repositorio.workflowFiles}
                    isChecking={repositorio.isCheckingWorkflow}
                    error={repositorio.workflowsError}
                    onRetry={() => void repositorio.reloadWorkflows()}
                    isClearing={isClearing}
                    busy={busy}
                    outdatedWorkflows={repositorio.outdatedWorkflows}
                    deleteResult={deleteResult}
                    onPreview={previewFile}
                    onClear={() => setIsClearOpen(true)}
                  />
                </>
              }
            >
              {/* Já configurado: publicar vem primeiro e a configuração
                  vira leitura. Senão (ou ao alterar), o formulário é o
                  passo 1 e o cartão de publicar, o 2 — rebaixado: com o
                  formulário aberto a ação principal é salvar, e os dois
                  botões cheios lado a lado disputavam o clique. Ele não
                  some porque um repositório com o workflow mas sem
                  configuração gravada pelo painel continua publicável. */}
              {mostrarFormulario ? (
                <>
                  <form onSubmit={handlePublish} noValidate>
                    <PublicationForm
                      settings={settings.settings}
                      errors={errors}
                      isSaving={isPublishing}
                      disabled={busy}
                      suggestedDomain={alvo?.domain}
                      advancedOpen={advancedOpen}
                      onAdvancedOpenChange={setAdvancedOpen}
                      onChange={updateSettings}
                      onCancel={configurada ? () => setEditing(false) : undefined}
                      step={1}
                    />
                  </form>
                  {publishCard(2)}
                </>
              ) : (
                <>
                  {publishCard()}
                  {publicacaoAtual && (
                    <PublicationSummary
                      publication={publicacaoAtual}
                      outdatedWorkflows={repositorio.outdatedWorkflows}
                      disabled={busy}
                      onEdit={() => setEditing(true)}
                    />
                  )}
                </>
              )}
            </PageColumns>
          ) : (
            <ChooseRepositoryCard
              // Antes de a lista chegar, o convite espera em vez de dizer
              // "nenhum repositório"; com erro, quem fala é o erro.
              loading={painel.isLoadingRepos || (!painel.reposLoaded && !painel.reposError)}
              error={painel.reposError}
              repoCount={repos.length}
              organization={status.organization}
              hasPublications={publicacoes.items.length > 0}
              onChoose={() => setPickerOpen(true)}
              onRetry={() => void painel.reloadRepos()}
            />
          )}

          {/* O que já está no ar é da organização, não do repositório. Sem
              repositório escolhido, é por aqui que se chega ao site certo —
              a pessoa pensa no domínio, não no nome que o Lovable deu ao
              repositório. Com um escolhido, fica embaixo, como consulta. */}
          <PublicationsCard
            items={publicacoes.items}
            loading={publicacoes.loading}
            error={publicacoes.error}
            onRetry={() => void publicacoes.reload()}
            selectedRepoFullName={selectedRepo?.fullName}
            onOpen={(item) => openPublication(item.repoFullName)}
          />
        </>
      )}

      <ClearWorkflowsDialog
        open={isClearOpen}
        onOpenChange={setIsClearOpen}
        repo={selectedRepo}
        files={repositorio.workflowFiles}
        onConfirm={confirmClear}
      />

      <WorkflowPreviewDialog
        preview={preview}
        repoFullName={selectedRepo?.fullName}
        onClose={() => setPreview(null)}
      />

    </div>
  );
}
