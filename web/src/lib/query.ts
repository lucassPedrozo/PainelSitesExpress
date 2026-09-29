import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/access-token";

/**
 * Cache das leituras da API.
 *
 * Cada tela buscava os próprios dados dentro de um `useEffect`, com o seu par
 * de estados de carregando/erro. Isso custava três coisas: a mesma resposta
 * era buscada de novo a cada abertura de diálogo, duas telas pediam a mesma
 * coisa ao mesmo tempo, e o "recarregar depois de salvar" dependia de cada
 * componente lembrar de avisar os outros. Agora as leituras têm chave, cache e
 * invalidação; as escritas continuam sendo chamadas diretas de `api.ts`.
 */

/** Chaves do cache, num lugar só — é por elas que a invalidação acontece. */
export const queryKeys = {
  /** Porteiro: se o painel pede chave e se este navegador já tem sessão. */
  gate: ["gate"],
  me: ["me"],
  projects: ["projects"],
  tags: ["tags"],
  accessKeys: ["access-keys"],
  folderFiles: (folderId: string) => ["folder-files", folderId],
  brief: (projectId: string) => ["brief", projectId],
  buildPackage: (projectId: string) => ["build-package", projectId],
  lovableStatus: ["lovable", "status"],
  lovableWorkspaces: ["lovable", "workspaces"],
  shortlinkStatus: ["shortlinks", "status"],
  deployStatus: ["deploy", "status"],
  deploySettings: ["deploy", "settings"],
  settings: ["settings"],
  repositories: ["deploy", "repositories"],
  workflows: (repoFullName: string, branch: string) => [
    "deploy",
    "workflows",
    repoFullName,
    branch,
  ],
  runs: (repoFullName: string, branch: string, workflow: string) => [
    "deploy",
    "runs",
    repoFullName,
    branch,
    workflow,
  ],
  publications: ["deploy", "publications"],
} as const;

/**
 * Repetir só faz sentido em falha de rede. Um 4xx é resposta do servidor —
 * chave inválida, permissão que falta, id que não existe — e insistir nele
 * atrasaria a mensagem de erro sem mudar o resultado.
 */
const retry = (failureCount: number, error: unknown) => {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry,
        // O painel roda na máquina de quem usa, ao lado da API: revalidar a
        // cada foco de janela seria varrer o Drive à toa.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
