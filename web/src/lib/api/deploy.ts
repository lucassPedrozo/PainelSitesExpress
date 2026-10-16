import { request as requestApi } from "./http";

export type RepoOption = {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  createdAt: string;
  updatedAt: string;
  private: boolean;
  defaultBranch: string;
};

export type WorkflowFile = {
  name: string;
  path: string;
  sha: string;
  size: number;
  /** Versão do template do painel gravada no arquivo, quando ele é gerenciado. */
  templateVersion?: string | null;
  /** No workflow de deploy: se ele publica a cada push. */
  autoDeploy?: boolean;
};

/**
 * `auto` exige FTPS explícito e para a publicação se o servidor não aceitar —
 * nunca cai sozinho para FTP simples, que mandaria a senha sem criptografia.
 */
export type FtpProtocol = "auto" | "ftps" | "ftps-legacy" | "ftp";

export const ftpProtocols: FtpProtocol[] = [
  "auto",
  "ftps",
  "ftps-legacy",
  "ftp",
];

export const ftpProtocolLabels: Record<FtpProtocol, string> = {
  auto: "Automático (recomendado)",
  ftps: "FTPS explícito",
  "ftps-legacy": "FTPS implícito",
  ftp: "FTP simples",
};

export type PublicationSettings = {
  domain: string;
  ftpServer: string;
  ftpLogin: string;
  ftpPassword: string;
  serverDir: string;
  protocol: FtpProtocol;
  port: string;
  autoDeploy: boolean;
  /**
   * Conteúdo novo do secret `BUILD_ENV_FILE`. Vazio mantém o que já está no
   * repositório: o painel não guarda estas variáveis para preencher de volta.
   */
  buildEnv: string;
  /** Pedido explícito para remover o `BUILD_ENV_FILE` do repositório. */
  clearBuildEnv: boolean;
};

export type ConfigurePublicationInput = PublicationSettings & {
  owner: string;
  repo: string;
  branch: string;
};

export type WorkflowWriteStatus = {
  path: string;
  /** `unchanged`: o arquivo já tinha este conteúdo e não houve commit. */
  action: "created" | "updated" | "unchanged";
};

export type PublicationResult = {
  workflowPaths: string[];
  workflowBranch: string;
  secretNames: string[];
  workflowStatuses: WorkflowWriteStatus[];
};

export type DeleteWorkflowInput = {
  owner: string;
  repo: string;
  files: WorkflowFile[];
  branch: string;
};

export type DeleteWorkflowResult = {
  removed: string[];
  failed: Array<{ path: string; message: string }>;
  status: "success" | "partial" | "failed";
};

export type WorkflowRun = {
  id: number;
  name: string;
  title: string;
  status: string;
  conclusion: string | null;
  runNumber: number;
  url: string;
  event: string;
  createdAt: string;
  updatedAt: string;
};

export type DispatchResult = {
  dispatched: true;
  workflow: string;
  branch: string;
  dryRun: boolean;
};

/** Histórico do que foi configurado e publicado, por repositório. */
export type Publication = {
  repoFullName: string;
  domain: string | null;
  branch: string | null;
  configuredAt: string | null;
  configuredBy: string | null;
  lastDeployAt?: string | null;
  deploys: Array<{ at: string; by: string | null; dryRun: boolean }>;
  /** O que não é segredo, gravado na última configuração salva pelo painel. */
  settings?: {
    ftpServer: string;
    ftpLogin: string;
    serverDir: string;
    protocol: FtpProtocol;
    port: string;
    autoDeploy: boolean;
  } | null;
  /**
   * A execução mais recente do workflow de deploy — disparo do painel ou push
   * vindo do Lovable. Ausente até a primeira conferência.
   */
  lastRun?: {
    at: string;
    status: "pending" | "success" | "failure" | "unknown";
    runUrl: string | null;
    event: string | null;
  };
};

export type DeployStatus = {
  service: "online";
  githubConfigured: boolean;
  organization: string;
  authenticationRequired: boolean;
  defaultFtpHost: string;
  deployWorkflowFile: string;
  workflowTemplateVersion: string;
  /** Falta token ou organização: o painel abre direto na tela de configuração. */
  setupRequired: boolean;
  /** A chave desta sessão tem a permissão `configurar`. */
  configurable: boolean;
};

export type AccessCheck = {
  id: "identity" | "organization" | "secrets" | "actions";
  label: string;
  ok: boolean;
  detail: string;
};

export type AccessCheckResult = {
  identity: { login: string; tokenExpiresAt: string | null } | null;
  checks: AccessCheck[];
};

/**
 * As chamadas da publicação falam com o GitHub pela API local; um minuto
 * cobre as mais lentas (gravar secrets e workflows) com folga.
 */
const REQUEST_TIMEOUT_MS = 60_000;

const request = <T,>(path: string, init: RequestInit = {}) =>
  requestApi<T>(path, { ...init, timeoutMs: REQUEST_TIMEOUT_MS });

const repositoryPath = (owner: string, repo: string) =>
  `/api/deploy/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

export const deployApi = {
  getStatus: () => request<DeployStatus>("/api/deploy/status"),
  listRepos: () => request<RepoOption[]>("/api/deploy/repositories"),
  listPublications: () =>
    request<{ publications: Publication[] }>("/api/deploy/publications"),
  listWorkflowFiles: (owner: string, repo: string, branch: string) =>
    request<WorkflowFile[]>(
      `${repositoryPath(owner, repo)}/workflows?branch=${encodeURIComponent(branch)}`,
    ),
  listRuns: (owner: string, repo: string, branch: string, workflow?: string) => {
    const search = new URLSearchParams({ branch });
    if (workflow) search.set("workflow", workflow);
    return request<WorkflowRun[]>(
      `${repositoryPath(owner, repo)}/runs?${search.toString()}`,
    );
  },
  configurePublication: (input: ConfigurePublicationInput) =>
    request<PublicationResult>(
      `${repositoryPath(input.owner, input.repo)}/publication`,
      {
        method: "POST",
        body: JSON.stringify({
          branch: input.branch,
          domain: input.domain,
          ftpServer: input.ftpServer,
          ftpLogin: input.ftpLogin,
          ftpPassword: input.ftpPassword,
          serverDir: input.serverDir,
          protocol: input.protocol,
          port: input.port,
          buildEnv: input.buildEnv,
          clearBuildEnv: input.clearBuildEnv,
          autoDeploy: input.autoDeploy,
        }),
      },
    ),
  dispatchDeploy: (
    owner: string,
    repo: string,
    branch: string,
    dryRun: boolean,
    workflow?: string,
  ) =>
    request<DispatchResult>(`${repositoryPath(owner, repo)}/deploy`, {
      method: "POST",
      body: JSON.stringify({ branch, dryRun, workflow }),
    }),
  deleteWorkflowFiles: (input: DeleteWorkflowInput) =>
    request<DeleteWorkflowResult>(
      `${repositoryPath(input.owner, input.repo)}/workflows`,
      {
        method: "DELETE",
        body: JSON.stringify({ files: input.files, branch: input.branch }),
      },
    ),
  getWorkflowPreview: async (
    owner: string,
    repo: string,
    branch: string,
    path: string,
  ) => {
    const result = await request<{ content: string }>(
      `${repositoryPath(owner, repo)}/workflows/preview?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
    );
    return result.content;
  },
};

const activeStatuses = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

export const isRunActive = (run: WorkflowRun) => activeStatuses.has(run.status);
