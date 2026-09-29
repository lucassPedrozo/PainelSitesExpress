import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { isLocalNetworkAddress } from "./security/network.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");

/**
 * Dentro do `node --test` o `.env` da máquina não é lido: os testes definem o
 * que precisam, e assim rodam iguais no computador de quem desenvolve e no CI —
 * sem herdar token de GitHub nem chave do painel por acaso.
 */
const underTestRunner = Boolean(process.env.NODE_TEST_CONTEXT);

if (!underTestRunner) {
  dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });
  dotenv.config({ path: path.join(projectRoot, "server", ".env"), quiet: true });
}

export const envPath = path.join(projectRoot, ".env");

const getPort = () => {
  const port = Number(process.env.PORT ?? 3333);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT deve ser um número inteiro entre 1 e 65535.");
  }
  return port;
};

/**
 * `https://site.com.br/betterlinks/mcp` → `https://site.com.br`. Um override
 * explícito ganha, para o caso de o MCP responder num host diferente do que
 * serve os links curtos.
 */
const publicBaseFrom = (override, mcpUrl) => {
  const explicito = (override ?? "").trim().replace(/\/+$/, "");
  if (explicito) return explicito;

  const bruto = (mcpUrl ?? "").trim();
  if (!bruto) return "";
  try {
    const { origin } = new URL(bruto);
    return origin;
  } catch {
    return "";
  }
};

const getServerHost = () => {
  const host = (process.env.SERVER_HOST ?? "127.0.0.1").trim().toLowerCase();
  if (
    host !== "0.0.0.0" &&
    host !== "localhost" &&
    !isLocalNetworkAddress(host)
  ) {
    throw new Error(
      "SERVER_HOST deve apontar para loopback ou um endereço IP privado da rede local.",
    );
  }
  return host;
};

