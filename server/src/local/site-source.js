import { entryContent, readZipDirectory, unreadableReason } from "../archive/zip-reader.js";
import { httpError } from "../http.js";
import { listChildren, readRange, readStream, statFile, walkFiles } from "./storage.js";

/**
 * O código de um site guardado no projeto, pronto para virar repositório.
 *
 * A origem é uma pasta do projeto ou um `.zip` dentro dele — como o Claude
 * entrega um projeto. Daqui sai a lista do que vai ao GitHub: sem o que não é
 * código (dependências instaladas, build pronto), sem o que não pode ir
 * (`.env` com chaves) e sem a pasta que só embrulha o projeto no zip.
 *
 * As regras são puras (`planSiteFiles`) e testadas sem disco; abrir a origem
 * fica em `openSiteSource`.
 */

/** O GitHub recusa blob acima de 100 MB; bem antes disso já não é código de site. */
const MAX_SITE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SITE_FILES = 3000;
const MAX_SITE_BYTES = 500 * 1024 * 1024;

/** Nunca vão, em nenhum nível: não são do site ou são administrados pelo painel. */
const SKIPPED_DIRS = new Map([
  ["node_modules", "dependências instaladas (node_modules)"],
  [".git", "histórico do git (.git)"],
  // Os workflows recebem a senha do FTP: quem os grava é o painel.
  [".github", "workflows do GitHub (.github) — o painel grava os dele"],
]);

/** Saídas de build: só são lixo quando há um `package.json` que as refaz. */
const BUILD_DIRS = new Set(["dist", ".output", ".next", ".nuxt", ".vite", ".cache", ".turbo", ".svelte-kit"]);

const JUNK_FILE = /^(\.DS_Store|Thumbs\.db|desktop\.ini|npm-debug\.log.*|.*\.log)$/i;
/** `.env`, `.env.local`, `.env.production`… — menos os modelos sem valor. */
const ENV_FILE = /^\.env(\..+)?$/i;
const ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i;

/**
 * Tira a pasta que só embrulha o projeto: o zip de "meu-site/" traz tudo um
 * nível abaixo. Vale enquanto a raiz não tiver arquivo nenhum e houver uma
 * pasta só.
 *
 * @param {string[]} paths
 * @returns {string} o prefixo a remover, com a barra final (ou "")
 */
export function wrapperPrefix(paths) {
  let prefix = "";
  for (;;) {
    const rest = paths.map((item) => item.slice(prefix.length));
    if (!rest.length || rest.some((item) => !item.includes("/"))) return prefix;
    const tops = new Set(rest.map((item) => item.slice(0, item.indexOf("/"))));
    if (tops.size !== 1) return prefix;
    const [top] = tops;
    // Uma pasta `src/` sozinha não é embrulho — é o projeto sem a raiz.
    if (SKIPPED_DIRS.has(top) || top === "src" || top === "public") return prefix;
    prefix += `${top}/`;
  }
}

/**
 * Decide o que vai ao repositório.
 *
 * @template {{ path: string, size: number }} F
 * @param {F[]} entries arquivos da origem, com o caminho relativo a ela
 * @returns {{
 *   files: Array<F & { repoPath: string }>,
 *   kind: "build" | "static",
 *   totalBytes: number,
 *   skipped: Array<{ reason: string, count: number }>,
 *   warnings: string[],
 * }}
 */
