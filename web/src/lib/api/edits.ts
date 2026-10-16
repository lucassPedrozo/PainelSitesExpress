import type { ClaudeAdjustAttachments, ClaudeAttachment, ClaudeLogLine, ClaudeQueueItem } from "./claude";
import { get, request, send } from "./http";

/**
 * Ajustes pelo Claude em sites de repositório — os feitos no Lovable, ou
 * vinculados de fora. O painel mantém um clone do repositório, sempre na
 * última versão do GitHub; o Claude ajusta dentro dele; e o painel, depois de
 * conferir o build, faz um commit normal e envia. O Lovable recebe a mudança
 * pela sincronização com o GitHub.
 */

/** Quem fez uma alteração no repositório. `panel`: o painel configurando a publicação (só `.github/`). */
export type RepoEditOrigin = "lovable" | "claude" | "person" | "panel";

/** Um commit do repositório, como a tela o vê. */
export type RepoCommit = {
  sha: string;
  origin: RepoEditOrigin;
  /** "Lovable", "Claude" ou o nome de quem fez. */
  author: string;
  message: string;
  at: string;
  url: string;
  /** Quantos arquivos o commit mudou. */
  files: number;
  /** O ajuste do painel que gerou o commit, quando é do Claude. */
  editId: string | null;
};

/** A última versão do repositório no GitHub. */
export type RepoVersion = {
  repo: string;
  branch: string;
  /** O commit mais recente do branch. */
  head: RepoCommit | null;
  /** A última alteração do site: o commit mais recente que não é só configuração do painel. */
  last: RepoCommit | null;
  commits: RepoCommit[];
  /** Um ajuste está rodando: a versão é a da última leitura, de antes dele. */
  busy: boolean;
  checkedAt: string | null;
};

export type RepoEditStatus = "queued" | "running" | "pushed" | "unchanged" | "failed" | "conflict" | "cancelled" | "interrupted";

/** Um ajuste pedido ao Claude — a memória da aba. */
export type RepoEdit = {
  id: string;
  repo: string;
  branch: string | null;
  request: string;
  /** Os nomes das imagens que foram com o pedido. */
  attachments: string[];
  by: string | null;
  createdAt: string;
  status: RepoEditStatus;
  itemId: string | null;
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  model: string | null;
  effort: string | null;
  /** A versão de onde o ajuste partiu, com quem tinha feito a última alteração antes dele. */
  base: RepoCommit | null;
  /** O commit que o ajuste gerou no GitHub. */
  commit: (Omit<RepoCommit, "files"> & { files: string[] }) | null;
  /** O que o Claude disse ter feito. */
  summary: string | null;
  error: string | null;
};

/** A aba "Ajustes" de um projeto. */
export type RepoEditsState = {
  /** O projeto pode receber ajustes: o site mora num repositório e o token do GitHub está configurado. */
  available: boolean;
  reason: string | null;
  repo: string | null;
  /** A trava do gasto ("Liberar o uso do Claude"). */
  generation: { enabled: boolean; reason: string | null };
  /** O pedido do projeto na fila do Claude (deste ou de outro tipo). */
  queue: ClaudeQueueItem | null;
  /** A última versão já lida (sem ir ao GitHub); `null` antes da primeira leitura. */
  version: RepoVersion | null;
  /** Do mais recente para o mais antigo. */
  edits: RepoEdit[];
};

const base = (projectId: string) => `/api/projects/${projectId}/edits`;

export const fetchRepoEdits = (projectId: string) => get<RepoEditsState>(base(projectId));

/** Busca a última versão no GitHub (atualiza o clone do painel). Não usa o Claude. */
export const fetchRepoVersion = (projectId: string) => get<RepoVersion>(`${base(projectId)}/version`);

/** Pede um ajuste pelo Claude. CONSOME A ASSINATURA, e o resultado vai ao GitHub. */
export const requestRepoEdit = (projectId: string, pedido: string, anexos?: ClaudeAdjustAttachments) =>
  send<{ item: ClaudeQueueItem; edit: RepoEdit }>("POST", base(projectId), {
    pedido,
    confirm: true,
    ...(anexos ? { anexos } : {}),
  });

const attachmentsUrl = (projectId: string, query: Record<string, string>) =>
  `${base(projectId)}/attachments?${new URLSearchParams(query)}`;

/** Sobe uma imagem do pedido de ajuste; o corpo vai cru. Não usa o Claude. */
export const uploadRepoEditAttachment = (projectId: string, file: File, draft?: string | null) =>
  request<ClaudeAttachment>(attachmentsUrl(projectId, { name: file.name, ...(draft ? { draft } : {}) }), {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });

export const removeRepoEditAttachment = (projectId: string, draft: string, file: string) =>
  send<null>("DELETE", attachmentsUrl(projectId, { draft, file }));

export const fetchRepoEditLog = (projectId: string, editId: string) =>
  get<{ lines: ClaudeLogLine[] }>(`${base(projectId)}/${encodeURIComponent(editId)}/log`);
