import type { BriefFile, FileKind } from "./projects";
import type { Generation } from "./generations";
import { get, send } from "./http";

/* ---- Lovable — conexão da conta e geração do site -------------------- */

export type LovableStatus = {
  connected: boolean;
  /** Permissões que o painel pede e a conexão atual não tem — reconectar. */
  missingScopes: string[];
  registered: boolean;
  scope: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  redirectUri: string;
  generation: {
    enabled: boolean;
    maxAttachments: number;
    maxAttachmentBytes: number;
  };
};

/** Um arquivo do projeto já classificado como candidato a anexo. */
export type BuildFile = {
  id: string;
  name: string;
  folder: string | null;
  mimeType: string;
  kind: FileKind;
  size: number | null;
  modifiedTime: string;
  webViewLink: string;
  hasThumbnail: boolean;
  uploadName: string;
  exportedToPdf: boolean;
  isBrief: boolean;
  /** Preenchido quando o arquivo não pode ser anexado — explica o porquê. */
  blockedReason: string | null;
  /** Ressalva: o arquivo sobe, mas o aproveitamento não é garantido. */
  attachWarning: string | null;
  recommended: boolean;
};

export type BuildPackage = {
  prompt: {
    found: boolean;
    text: string;
    file: (BriefFile & { webViewLink: string }) | null;
    /** Outros briefings na pasta; o usado é o mais recente. */
    others: number;
  };
  files: BuildFile[];
  limits: {
    maxPromptChars: number;
    maxAttachments: number;
    maxAttachmentBytes: number;
  };
  generation: { enabled: boolean; reason: string | null };
  /** A assinatura Joinvix anexada a toda geração, e as variantes que faltam. */
  signature: { files: string[]; missing: string[] };
};

export type GenerationPlan = {
  promptChars: number;
  promptSource: string | null;
  attachments: {
    id: string;
    name: string;
    kind: FileKind;
    size: number | null;
    exportedToPdf: boolean;
  }[];
  totalBytes: number;
  unknownSizes: number;
};

export type GenerationResult = {
  /** Formato definido pelo Lovable — lido de forma tolerante na interface. */
  project: Record<string, unknown> | null;
  /** O que ficou gravado no painel, já normalizado. */
  generation: Generation;
  attachments: { name: string; bytes: number }[];
  promptChars: number;
  createdAt: string;
};
export type LovableWorkspace = {
  id: string;
  name: string;
  plan: string | null;
  projectCount: number;
  role: string | null;
};

export const fetchLovableStatus = () =>
  get<LovableStatus>("/api/lovable/status");

export const fetchLovableWorkspaces = () =>
  get<{ workspaces: LovableWorkspace[] }>("/api/lovable/workspaces");

export const connectLovable = () =>
  send<{ authorizeUrl: string }>("POST", "/api/lovable/connect");

/**
 * Conclui a conexão com o endereço da aba de retorno, colado à mão. O Lovable
 * só devolve o navegador a `localhost`: pela rede, essa aba não abre.
 */
export const completeLovableFromUrl = (url: string) =>
  send<void>("POST", "/api/lovable/callback/manual", { url });

export const disconnectLovable = () =>
  send<void>("POST", "/api/lovable/disconnect");

export const fetchBuildPackage = (projectId: string, refresh = false) =>
  get<BuildPackage>(
    `/api/projects/${projectId}/build-package${refresh ? "?refresh=1" : ""}`,
  );

/** Ensaio — não chama o Lovable e não consome crédito. */
export const previewGeneration = (
  projectId: string,
  body: { prompt: string; fileIds: string[] },
) =>
  send<{ dryRun: true; plan: GenerationPlan }>(
    "POST",
    `/api/projects/${projectId}/generate/preview`,
    body,
  );

/** Cria o site de verdade. CONSOME CRÉDITO do Lovable. */
export const generateSite = (
  projectId: string,
  body: {
    prompt: string;
    fileIds: string[];
    workspaceId: string;
    workspaceName: string;
  },
) =>
  send<GenerationResult>("POST", `/api/projects/${projectId}/generate`, {
    ...body,
    confirm: true,
  });