export function planSiteFiles(entries) {
  const prefix = wrapperPrefix(entries.map((entry) => entry.path));
  const inner = entries.map((entry) => ({ entry, repoPath: entry.path.slice(prefix.length) }));
  const hasPackage = inner.some((item) => item.repoPath === "package.json");
  const hasIndex = inner.some((item) => item.repoPath === "index.html");

  if (!inner.length) throw httpError(422, "Não há arquivos nesta origem.");
  if (!hasPackage && !hasIndex) {
    throw httpError(
      422,
      "O painel não achou package.json nem index.html na raiz. Escolha a pasta (ou o .zip) que tem o código do site.",
    );
  }

  /** @type {Map<string, number>} */
  const skipped = new Map();
  const skip = (reason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const warnings = [];
  const files = [];

  for (const { entry, repoPath } of inner) {
    const parts = repoPath.split("/");
    const name = parts.at(-1) ?? "";
    const skippedDir = parts.slice(0, -1).find((part) => SKIPPED_DIRS.has(part));
    if (skippedDir) {
      skip(/** @type {string} */ (SKIPPED_DIRS.get(skippedDir)));
      continue;
    }
    if (hasPackage && BUILD_DIRS.has(parts[0]) && parts.length > 1) {
      skip(`build pronto (${parts[0]}) — o GitHub gera de novo`);
      continue;
    }
    if (ENV_FILE.test(name) && !ENV_TEMPLATE.test(name)) {
      skip("arquivos .env — podem ter chaves; informe as variáveis de build ao publicar");
      continue;
    }
    if (JUNK_FILE.test(name)) {
      skip("arquivos do sistema e logs");
      continue;
    }
    if (entry.size > MAX_SITE_FILE_BYTES) {
      throw httpError(
        422,
        `${repoPath} tem mais de ${MAX_SITE_FILE_BYTES / 1024 / 1024} MB — grande demais para o repositório. Tire-o do site ou hospede o arquivo fora.`,
      );
    }
    files.push({ ...entry, repoPath });
  }

  if (!files.length) throw httpError(422, "Depois de tirar o que não vai ao repositório, não sobrou arquivo.");
  if (files.length > MAX_SITE_FILES) {
    throw httpError(
      422,
      `São ${files.length.toLocaleString("pt-BR")} arquivos — mais que os ${MAX_SITE_FILES.toLocaleString("pt-BR")} que o painel envia. Confira se a pasta certa foi escolhida.`,
    );
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_SITE_BYTES) {
    throw httpError(422, `O site passa de ${MAX_SITE_BYTES / 1024 / 1024} MB — grande demais para enviar pelo painel.`);
  }

  if (hasPackage && !files.some((file) => /^(package-lock\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$/.test(file.repoPath))) {
    warnings.push("Sem arquivo de lock (package-lock.json e afins): o build instala as versões mais recentes das dependências.");
  }
  if (!hasPackage && inner.some((item) => /^(src\/|vite\.config\.)/.test(item.repoPath))) {
    warnings.push("Há código-fonte (src/, vite.config) mas não há package.json: o site será publicado como está, sem build.");
  }

  return {
    files,
    kind: hasPackage ? "build" : "static",
    totalBytes,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    warnings,
  };
}

const isZipPath = (relativePath) => /\.zip$/i.test(relativePath);

/** Tudo de um fluxo, em memória. */
async function bufferOf(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Abre a origem — pasta ou `.zip` do projeto — e devolve o plano de envio, com
 * a leitura de cada arquivo.
 *
 * @param {string} projectId
 * @param {string} sourcePath caminho dentro do projeto; vazio é a raiz
 */
export async function openSiteSource(projectId, sourcePath) {
  if (isZipPath(sourcePath)) {
    const zip = await statFile(projectId, sourcePath);
    const directory = await readZipDirectory(zip.size, (start, end) =>
      readRange(zip.absolute, start, end),
    );
    if (directory.truncated) {
      throw httpError(422, "Este .zip tem arquivos demais para o painel ler. Envie a pasta do site em vez do compactado.");
    }
    const blocked = directory.entries.map(unreadableReason).find(Boolean);
    if (blocked) throw httpError(422, blocked);

    const plan = planSiteFiles(directory.entries);
    return {
      ...plan,
      files: plan.files.map((entry) => ({
        path: entry.repoPath,
        size: entry.size,
        read: () =>
          bufferOf(
            entryContent(readStream(zip.absolute, { start: entry.offset, end: entry.end - 1 }), entry),
          ),
      })),
    };
  }

  const plan = planSiteFiles(await walkFiles(projectId, sourcePath));
  return {
    ...plan,
    files: plan.files.map((file) => ({
      path: file.repoPath,
      size: file.size,
      read: () => bufferOf(readStream(file.absolute)),
    })),
  };
}

/** Até onde o painel procura uma origem sozinho: a raiz e dois níveis de pasta. */
const CANDIDATE_DEPTH = 2;

/**
 * As origens que o projeto tem: as pastas e os `.zip` (perto da raiz) em que
 * há um site. A tela oferece essas; a pessoa não precisa digitar caminho.
 *
 * @param {string} projectId
 */
export async function findSiteSources(projectId) {
  /** @type {string[]} */
  const paths = [""];
  const visit = async (relative, depth) => {
    for (const item of await listChildren(projectId, relative)) {
      if (item.directory) {
        if (SKIPPED_DIRS.has(item.name) || BUILD_DIRS.has(item.name)) continue;
        paths.push(item.path);
        if (depth < CANDIDATE_DEPTH) await visit(item.path, depth + 1);
      } else if (isZipPath(item.name)) {
        paths.push(item.path);
      }
    }
  };
  await visit("", 1);

  const sources = [];
  for (const candidate of paths) {
    try {
      const plan = await openSiteSource(projectId, candidate);
      sources.push({
        path: candidate,
        type: isZipPath(candidate) ? "zip" : "folder",
        kind: plan.kind,
        fileCount: plan.files.length,
        totalBytes: plan.totalBytes,
        skipped: plan.skipped,
        warnings: plan.warnings,
      });
    } catch (err) {
      // Pasta sem site, zip que não abre: não é origem — segue.
      if (!(err?.status >= 400 && err.status < 500)) throw err;
    }
  }

  // Uma pasta que só embrulha outra aparece duas vezes com o mesmo conteúdo:
  // fica a de dentro, que é a que tem o site de fato.
  return sources.filter(
    (source) =>
      source.type === "zip" ||
      !sources.some(
        (other) =>
          other !== source &&
          other.type === "folder" &&
          other.path.startsWith(source.path ? `${source.path}/` : "") &&
          other.path !== source.path &&
          other.fileCount === source.fileCount &&
          other.totalBytes === source.totalBytes,
      ),
  );
}
