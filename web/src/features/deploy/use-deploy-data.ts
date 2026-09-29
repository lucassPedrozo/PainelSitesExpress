import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/access-token";
import {
  deployApi,
  isRunActive,
  type Publication,
  type RepoOption,
} from "@/lib/api/deploy";
import { normalizeDomain } from "@shared/domain.js";
import { queryKeys } from "@/lib/query";

/** Enquanto houver execução em andamento, o painel se atualiza sozinho. */
const RUN_POLL_INTERVAL_MS = 6_000;

export const DEFAULT_DEPLOY_WORKFLOW = "Deploy-via-FTP.yml";

/**
 * Avisa quando uma leitura falha.
 *
 * O 401 fica de fora: o cliente HTTP já leva o painel de volta à tela da chave
 * de acesso, e um toast aqui só faria ruído por cima disso.
 */
export function useErrorToast(error: unknown, title: string) {
  useEffect(() => {
    if (!error) return;
    if (error instanceof ApiError && error.status === 401) return;
    toast.error(title, {
      description: error instanceof Error ? error.message : undefined,
    });
  }, [error, title]);
}

/**
 * O que a tela precisa antes de escolher um repositório: a configuração do
 * painel e a lista de repositórios da organização.
 *
 * Cada leitura é uma consulta com a sua chave, então trocar de tela e voltar
 * não refaz as chamadas ao GitHub, e "salvar configuração" invalida o que
 * ficou velho sem cada handler lembrar de recarregar as listas.
 */
export function useDeployStatus() {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: queryKeys.deployStatus,
    queryFn: () => deployApi.getStatus(),
    staleTime: 60_000,
  });

  const setupRequired = status.data?.setupRequired ?? true;

  const repos = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: () => deployApi.listRepos(),
    // Sem token ou organização não há o que listar; a tela mostra o convite
    // para configurar em vez de disparar uma chamada que vai falhar.
    enabled: Boolean(status.data) && !setupRequired,
    staleTime: 60_000,
  });

  useErrorToast(repos.error, "Não foi possível carregar os repositórios");

  return {
    status: status.data ?? null,
    statusError: status.error,
    repos: repos.data ?? [],
    isLoadingRepos: repos.isFetching,
    deployWorkflowFile:
      status.data?.deployWorkflowFile ?? DEFAULT_DEPLOY_WORKFLOW,
    templateVersion: status.data?.workflowTemplateVersion,
    reloadStatus: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.deployStatus }),
    reloadRepos: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.repositories }),
  };
}

/**
 * O que o painel já publicou: domínio, repositório e último envio.
 *
 * Uma consulta só para a tela inteira — o seletor mostra o domínio ao lado do
 * repositório, o formulário preenche o domínio que já é conhecido e o cartão
 * de publicações lista tudo. `byRepo` e `byDomain` evitam que cada um refaça
 * a busca na lista.
 */
export function usePublications() {
  const publications = useQuery({
    queryKey: queryKeys.publications,
    queryFn: () => deployApi.listPublications(),
    staleTime: 60_000,
  });

  const items = publications.data?.publications ?? [];
  const byRepo = new Map<string, Publication>(
    items.map((item) => [item.repoFullName, item]),
  );
  const byDomain = new Map<string, Publication>();
  for (const item of items) {
    const domain = normalizeDomain(item.domain);
    if (domain && !byDomain.has(domain)) byDomain.set(domain, item);
  }

  return {
    items,
    loading: publications.isPending,
    byRepo,
    byDomain,
  };
}

/**
 * O que é próprio do repositório escolhido: os workflows que estão lá e as
 * execuções recentes.
 *
 * O polling das execuções é decidido pelo próprio resultado — só enquanto
 * alguma estiver em andamento. Antes era um `setInterval` montado e desmontado
 * por um efeito à parte, que precisava ser mantido em sincronia com a lista.
 */
export function useRepositoryData({
  repo,
  deployWorkflowFile,
  templateVersion,
}: {
  repo: RepoOption | undefined;
  deployWorkflowFile: string;
  templateVersion?: string;
}) {
  const queryClient = useQueryClient();
  const owner = repo?.owner ?? "";
  const name = repo?.name ?? "";
  const branch = repo?.defaultBranch ?? "";
  const fullName = repo?.fullName ?? "";

  const workflows = useQuery({
    queryKey: queryKeys.workflows(fullName, branch),
    queryFn: () => deployApi.listWorkflowFiles(owner, name, branch),
    enabled: Boolean(repo),
  });

  const runs = useQuery({
    queryKey: queryKeys.runs(fullName, branch, deployWorkflowFile),
    queryFn: () => deployApi.listRuns(owner, name, branch, deployWorkflowFile),
    enabled: Boolean(repo),
    refetchInterval: (query) =>
      (query.state.data ?? []).some(isRunActive) ? RUN_POLL_INTERVAL_MS : false,
  });

  useErrorToast(workflows.error, "Falha ao verificar workflows");
  // O histórico de execuções é informativo: falhar nele não interrompe o
  // fluxo, e o recarregamento automático não pode virar fila de avisos.

  const files = workflows.data ?? [];

  return {
    workflowFiles: files,
    isCheckingWorkflow: workflows.isFetching,
    runs: runs.data ?? [],
    isLoadingRuns: runs.isFetching,
    hasActiveRun: (runs.data ?? []).some(isRunActive),
    /** O gatilho de push lido do workflow de deploy, quando ele existe. */
    detectedAutoDeploy: files.find(
      (file) => file.name.toLowerCase() === deployWorkflowFile.toLowerCase(),
    )?.autoDeploy,
    /** O deploy só pode ser disparado quando o workflow existe lá. */
    canDeploy: files.some(
      (file) => file.name.toLowerCase() === deployWorkflowFile.toLowerCase(),
    ),
    /**
     * Só os workflows gerados pelo painel trazem `templateVersion`; um valor
     * diferente do atual significa que o repositório roda uma versão antiga.
     */
    outdatedWorkflows: files
      .filter(
        (file) =>
          file.templateVersion !== undefined &&
          file.templateVersion !== templateVersion,
      )
      .map((file) => file.name),
    reloadWorkflows: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows(fullName, branch),
      }),
    reloadRuns: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.runs(fullName, branch, deployWorkflowFile),
      }),
  };
}
