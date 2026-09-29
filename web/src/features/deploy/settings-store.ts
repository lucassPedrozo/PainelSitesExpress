import {
  ftpProtocols,
  type FtpProtocol,
  type PublicationSettings,
} from "@/lib/api/deploy";

const STORAGE_KEY = "sites-express-deploy-settings-v1";

/**
 * Nem a senha nem as variáveis de build entram aqui: as duas vão para o GitHub
 * como secret e existem apenas na memória do formulário. As variáveis de build
 * costumam carregar chaves de API; guardá-las em `localStorage` deixava em
 * texto puro, no navegador, o que no repositório fica cifrado.
 */
export type StoredSettings = Omit<
  PublicationSettings,
  "ftpPassword" | "buildEnv" | "clearBuildEnv"
>;

type SettingsFile = {
  lastFtpServer?: string;
  repositories?: Record<string, Partial<StoredSettings>>;
};

export const emptySettings: StoredSettings = {
  domain: "",
  ftpServer: "",
  ftpLogin: "",
  serverDir: "",
  protocol: "auto",
  port: "",
  autoDeploy: false,
};

const readFile = (): SettingsFile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SettingsFile;
    if (!parsed || typeof parsed !== "object") return {};
    return scrubLegacySecrets(parsed);
  } catch {
    return {};
  }
};

/**
 * Versões anteriores gravavam `buildEnv` junto do resto. Na primeira leitura o
 * campo é apagado do armazenamento, não só ignorado.
 */
const scrubLegacySecrets = (file: SettingsFile): SettingsFile => {
  const repositories = file.repositories ?? {};
  const hasLegacy = Object.values(repositories).some(
    (repo) => repo && typeof repo === "object" && "buildEnv" in repo,
  );
  if (!hasLegacy) return file;

  const scrubbed: SettingsFile = {
    ...file,
    repositories: Object.fromEntries(
      Object.entries(repositories).map(([name, repo]) => [name, sanitize(repo)]),
    ),
  };
  writeFile(scrubbed);
  return scrubbed;
};

const writeFile = (file: SettingsFile) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch {
    // Sem armazenamento o painel apenas deixa de pré-preencher os campos.
  }
};

const sanitize = (value: Partial<StoredSettings> | undefined): StoredSettings => ({
  domain: typeof value?.domain === "string" ? value.domain : "",
  ftpServer: typeof value?.ftpServer === "string" ? value.ftpServer : "",
  ftpLogin: typeof value?.ftpLogin === "string" ? value.ftpLogin : "",
  serverDir: typeof value?.serverDir === "string" ? value.serverDir : "",
  protocol: ftpProtocols.includes(value?.protocol as FtpProtocol)
    ? (value?.protocol as FtpProtocol)
    : "auto",
  port: typeof value?.port === "string" ? value.port : "",
  autoDeploy: value?.autoDeploy === true,
});

/**
 * Republicar um site já configurado é o caso mais comum, então os dados não
 * sensíveis do último envio voltam preenchidos.
 */
export const loadSettings = (repoFullName: string): StoredSettings => {
  const file = readFile();
  const stored = sanitize(file.repositories?.[repoFullName]);
  return stored.ftpServer
    ? stored
    : { ...stored, ftpServer: file.lastFtpServer ?? "" };
};

export const saveSettings = (
  repoFullName: string,
  settings: StoredSettings,
) => {
  const file = readFile();
  writeFile({
    lastFtpServer: settings.ftpServer || file.lastFtpServer,
    repositories: { ...file.repositories, [repoFullName]: sanitize(settings) },
  });
};

export const getLastFtpServer = () => readFile().lastFtpServer ?? "";

/** Este navegador já salvou algo para o repositório? */
export const hasStoredSettings = (repoFullName: string) =>
  Boolean(readFile().repositories?.[repoFullName]);

/** Repositórios que já foram publicados por este navegador. */
export const configuredRepositories = () =>
  new Set(Object.keys(readFile().repositories ?? {}));