export const config = {
  port: getPort(),
  // Por padrão só a própria máquina alcança a API. Abrir para a LAN exige
  // SERVER_HOST=0.0.0.0 e, na prática, uma PANEL_ACCESS_TOKEN.
  serverHost: getServerHost(),
  allowedHosts: (process.env.LAN_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  rootFolderId: process.env.DRIVE_ROOT_FOLDER_ID ?? "",
  credentialsPath: path.isAbsolute(process.env.GOOGLE_CREDENTIALS_PATH ?? "")
    ? process.env.GOOGLE_CREDENTIALS_PATH
    : path.join(projectRoot, process.env.GOOGLE_CREDENTIALS_PATH ?? ""),
  cacheTtlMs: Number(process.env.CACHE_TTL_MS ?? 60_000),
  projectRoot,
  /**
   * Onde ficam os arquivos de estado (banco, sessões, tokens do Lovable). Só
   * muda para testes e verificações: apontar para uma cópia evita mexer nos
   * dados de verdade.
   */
  dataDir: process.env.PANEL_DATA_DIR
    ? path.resolve(process.env.PANEL_DATA_DIR)
    : path.join(projectRoot, "server", "data"),
  webDistPath: path.join(projectRoot, "web", "dist"),
  /**
   * Encurtador de links (BetterLinks, via MCP). O `publicBase` sai da própria
   * URL do MCP: o BetterLinks devolve só o slug do link, e a URL que vai ao
   * cliente precisa do domínio na frente.
   */
  shortlinks: {
    mcpUrl: (process.env.BETTERLINKS_MCP_URL ?? "").trim(),
    mcpToken: (process.env.BETTERLINKS_MCP_TOKEN ?? "").trim(),
    publicBase: publicBaseFrom(
      process.env.BETTERLINKS_PUBLIC_BASE,
      process.env.BETTERLINKS_MCP_URL,
    ),
    /**
     * De quanto em quanto tempo o painel reconfere os links de cliente.
     * `0` desliga a varredura automática e deixa só a manual.
     */
    watchIntervalMs: Number(process.env.PREVIEW_WATCH_INTERVAL_MS ?? 30 * 60_000),
  },
  lovable: {
    // Trava do gasto: enquanto for falso, o painel monta e confere o envio,
    // mas nunca chama `create_project` — a única tool que debita crédito.
    enableGeneration: process.env.LOVABLE_ENABLE_GENERATION === "1",
    maxAttachments: Number(process.env.LOVABLE_MAX_ATTACHMENTS ?? 20),
    // 64 MB. Teto do painel, não do Lovable: o armazenamento dele aceitou PUT
    // de 25 e 60 MB. Vídeo e compactado costumam passar de 20 MB, e o limite
    // antigo tornaria a liberação desses tipos inútil na prática.
    maxAttachmentBytes: Number(
      process.env.LOVABLE_MAX_ATTACHMENT_BYTES ?? 64 * 1024 * 1024,
    ),
  },
};

/**
 * O que a API precisa para subir. Conferido na partida (`index.js`), e não ao
 * importar este módulo: assim os testes carregam o store e as rotas sem Drive
 * configurado.
 */
export const assertStartupConfig = () => {
  if (!config.rootFolderId) {
    throw new Error("DRIVE_ROOT_FOLDER_ID não definido no .env");
  }
};

/**
 * A parte editável pela tela de configuração fica separada: ela é regravada no
 * `.env` em tempo de execução, então precisa ser relida depois de cada escrita
 * em vez de congelar no arranque como o resto.
 */
let cachedRuntime = null;

export const runtimeConfig = () => {
  cachedRuntime ??= {
    githubToken: (process.env.GITHUB_TOKEN ?? "").trim(),
    organization: (process.env.GITHUB_ORG ?? "").trim(),
    defaultFtpHost: (process.env.DEFAULT_FTP_HOST ?? "").trim(),
    panelAccessToken: (process.env.PANEL_ACCESS_TOKEN ?? "").trim(),
  };
  return cachedRuntime;
};

export const resetRuntimeConfig = () => {
  cachedRuntime = null;
};

/**
 * A área de desenvolvimento: o domínio em que cada site é publicado numa
 * pasta própria para o cliente aprovar (`https://sitexpress.../zezinho/`),
 * antes de ir para o domínio dele.
 *
 * Lida a cada chamada, e não no arranque: o `.env` pode ganhar as credenciais
 * com o painel de pé, e os testes definem o que precisam.
 */
export const devAreaConfig = () => {
  const url = (process.env.DEV_AREA_URL ?? "").trim().replace(/\/+$/, "");
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  const ftpDir = (process.env.DEV_AREA_FTP_DIR ?? "").trim();
  const intervalo = Number(process.env.DEV_AREA_WATCH_INTERVAL_MS ?? 3 * 60_000);

  return {
    url,
    ftpServer: (process.env.DEV_AREA_FTP_SERVER ?? "").trim(),
    ftpLogin: (process.env.DEV_AREA_FTP_LOGIN ?? "").trim(),
    ftpPassword: process.env.DEV_AREA_FTP_PASSWORD ?? "",
    // O mesmo padrão do workflow de produção (DirectAdmin). Uma conta FTP
    // presa à pasta do domínio entra direto no public_html: aí o valor é "/".
    ftpDir: ftpDir || (host ? `domains/${host}/public_html` : ""),
    ftpProtocol: (process.env.DEV_AREA_FTP_PROTOCOL ?? "").trim(),
    ftpPort: (process.env.DEV_AREA_FTP_PORT ?? "").trim(),
    /** `0` desliga a publicação automática; o botão do painel continua. */
    watchIntervalMs: Number.isFinite(intervalo) ? intervalo : 3 * 60_000,
  };
};

export const isDevAreaConfigured = () => {
  const area = devAreaConfig();
  return Boolean(
    /^https:\/\/[^/]+$/.test(area.url) &&
      area.ftpServer &&
      area.ftpLogin &&
      area.ftpPassword,
  );
};
