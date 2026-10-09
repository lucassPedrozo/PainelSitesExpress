import { createHash } from "node:crypto";
import {
  getGitHubBaseUrl,
  getJson,
  GitHubRequestError,
  requestJson,
} from "./client.js";

/*
 * Criação de repositório e commit de um site inteiro, pela API de dados do
 * git (blobs, árvore, commit, ref). A API de conteúdo grava um arquivo por
 * commit; um site tem centenas, e cada commit dispararia o workflow de push.
 * Aqui o site entra num commit só.
 */

/** Um blob grande leva mais que os 20 s de uma chamada comum. */
const BLOB_TIMEOUT_MS = 180_000;
const BLOB_CONCURRENCY = 4;
const WRITE_ATTEMPTS = 4;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const repoUrl = (config, owner, repo) => `${getGitHubBaseUrl(config)}/repos/${owner}/${repo}`;

const post = (url, config, body, timeoutMs) =>
  requestJson(url, config, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
  });

/**
 * O cliente não repete escritas — repetir um commit o duplicaria. Blob e
 * árvore são endereçados pelo conteúdo: gravar duas vezes dá no mesmo objeto,
 * então estes podem insistir quando o GitHub pede calma ou tropeça.
 */
const isTransient = (error) =>
  error instanceof GitHubRequestError &&
  (error.status === 429 ||
    error.status >= 500 ||
    (error.status === 403 && /rate limit|abuse/i.test(error.message)));

async function insisting(action) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (!isTransient(error) || attempt >= WRITE_ATTEMPTS) throw error;
      await wait(1500 * 2 ** (attempt - 1));
    }
  }
}

/** O SHA que o git dá a estes bytes — igual ao do blob já gravado, se houver. */
export const blobShaOf = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/** O repositório, ou `null` se não existe (ou o token não o enxerga). */
export const getRepository = async (config, { owner, repo }) => {
  try {
    return await getJson(repoUrl(config, owner, repo), config);
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
};

/**
 * Cria o repositório na organização, já com um commit inicial: a API de dados
 * do git não grava em repositório vazio.
 */
export const createOrgRepository = async (config, { organization, name, isPrivate = true, description }) => {
  try {
    return await post(`${getGitHubBaseUrl(config)}/orgs/${organization}/repos`, config, {
      name,
      private: isPrivate,
      auto_init: true,
      ...(description ? { description } : {}),
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 403) {
      throw new GitHubRequestError(
        `O token do GitHub não pode criar repositórios em ${organization}. No token fine-grained, dê a permissão “Administration: Read and write” e acesso a “All repositories” da organização — um repositório novo não entra numa lista de repositórios escolhidos. ${error.message}`,
        403,
        error.requiredPermission,
      );
    }
    if (error instanceof GitHubRequestError && error.status === 422) {
      throw new GitHubRequestError(
        `O GitHub recusou criar o repositório “${name}” — o nome já existe na organização ou não é aceito. ${error.message}`,
        422,
      );
    }
    throw error;
  }
};

/** A ponta da branch. Logo depois de criar o repositório ela leva uns segundos. */
async function headOf(config, owner, repo, branch) {
  const url = `${repoUrl(config, owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const ref = await getJson(url, config);
      return ref.object.sha;
    } catch (error) {
      const pending =
        error instanceof GitHubRequestError && (error.status === 404 || error.status === 409);
      if (!pending || attempt >= 6) throw error;
      await wait(1000 * attempt);
    }
  }
}

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * Deixa a branch com exatamente estes arquivos, num commit só.
 *
 * O que já está em `keep` (por padrão, `.github/workflows/`) continua: é do
 * painel, não do site, e sumir com ele tiraria a publicação do ar. Arquivo
 * que o repositório já tem igual não é enviado de novo — atualizar um site
 * custa só o que mudou. Sem mudança nenhuma, não há commit.
 *
 * @param {{
 *   config: object, owner: string, repo: string, branch: string, message: string,
 *   files: Array<{ path: string, read: () => Promise<Buffer> }>,
 *   keep?: (path: string) => boolean,
 * }} params
 * @returns {Promise<{ sha: string, changed: boolean, uploaded: number, total: number }>}
 */
export async function commitSite({
  config,
  owner,
  repo,
  branch,
  message,
  files,
  keep = (path) => path.startsWith(".github/workflows/"),
}) {
  const base = repoUrl(config, owner, repo);
  const parentSha = await headOf(config, owner, repo, branch);
  const parent = await getJson(`${base}/git/commits/${parentSha}`, config);
  const current = await getJson(`${base}/git/trees/${parent.tree.sha}?recursive=1`, config);
  if (current.truncated) {
    throw new GitHubRequestError(
      "O repositório tem arquivos demais para o painel comparar. Atualize-o pelo git.",
      422,
    );
  }

  /** @type {Map<string, { sha: string, mode: string }>} */
  const existing = new Map(
    (current.tree ?? [])
      .filter((item) => item.type === "blob")
      .map((item) => [item.path, { sha: item.sha, mode: item.mode }]),
  );

  let uploaded = 0;
  const entries = await mapLimited(files, BLOB_CONCURRENCY, async (file) => {
    const bytes = await file.read();
    const sha = blobShaOf(bytes);
    const known = existing.get(file.path);
    if (known?.sha !== sha) {
      await insisting(() =>
        post(
          `${base}/git/blobs`,
          config,
          { content: bytes.toString("base64"), encoding: "base64" },
          BLOB_TIMEOUT_MS,
        ),
      );
      uploaded += 1;
    }
    // O modo do que já existia continua (um script executável segue assim).
    return { path: file.path, mode: known?.sha === sha ? known.mode : "100644", type: "blob", sha };
  });

  const sitePaths = new Set(files.map((file) => file.path));
  for (const [path, item] of existing) {
    if (keep(path) && !sitePaths.has(path)) {
      entries.push({ path, mode: item.mode, type: "blob", sha: item.sha });
    }
  }

  const tree = await insisting(() => post(`${base}/git/trees`, config, { tree: entries }, BLOB_TIMEOUT_MS));
  if (tree.sha === parent.tree.sha) {
    return { sha: parentSha, changed: false, uploaded: 0, total: files.length };
  }

  const commit = await post(`${base}/git/commits`, config, {
    message,
    tree: tree.sha,
    parents: [parentSha],
  });
  await requestJson(`${base}/git/refs/heads/${encodeURIComponent(branch)}`, config, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { sha: commit.sha, changed: true, uploaded, total: files.length };
}
