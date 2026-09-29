import { get, send } from "./http";
import type { RunProgress } from "./projects";

/* ---- Sites gerados e o link do cliente ------------------------------- */

/** Um site já criado no Lovable a partir desta coleta. */
export type Generation = {
  id: string | null;
  url: string | null;
  previewUrl: string | null;
  displayName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  attachments: number;
  promptChars: number;
  createdAt: string;
  /**
   * Link do botão "Share preview" do Lovable — o único que abre sem login.
   * `previewUrl` acima é o preview interno e devolve 401 para o cliente.
   */
  sharePreviewUrl: string | null;
  /** Quando o link foi mandado ao cliente, e por quem. */
  deliveredAt: string | null;
  deliveredBy: string | null;
  previewState: PreviewState;
  previewDetail: string | null;
  previewCheckedAt: string | null;
  /** Link curto do BetterLinks: estável, reapontado quando o share troca. */
  shortLinkId: string | null;
  shortSlug: string | null;
  shortUrl: string | null;
  /**
   * O agente do Lovable depois do "Gerar", conferido pelo painel:
   * trabalhando, parado esperando alguém no editor, pronto, ou `unknown` para
   * gerações de antes do acompanhamento.
   */
  agentState: "running" | "awaiting" | "done" | "unknown";
  agentCheckedAt: string | null;
  screenshotUrl: string | null;
  styleRegistered: boolean;
  /** A assinatura Joinvix está no código? `null` enquanto não conferido. */
  signatureFound: boolean | null;
  /** O painel já pediu ao agente para pôr a assinatura. */
  signatureFixSent: boolean;
  /** O que o agente perguntou quando parou — `null` fora de "awaiting". */
  agentQuestion: string | null;
  /** Nome do projeto no Lovable — o repositório do GitHub nasce com ele. */
  lovableName: string | null;
  /** O que o agente está fazendo no trabalho em curso; `null` quando pronto. */
  agentActivity?: AgentActivity | null;
  /**
   * De onde o site veio: `panel` (o "Gerar") ou `linked` (feito fora do painel
   * e vinculado depois). Ausente nos dados de antes do vínculo = `panel`.
   */
  origin?: "panel" | "linked";
  linkedAt?: string | null;
  linkedBy?: string | null;
  /** Repositório confirmado para este site, na primeira publicação. */
  repoFullName: string | null;
  /** A publicação na área de desenvolvimento; `null` fora dela. */
  devArea: DevArea | null;
  /**
   * O endereço que vai ao cliente: a pasta na área de desenvolvimento depois
   * de conferida, ou o link curto dos sites de antes dela.
   */
  clientUrl: string | null;
};

/**
 * O site numa pasta da área de desenvolvimento (`https://sitexpress.../zezinho/`),
 * publicada a cada push no repositório. É o link de aprovação do cliente.
 */
export type DevArea = {
  /**
   * `waiting-repo`: falta conectar o projeto ao GitHub no Lovable.
   * `retired`: um site gerado depois passou a publicar na mesma pasta.
   */
  state: "waiting-repo" | "publishing" | "live" | "failed" | "retired";
  slug: string | null;
  url: string | null;
  repoFullName: string | null;
  branch: string | null;
  configuredAt: string | null;
  lastRun: {
    at: string;
    status: "pending" | "success" | "failure" | "unknown";
    runUrl: string | null;
    sha: string | null;
    progress?: RunProgress | null;
  } | null;
  /** O commit conferido na pasta — é ele que diz que o link vale. */
  publishedSha: string | null;
  publishedAt: string | null;
  detail: string | null;
};

/**
 * O trabalho em curso do agente, lido das mensagens do Lovable: a fase, a
 * última ação e quantos arquivos ele já escreveu.
 */
export type AgentActivity = {
  /** Quando começou o pedido que o agente está atendendo. */
  startedAt: string | null;
  steps: number;
  filesWritten: number;
  current: string | null;
  phase: "planning" | "writing" | "checking" | "answering";
};

/** `alive` é a única condição que libera o envio ao cliente. */
export type PreviewState = "alive" | "dead" | "unknown";

