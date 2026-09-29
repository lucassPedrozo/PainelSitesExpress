import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  DeployLoading,
  DeployStatusError,
  SetupRequiredAlert,
} from "./deploy-placeholders";
import { PublicationForm } from "./publication-form";
import { PublishCard } from "./publish-card";
import type { PublishTarget } from "./publish-target";
import { RepositoryBar } from "./repository-bar";
import { PublicationsCard } from "./publications-card";
import { RunsCard } from "./runs-card";
import { configuredRepositories } from "./settings-store";
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
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
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
  const [configuredRepos, setConfiguredRepos] = useState(configuredRepositories);

  const queryClient = useQueryClient();
  const painel = useDeployStatus();
  const repos = painel.repos;
  const publicacoes = usePublications();
  const repoDomains = useMemo(
    () =>
      new Map(
        publicacoes.items
          .filter((item) => item.domain)
          .map((item) => [item.repoFullName, item.domain as string]),
      ),
    [publicacoes.items],
  );

  const { target: alvo, suggested: sugerido } = useSuggestedRepository({
    target,
    onTargetConsumed,
    repos,
    publishedByDomain: publicacoes.byDomain,
  });
  const selectedRepo = useMemo(
    () =>
      repos.find((repo) => repo.id === selectedRepoId) ??
      (selectedRepoId ? undefined : (sugerido ?? undefined)),
    [repos, selectedRepoId, sugerido],
  );

  const repositorio = useRepositoryData({
    repo: selectedRepo,
    deployWorkflowFile: painel.deployWorkflowFile,
    templateVersion: painel.templateVersion,
  });

  const settings = usePublicationSettings({
    repoFullName: selectedRepo?.fullName ?? "",
    defaultFtpHost: painel.status?.defaultFtpHost ?? "",
    initialDomain: alvo?.domain,
    knownDomain: selectedRepo
      ? publicacoes.byRepo.get(selectedRepo.fullName)?.domain
      : null,
    knownSettings: selectedRepo
      ? publicacoes.byRepo.get(selectedRepo.fullName)?.settings
      : null,
    detectedAutoDeploy: repositorio.detectedAutoDeploy,
  });

  /**
   * Publicar muda o histórico e, com ele, o estado do projeto na outra seção
   * ("No ar"). As duas listas são relidas sem cada handler lembrar disso.
   */
  const refreshPublished = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.publications });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
  };

  const openPublication = (repoFullName: string) => {
    const repo = repos.find((item) => item.fullName === repoFullName);
    if (repo) selectRepository(repo);
    else toast.info("Repositório não encontrado na organização configurada.");
  };

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
      setConfiguredRepos(configuredRepositories());
      toast.success("Publicação configurada", {
        description: 'Agora use "Publicar agora" para disparar o deploy.',
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

  const status = painel.status;

  if (painel.statusError) {
    return (
      <DeployStatusError
        message={(painel.statusError as Error).message}
        onRetry={() => void painel.reloadStatus()}
      />
    );
  }

  if (!status) return <DeployLoading />;

  return (
    <div className="space-y-6">
      <DeployHeader
        isLoadingRepos={painel.isLoadingRepos}
        configurable={status.configurable}
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
            configuredRepos={configuredRepos}
            repoDomains={repoDomains}
            loading={painel.isLoadingRepos}
            error={errors.repo}
            pickerOpen={pickerOpen}
            onPickerOpenChange={setPickerOpen}
            onSelect={selectRepository}
          />

          {selectedRepo ? (
            /* Coluna principal (o que se faz) e trilho lateral (o que o
               repositório mostra). A proporção 3/2 dá largura aos campos em
               duas colunas e evita que a esquerda termine muito antes da
               direita.
               min-w-0: item de grade nasce com min-width auto, e sem isso um
               nome longo estica a coluna e a tela ganha rolagem horizontal na
               janela estreita. */
            <div className="grid items-start gap-6 xl:grid-cols-5">
              <div className="min-w-0 space-y-6 xl:col-span-3">
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
                  />
                </form>

                <PublishCard
                  canDeploy={repositorio.canDeploy}
                  dryRun={dryRun}
                  busy={busy}
                  isDispatching={isDispatching}
                  publicationResult={publicationResult}
                  onDeploy={handleDeploy}
                  onDryRunChange={setDryRun}
                />
              </div>

              <div className="min-w-0 space-y-6 xl:col-span-2">
                <WorkflowCard
                  files={repositorio.workflowFiles}
                  isChecking={repositorio.isCheckingWorkflow}
                  isClearing={isClearing}
                  busy={busy}
                  outdatedWorkflows={repositorio.outdatedWorkflows}
                  deleteResult={deleteResult}
                  onPreview={previewFile}
                  onClear={() => setIsClearOpen(true)}
                />

                <RunsCard
                  runs={repositorio.runs}
                  isLoading={repositorio.isLoadingRuns}
                  isLive={repositorio.hasActiveRun}
                  onRefresh={() => void repositorio.reloadRuns()}
                />

                <PublicationsCard
                  items={publicacoes.items}
                  loading={publicacoes.loading}
                  selectedRepoFullName={selectedRepo.fullName}
                  onOpen={(item) => openPublication(item.repoFullName)}
                />
              </div>
            </div>
          ) : (
            <>
              <ChooseRepositoryCard
                disabled={painel.isLoadingRepos || repos.length === 0}
                onChoose={() => setPickerOpen(true)}
              />
              {/* O que já está no ar é da organização, não do repositório:
                  não precisa esperar uma escolha para aparecer. */}
              <PublicationsCard
                items={publicacoes.items}
                loading={publicacoes.loading}
                onOpen={(item) => openPublication(item.repoFullName)}
              />
            </>
          )}
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
