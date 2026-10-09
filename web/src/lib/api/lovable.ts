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
  /** O zip que leva as fotos de banco, quando há alguma. */
  stockZip: string | null;
  /** Fotos de banco conferidas no Pixabay, com o caminho dentro do zip. */
  stockImages: {
    id: number;
    path: string;
    term: string;
    section: string | null;
    user: string;
    pageUrl: string | null;
  }[];
};

/* ---- Imagens de banco (Pixabay) -------------------------------------- */

export type StockImagesStatus = {
  configured: boolean;
  limits: {
    maxTerms: number;
    maxQuantity: number;
    defaultQuantity: number;
    maxTermChars: number;
    maxSectionChars: number;
    maxImages: number;
  };
};

/**
 * Uma foto candidata. A miniatura vem por `stockThumbnailUrl`; a versão em
 * alta só o servidor baixa, na geração.
 */
export type StockCandidate = {
  id: number;
  width: number | null;
  height: number | null;
  tags: string;
  user: string;
  pageUrl: string | null;
};

export type StockTerm = { term: string; quantity: number; section: string | null };

export type StockSearchResult = StockTerm & { images: StockCandidate[] };

/** O que a geração recebe de cada foto escolhida: id e grupo. */
export type StockSelection = { id: number; term: string; section: string | null };

/** Miniatura pelo painel, como as do Drive — o Pixabay fica fora da CSP. */
export const stockThumbnailUrl = (imageId: number) => `/api/images/${imageId}/thumbnail`;

export const fetchStockImagesStatus = () =>
  get<StockImagesStatus>("/api/images/status");

/** Busca no Pixabay pelo servidor — a chave não sai de lá. Não gasta crédito. */
export const searchStockImages = (terms: StockTerm[]) =>
  send<{ results: StockSearchResult[] }>("POST", "/api/images/search", { terms });

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
  body: { prompt: string; fileIds: string[]; stockImages?: StockSelection[] },
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
    stockImages?: StockSelection[];
    workspaceId: string;
    workspaceName: string;
  },
) =>
  send<GenerationResult>("POST", `/api/projects/${projectId}/generate`, {
    ...body,
    confirm: true,
  });