export type ShortLinkResult = {
  id: string | null;
  slug: string | null;
  url: string | null;
  targetUrl: string | null;
  action: "created" | "repointed" | "unchanged";
};

/**
 * Registra o link de share e garante o link curto que o mascara. A API recusa
 * (422) um link que não abre para o cliente.
 */
export const attachSharePreview = (
  projectId: string,
  lovableId: string,
  sharePreviewUrl: string,
) =>
  send<{ generation: Generation; shortLink: ShortLinkResult }>(
    "PUT",
    `/api/projects/${projectId}/generations/${lovableId}/share-link`,
    { sharePreviewUrl },
  );

/** Reconfere um link — é a sonda que decide se ele pode ir ao cliente. */
export const checkSharePreview = (projectId: string, lovableId: string) =>
  send<{ generation: Generation }>(
    "POST",
    `/api/projects/${projectId}/generations/${lovableId}/share-link/check`,
  );

export const checkAllSharePreviews = () =>
  send<{
    checked: number;
    summary: Record<PreviewState, number>;
  }>("POST", "/api/share-links/check");

export const fetchShortlinkStatus = () =>
  get<{ configured: boolean }>("/api/shortlinks/status");

/** Registra (ou desfaz) a entrega ao cliente. A API exige link `alive`. */
export const setGenerationDelivered = (
  projectId: string,
  lovableId: string,
  delivered: boolean,
) =>
  send<{ generation: Generation }>(
    "POST",
    `/api/projects/${projectId}/generations/${lovableId}/delivered`,
    { delivered },
  );

/** Responde ao agente parado. CONSOME CRÉDITO do Lovable. */
export const replyToAgent = (
  projectId: string,
  lovableId: string,
  message: string,
) =>
  send<{ generation: Generation }>(
    "POST",
    `/api/projects/${projectId}/generations/${lovableId}/reply`,
    { message, confirm: true },
  );

/** Liga o site ao repositório em que ele é publicado. */
export const setGenerationRepository = (
  projectId: string,
  lovableId: string,
  repoFullName: string,
) =>
  send<{ generation: Generation }>(
    "PUT",
    `/api/projects/${projectId}/generations/${lovableId}/repository`,
    { repoFullName },
  );

export const fetchDevAreaStatus = () =>
  get<{ configured: boolean; url: string | null }>("/api/dev-area/status");

/** Publica o site na área de desenvolvimento agora, sem esperar a varredura. */
export const publishToDevArea = (projectId: string, lovableId: string) =>
  send<{ generation: Generation }>(
    "POST",
    `/api/projects/${projectId}/generations/${lovableId}/dev-area`,
  );

/** Em que etapa o site vinculado já está. */
export type LinkState = "ready" | "delivered" | "live";

/**
 * Vincula um site feito fora do painel — projeto do Lovable, repositório da
 * organização, ou os dois. `warning` diz por que a área de aprovação não
 * publicou, quando pedida; o vínculo fica gravado mesmo assim.
 */
export const linkExistingSite = (
  projectId: string,
  input: {
    lovable?: string;
    repoFullName?: string;
    state: LinkState;
    domain?: string;
    publishApproval: boolean;
  },
) =>
  send<{ generation: Generation; warning: string | null }>(
    "POST",
    `/api/projects/${projectId}/generations/link`,
    input,
  );

/**
 * Troca o projeto do Lovable de um site já registrado (o site foi refeito num
 * projeto novo). O link do cliente e a pasta de aprovação continuam.
 */
export const changeLovableProject = (
  projectId: string,
  lovableId: string,
  input: { lovable: string; publishApproval: boolean },
) =>
  send<{ generation: Generation; previousId: string; warning: string | null }>(
    "PUT",
    `/api/projects/${projectId}/generations/${lovableId}/lovable-project`,
    input,
  );

export const forgetGeneration = (projectId: string, lovableId: string) =>
  send<void>(
    "DELETE",
    `/api/projects/${projectId}/generations/${lovableId}`,
  );
