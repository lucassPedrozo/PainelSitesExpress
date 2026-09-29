import type { Generation } from "./generations";
import { get, send } from "./http";

export type FileKind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "sheet"
  | "slides"
  | "doc"
  | "archive"
  | "other";

/** O arquivo "Informações do Site" — o briefing que vira prompt do Lovable. */
export type BriefFile = {
  id: string;
  name: string;
  mimeType: string;
};

export type ProjectBrief = {
  found: true;
  file: BriefFile & { webViewLink: string };
  /** Outros briefings na pasta; o usado é o mais recente. */
  others: number;
  text: string;
};

export type Project = {
  id: string;
  /** Nome da pasta no Drive. Nunca muda pelo painel: o acesso é só de leitura. */
  name: string;
  /** Apelido dado aqui no painel, quando a pasta nasceu sem nome útil. */
  alias: string | null;
  description: string | null;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  owner: string | null;
  fileCount: number;
  folderCount: number;
  totalSize: number;
  kinds: Partial<Record<FileKind, number>>;
  lastActivity: string;
  tagIds: string[];
  brief: BriefFile | null;
  generations: Generation[];
  /**
   * A publicação do mesmo domínio, quando o painel configurou uma. É ela que
   * diz se o site está no ar — e, no ar, o link de preview deixa de importar.
   */
  publication: ProjectPublication | null;
  /** Domínio limpo (sem www., https://), do apelido ou da pasta. */
  domain: string | null;
  /** Quantas coletas existem deste domínio, contando esta. */
  domainCollections: number;
};

export type ProjectPublication = {
  domain: string;
  repoFullName: string;
  configuredAt: string | null;
  /**
   * Último envio real que terminou com sucesso (simulação não conta).
   * `null`: configurado, nunca publicado.
   */
  lastDeployAt: string | null;
  /** A tentativa mais recente de publicar, com o resultado da execução. */
  lastAttempt: DeployAttempt | null;
};

export type DeployAttempt = {
  at: string;
  status: "pending" | "success" | "failure" | "unknown";
  /** A execução no GitHub Actions, quando já encontrada. */
  runUrl: string | null;
  /** Em que passo o deploy está, enquanto publica. */
  progress?: RunProgress | null;
};

/** Os passos do job no GitHub Actions: quantos terminaram e o atual. */
export type RunProgress = {
  total: number;
  done: number;
  /** Nome do passo em andamento, em inglês, como está no workflow. */
  current: string | null;
};

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  kind: FileKind;
  previewKind: PreviewKind;
  size: number | null;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  webContentLink: string | null;
  hasThumbnail: boolean;
  width: number | null;
  height: number | null;
};

export function fetchProjects(refresh = false) {
  return get<{ projects: Project[]; fetchedAt: string }>(
    `/api/projects${refresh ? "?refresh=1" : ""}`,
  );
}

export function fetchFolderFiles(folderId: string, refresh = false) {
  return get<{ files: DriveFile[] }>(
    `/api/folders/${folderId}/files${refresh ? "?refresh=1" : ""}`,
  );
}

export const thumbnailUrl = (fileId: string, size = 400) =>
  `/api/files/${fileId}/thumbnail?size=${size}`;

export const rawUrl = (fileId: string, download = false) =>
  `/api/files/${fileId}/raw${download ? "?download=1" : ""}`;

export const fetchProjectBrief = (projectId: string) =>
  get<ProjectBrief>(`/api/projects/${projectId}/brief`);

export const setProjectTags = (projectId: string, tagIds: string[]) =>
  send<{ tagIds: string[] }>("PUT", `/api/projects/${projectId}/tags`, {
    tagIds,
  });

/** Texto vazio apaga o apelido e devolve o nome da pasta do Drive. */
export const setProjectName = (projectId: string, name: string) =>
  send<{ alias: string | null }>("PUT", `/api/projects/${projectId}/name`, {
    name,
  });
