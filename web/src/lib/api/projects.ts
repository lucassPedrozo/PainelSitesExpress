import type { ClaudeSummary } from "./claude";
import type { Generation } from "./generations";
import { get, request, send } from "./http";

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
  /** Quando o briefing chegou à pasta. */
  createdTime?: string | null;
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
  /**
   * De onde vêm os arquivos: `drive` é uma pasta de coleta (somente leitura);
   * `panel` foi criado aqui, e os arquivos moram no painel. Ausente = `drive`.
   */
  source?: "drive" | "panel";
  /** Só nos do painel: um site a publicar, ou só material guardado. */
  purpose?: "site" | "files" | null;
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
  /** Quando o último arquivo entrou na pasta — material que chegou depois. */
  lastAdded?: string | null;
  tagIds: string[];
  brief: BriefFile | null;
  generations: Generation[];
  /**
   * O briefing, a fila e o site do projeto no motor Claude. `null` (ou
   * ausente) enquanto o projeto não passou por ele.
   */
  claude?: ClaudeSummary | null;
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
  configuredBy?: string | null;
  /**
   * Último envio real que terminou com sucesso (simulação não conta).
   * `null`: configurado, nunca publicado.
   */
  lastDeployAt: string | null;
  /**
   * A primeira vez que o site foi ao ar — o fim do projeto. `lastDeployAt`
   * avança a cada nova publicação; esta data não.
   */
  firstDeployAt?: string | null;
  /** A tentativa mais recente de publicar, com o resultado da execução. */
  lastAttempt: DeployAttempt | null;
  /** Os últimos disparos feitos pelo painel, do mais recente ao mais antigo. */
  deploys?: Array<{ at: string; by: string | null; dryRun: boolean }>;
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
  /**
   * O item mora dentro de um `.zip` do Drive: o conteúdo vem da rota do
   * compactado, e não do arquivo solto. Ausente nos arquivos do Drive.
   * `blocked` diz por que ele não abre (senha, compressão), quando não abre.
   */
  archive?: { fileId: string; index: number; blocked?: string | null };
  /**
   * O caminho dentro de um projeto criado no painel — por ele o item é
   * apagado. Ausente nos arquivos do Drive, que o painel só lê.
   */
  localPath?: string;
};

/** Um arquivo de dentro de um `.zip`, como a API o lista. */
export type ArchiveEntry = {
  /** A posição no zip — é por ela que o conteúdo é pedido. */
  index: number;
  /** Caminho dentro do zip, com `/`. */
  path: string;
  size: number;
  modifiedTime: string | null;
  mimeType: string;
  kind: FileKind;
  previewKind: PreviewKind;
  /** Por que não abre (senha, compressão); `null` quando abre. */
  blocked: string | null;
};

export type ArchiveListing = {
  entries: ArchiveEntry[];
  /** Quantos arquivos o zip tem; maior que a lista quando ela foi cortada. */
  total: number;
  truncated: boolean;
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

/** O que há dentro de um `.zip` do Drive, sem baixá-lo. */
export function fetchArchive(fileId: string, refresh = false) {
  return get<ArchiveListing>(
    `/api/files/${fileId}/archive${refresh ? "?refresh=1" : ""}`,
  );
}

/** O conteúdo do arquivo, esteja ele solto no Drive ou dentro de um zip. */
export const fileContentUrl = (file: DriveFile, download = false) =>
  file.archive
    ? `/api/files/${file.archive.fileId}/archive/${file.archive.index}${download ? "?download=1" : ""}`
    : rawUrl(file.id, download);

/**
 * A miniatura do card. O Drive gera a dos arquivos soltos; dentro do zip não
 * há miniatura, então vai a própria imagem — por isso `hasThumbnail` só é
 * ligado ali para imagens leves.
 */
export const fileThumbnailUrl = (file: DriveFile, size = 400) =>
  file.archive ? fileContentUrl(file) : thumbnailUrl(file.id, size);

/* ------------------------------------------------------------------ *
 * Projetos criados no painel
 * ------------------------------------------------------------------ */

export const isPanelProject = (project: Pick<Project, "source">) => project.source === "panel";

export const createProject = (input: { name: string; kind: "site" | "files" }) =>
  send<{ project: { id: string; name: string } }>("POST", "/api/projects", input);

/** Tira o projeto do painel, com os arquivos dele. O repositório no GitHub fica. */
export const deleteProject = (projectId: string) =>
  send<null>("DELETE", `/api/projects/${projectId}`);

const projectFileUrl = (projectId: string, path: string) =>
  `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`;

/** Sobe um arquivo para o caminho dado; o corpo vai cru, sem passar por JSON. */
export const uploadProjectFile = (projectId: string, path: string, file: Blob) =>
  request<{ path: string; size: number }>(projectFileUrl(projectId, path), {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });

/** Apaga um arquivo ou uma pasta inteira do projeto. */
export const deleteProjectFile = (projectId: string, path: string) =>
  send<null>("DELETE", projectFileUrl(projectId, path));

/** Uma pasta ou um `.zip` do projeto em que o painel achou um site. */
export type SiteSource = {
  /** Caminho dentro do projeto; vazio é a raiz. */
  path: string;
  type: "folder" | "zip";
  /** `build`: tem `package.json`. `static`: HTML pronto, sem build. */
  kind: "build" | "static";
  fileCount: number;
  totalBytes: number;
  /** O que fica de fora do repositório, e por quê. */
  skipped: Array<{ reason: string; count: number }>;
  warnings: string[];
};

export type SiteSources = {
  sources: SiteSource[];
  /** Há um site do motor Claude (Joinvixable) entre os arquivos: quem o envia é o motor. */
  engineSite?: boolean;
  /** O repositório que o projeto já tem; `null` se ainda vai ser criado. */
  repoFullName: string | null;
  suggestedRepoName: string;
  organization: string | null;
};

export const fetchSiteSources = (projectId: string) =>
  get<SiteSources>(`/api/projects/${projectId}/site-sources`);

export type PushSiteResult = {
  generation: Generation | null;
  repository: { fullName: string; url: string; created: boolean };
  commit: { sha: string; changed: boolean; files: number; uploaded: number };
  kind: "build" | "static";
  skipped: Array<{ reason: string; count: number }>;
  /** Por que a prévia não foi publicada, quando pedida; o envio vale mesmo assim. */
  warning: string | null;
};

/** Cria o repositório na organização (ou atualiza o do projeto) com o site. */
export const pushSiteToGitHub = (
  projectId: string,
  input: { sourcePath: string; repoName?: string; private?: boolean; publishPreview: boolean },
) => send<PushSiteResult>("POST", `/api/projects/${projectId}/repository`, input);

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
