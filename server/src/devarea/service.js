import { devAreaConfig, isDevAreaConfigured, runtimeConfig } from "../config.js";
import { httpError } from "../http.js";
import { repoNameOf } from "../../../shared/lovable-repo.js";
import { slugForProject } from "../preview/service.js";
import { listGenerations, setGenerationDevArea } from "../store/generations.js";
import { listPublications } from "../store/publications.js";
import { deleteFile, listWorkflowFiles } from "../deploy/github/contents.js";
import {
  getFailedJobLog,
  getRunProgress,
  listRepos,
  listWorkflowRuns,
} from "../deploy/github/repositories.js";
import { dispatchWithRetry, githubConfig } from "../deploy/operations.js";
import { configurePublication } from "../deploy/publication.js";
import {
  buildDevAreaWorkflowFile,
  DEV_AREA_TEMPLATE_VERSION,
  DEV_AREA_WORKFLOW_FILE,
} from "../deploy/workflow-template.js";

/**
 * A área de desenvolvimento: cada site publicado numa pasta própria de um
 * domínio da Joinvix (`https://aprovacao.exemplo.com.br/zezinho/`), que é o
 * link que o cliente recebe para aprovar. Substitui o Share preview do Lovable
 * mascarado pelo encurtador.
 *
 * O fluxo, sem ninguém pedir:
 *
 * 1. o site é gerado; o painel espera o projeto ser conectado ao GitHub no
 *    Lovable (o MCP não faz essa conexão) — estado `waiting-repo`;
 * 2. o repositório aparece na organização com o nome do projeto no Lovable;
 *    o painel grava os secrets do FTP da área e o workflow
 *    `Area-de-desenvolvimento.yml`, e o próprio commit dispara a publicação;
 * 3. a cada edição no Lovable há um push, e o push publica de novo;
 * 4. o painel acompanha as execuções e, quando uma termina bem, lê o
 *    `joinvix-build.json` da pasta: só com o commit certo lá o link vale.
 *
 * O domínio do cliente continua no Deploy, depois da aprovação.
 */

/** Enquanto publica, confere a cada 15 s. */
const POLL_MS = 15_000;
/** Um build leva de 1 a 5 minutos; passado isto, algo travou. */
const GIVE_UP_MS = 45 * 60_000;
/** A pasta publicada é reconferida de tempos em tempos. */
const RECHECK_MS = 30 * 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const CLOCK_SKEW_MS = 60_000;

/**
 * @typedef {{ at: string, status: "pending" | "success" | "failure" | "unknown",
 *   runUrl: string | null, sha: string | null,
 *   progress?: { total: number, done: number, current: string | null } | null }} DevRun
 * @typedef {{ state: string, slug?: string | null, url?: string | null,
 *   repoFullName?: string | null, branch?: string | null,
 *   templateVersion?: string | null, configuredAt?: string | null,
 *   lastRun?: DevRun | null, publishedSha?: string | null,
 *   publishedAt?: string | null, checkedAt?: string | null,
 *   detail?: string | null }} DevArea
 */

/* ------------------------------------------------------------------ *
 * Regras puras — testadas sem GitHub nem rede
 * ------------------------------------------------------------------ */

/** @param {string | undefined | null} value */
const time = (value) => Date.parse(value ?? "") || 0;

/** A pasta na área e o endereço que o cliente abre. */
export function devAreaTarget(slug, area = devAreaConfig()) {
  // "/", "." e "./" são a raiz da conta FTP.
  const raiz = area.ftpDir.replace(/^\.(?=\/|$)/, "").replace(/^\/+|\/+$/g, "");
  return {
    basePath: `/${slug}/`,
    serverDir: raiz ? `${raiz}/${slug}/` : `${slug}/`,
    url: `${area.url}/${slug}/`,
  };
}

/**
 * A pasta do projeto. É do projeto, não do site: gerar de novo publica no
 * mesmo endereço que o cliente já tem. Duas coletas com o mesmo nome não
 * podem dividir a pasta — uma sobrescreveria a outra —, então a segunda ganha
 * um número.
 *
 * @param {string} projectId
 * @param {string} baseSlug
 * @param {Record<string, Array<{ devArea?: DevArea | null }>>} generations
 */
export function pickDevAreaSlug(projectId, baseSlug, generations) {
  const propria = (generations[projectId] ?? []).find((item) => item.devArea?.slug);
  if (propria) return /** @type {string} */ (propria.devArea?.slug);

  const ocupadas = new Set(
    Object.entries(generations)
      .filter(([id]) => id !== projectId)
      .flatMap(([, lista]) => lista.map((item) => item.devArea?.slug).filter(Boolean)),
  );
  let slug = baseSlug;
  for (let n = 2; ocupadas.has(slug); n += 1) slug = `${baseSlug}-${n}`;
  return slug;
}

/**
 * O repositório do site: o confirmado ao publicar ou, antes disso, o que tem
 * o nome do projeto no Lovable — é com esse nome que o GitHub o cria.
 *
 * @template {{ full_name: string, name: string }} R
 * @param {{ repoFullName?: string | null, lovableName?: string | null, devArea?: DevArea | null }} generation
 * @param {R[]} repos
 * @returns {R | null}
 */
export function findRepoForGeneration(generation, repos) {
  const porNome = (nome) =>
    repos.find((repo) => repo.full_name.toLowerCase() === nome.toLowerCase()) ?? null;

  const conhecido = generation.devArea?.repoFullName ?? generation.repoFullName;
  if (conhecido) return porNome(conhecido);
  if (!generation.lovableName) return null;

  const esperado = repoNameOf(generation.lovableName);
  if (!esperado) return null;
  return repos.find((repo) => repo.name.toLowerCase() === esperado) ?? null;
}

/**
 * Entra sozinho só o site novo: sem link curto nem entrega registrada (esses
 * já estão com o cliente pelo caminho antigo) e cujo repositório não publica
 * no domínio do cliente — site no ar não tem o que aprovar.
 *
 * @param {{ shortUrl?: string | null, deliveredAt?: string | null, origin?: string | null }} generation
 * @param {string | null} repoFullName
 * @param {Set<string>} productionRepos em minúsculas
 */
export function joinsAutomatically(generation, repoFullName, productionRepos) {
  if (generation.shortUrl || generation.deliveredAt) return false;
  // Vinculado à mão: entra quando alguém pedir — ele pode já estar com o
  // cliente por outro caminho, e publicar sozinho seria uma surpresa.
  if (generation.origin === "linked") return false;
  return !(repoFullName && productionRepos.has(repoFullName.toLowerCase()));
}

/**
 * A execução mais recente do workflow da área. Canceladas saem: são as que a
 * fila do workflow descartou quando chegaram vários pushes juntos.
 *
 * @param {Array<{ status?: string, conclusion?: string | null, created_at?: string,
 *   html_url?: string, head_sha?: string }>} runs
 * @returns {DevRun | null}
 */
export function latestDevRun(runs) {
  const ultima = runs
    .filter((run) => run.conclusion !== "cancelled")
    .sort((a, b) => time(b.created_at) - time(a.created_at))[0];
  if (!ultima) return null;

  let status = /** @type {DevRun["status"]} */ ("pending");
  if (ultima.status === "completed") {
    status = ultima.conclusion === "success" ? "success" : "failure";
  }
  return {
    at: ultima.created_at ?? new Date().toISOString(),
    status,
    runUrl: ultima.html_url ?? null,
    sha: ultima.head_sha ?? null,
  };
}

/**
 * O estado a partir da execução e do que já foi conferido no ar.
 *
 * @param {DevRun | null} lastRun
 * @param {string | null | undefined} publishedSha
 */
export function devAreaStateOf(lastRun, publishedSha) {
  if (lastRun?.status === "failure" || lastRun?.status === "unknown") return "failed";
  if (lastRun?.status === "pending") return "publishing";
  if (lastRun?.status === "success") {
    return lastRun.sha && lastRun.sha === publishedSha ? "live" : "publishing";
  }
  return publishedSha ? "live" : "publishing";
}

/**
 * Lê o marcador da pasta. `sha` é o commit que está publicado lá — ou `null`
 * quando a pasta não abre.
 *
 * @param {string} url endereço da pasta, com a barra final
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ state: "alive" | "dead" | "unknown", detail: string | null, sha: string | null, checkedAt: string }>}
 */
export async function probeDevArea(url, fetchImpl = fetch) {
  const checkedAt = new Date().toISOString();
  // O parâmetro fura o cache do LiteSpeed e de qualquer proxy no caminho.
  const alvo = `${url}joinvix-build.json?v=${Date.now()}`;
  try {
    const resposta = await fetchImpl(alvo, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (resposta.status === 404) {
      return { state: "dead", detail: "A pasta do site não está no servidor.", sha: null, checkedAt };
    }
    if (!resposta.ok) {
      return {
        state: resposta.status >= 500 ? "unknown" : "dead",
        detail: `O servidor respondeu ${resposta.status}.`,
        sha: null,
        checkedAt,
      };
    }
    /** @type {{ sha?: unknown } | null} */
    const corpo = await resposta.json().catch(() => null);
    const sha = typeof corpo?.sha === "string" ? corpo.sha : null;
    return { state: "alive", detail: null, sha, checkedAt };
  } catch (err) {
    return {
      state: "unknown",
      detail: `Não foi possível abrir a pasta (${err?.name === "TimeoutError" ? "tempo esgotado" : "falha de rede"}).`,
      sha: null,
      checkedAt,
    };
  }
}

/**
 * O motivo de uma falha, a partir do log do job: as linhas `##[error]` que os
 * scripts do workflow escrevem já dizem o que houve e o que fazer. Antes o
 * painel só mandava ver o GitHub, e o motivo ficava enterrado no log.
 *
 * @param {string} log
 * @returns {string | null}
 */
export function failureReasonFromLog(log) {
  const linhas = [];
  for (const linha of String(log ?? "").split(/\r?\n/)) {
    const achado = linha.match(/##\[error\](.*)$/);
    if (!achado) continue;
    const texto = achado[1].trim();
    if (!texto || /^Process completed with exit code/i.test(texto)) continue;
    if (!linhas.includes(texto)) linhas.push(texto);
  }
  if (!linhas.length) return null;
  const motivo = linhas.slice(0, 3).join(" ");
  return motivo.length > 600 ? `${motivo.slice(0, 597)}...` : motivo;
}

const GENERIC_FAILURE = "A publicação falhou. Veja o erro no GitHub.";

const runIdOf = (runUrl) => runUrl?.match(/\/runs\/(\d+)/)?.[1] ?? null;

/** O andamento é um detalhe: falhar ao lê-lo não pode travar a conferência. */
async function runProgressOf(owner, repo, runUrl) {
  const runId = runIdOf(runUrl);
  if (!runId) return null;
  try {
    return await getRunProgress(githubConfig(), { owner, repo, runId });
  } catch {
    return null;
  }
}

async function failureReasonOf(owner, repo, runUrl) {
  const runId = runIdOf(runUrl);
  if (!runId) return GENERIC_FAILURE;
  try {
    const log = await getFailedJobLog(githubConfig(), { owner, repo, runId });
    return failureReasonFromLog(log ?? "") ?? GENERIC_FAILURE;
  } catch (err) {
    console.warn(`[area-dev] não leu o log de ${owner}/${repo}:`, err instanceof Error ? err.message : err);
    return GENERIC_FAILURE;
  }
}

/* ------------------------------------------------------------------ *
 * GitHub e armazenamento
 * ------------------------------------------------------------------ */

const devAreaSecrets = (area) => [
  { name: "DEV_AREA_FTP_SERVER", value: area.ftpServer },
  { name: "DEV_AREA_FTP_LOGIN", value: area.ftpLogin },
  { name: "DEV_AREA_FTP_PASSWORD", value: area.ftpPassword },
  // Vazios saem do repositório: o workflow volta ao automático.
  { name: "DEV_AREA_FTP_PROTOCOL", value: area.ftpProtocol || null },
  { name: "DEV_AREA_FTP_PORT", value: area.ftpPort || null },
];

const productionRepoSet = async () =>
  new Set(
    (await listPublications()).map((publicacao) => publicacao.repoFullName.toLowerCase()),
  );

const listOrgRepos = () =>
  listRepos(githubConfig(), { organization: runtimeConfig().organization, perPage: 100 });

/** Tira o workflow da área de um repositório que deixou de ser o do site. */
async function removeDevAreaWorkflow(repoFullName, branch) {
  const [owner, repo] = repoFullName.split("/");
  const arquivos = await listWorkflowFiles(githubConfig(), { owner, repo, branch });
  const alvo = arquivos.find(
    (arquivo) => arquivo.name.toLowerCase() === DEV_AREA_WORKFLOW_FILE.toLowerCase(),
  );
  if (!alvo) return;
  await deleteFile({
    config: githubConfig(),
    owner,
    repo,
    path: alvo.path,
    sha: alvo.sha,
    branch,
    message: "Remover publicacao na area de desenvolvimento (site substituido)",
  });
}

/**
 * O repositório deixou de ser o do site (o projeto do Lovable foi trocado):
 * tira dele o workflow da área, para ele não publicar mais na pasta. Sem a
 * área ou sem token não há o que tirar. Devolve o motivo quando não tirou.
 *
 * @param {string} repoFullName
 * @param {string | null} branch
 * @returns {Promise<string | null>}
 */
export async function retireDevAreaRepo(repoFullName, branch) {
  if (!isDevAreaConfigured() || !runtimeConfig().githubToken) return null;
  try {
    await removeDevAreaWorkflow(repoFullName, branch ?? undefined);
    console.log(`[area-dev] ${repoFullName} deixou de publicar na área (projeto trocado).`);
    return null;
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.warn(`[area-dev] não tirou o workflow de ${repoFullName}: ${motivo}`);
    return `O workflow da prévia continua em ${repoFullName} (${motivo}). Apague-o no GitHub para o projeto antigo não publicar mais na pasta.`;
  }
}

/**
 * Grava secrets e workflow no repositório e marca "publicando". O commit do
 * workflow é um push, e o push dispara a publicação; quando o arquivo já
 * estava igual não há commit, então o painel dispara ele mesmo.
 */
async function configureDevArea(projectId, generation, repo, by = null) {
  const area = devAreaConfig();
  const todas = await listGenerations();
  const slug = pickDevAreaSlug(projectId, await slugForProject(projectId), todas);
  const alvo = devAreaTarget(slug, area);
  const branch = repo.default_branch || "main";
  const [owner, nome] = repo.full_name.split("/");

  const resultado = await configurePublication({
    config: githubConfig(),
    owner,
    repo: nome,
    workflowBranch: branch,
    secrets: devAreaSecrets(area),
    workflows: [
      buildDevAreaWorkflowFile({
        branch,
        basePath: alvo.basePath,
        serverDir: alvo.serverDir,
        publicUrl: alvo.url,
      }),
    ],
  });

  const agora = new Date().toISOString();
  if (resultado.workflowStatuses.every((status) => status.action === "unchanged")) {
    await dispatchWithRetry({ owner, repo: nome, workflowFile: DEV_AREA_WORKFLOW_FILE, ref: branch });
  }

  const atualizada = await setGenerationDevArea(projectId, generation.id, {
    state: "publishing",
    slug,
    url: alvo.url,
    repoFullName: repo.full_name,
    branch,
    templateVersion: DEV_AREA_TEMPLATE_VERSION,
    configuredAt: agora,
    configuredBy: by,
    lastRun: { at: agora, status: "pending", runUrl: null, sha: null },
    detail: null,
  });

  // Um site gerado de novo publica na mesma pasta; o repositório do site
  // anterior não pode continuar publicando nela a cada edição.
  for (const anterior of todas[projectId] ?? []) {
    const repoAnterior = anterior.devArea?.repoFullName;
    if (!anterior.id || anterior.id === generation.id || !repoAnterior) continue;
    if (repoAnterior.toLowerCase() === repo.full_name.toLowerCase()) continue;
    try {
      await removeDevAreaWorkflow(repoAnterior, anterior.devArea?.branch ?? undefined);
      await setGenerationDevArea(projectId, anterior.id, { state: "retired" });
    } catch (err) {
      console.warn(
        `[area-dev] não tirou o workflow de ${repoAnterior}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[area-dev] ${repo.full_name} publicando em ${alvo.url}`);
  followDevArea(projectId, generation.id);
  return atualizada;
}

/**
 * Relê as execuções e, se a última terminou bem, confere a pasta.
 *
 * @param {string} projectId
 * @param {{ id: string, devArea: DevArea }} generation
 */
async function syncDevArea(projectId, generation, { force = false } = {}) {
  const area = generation.devArea;
  if (!area?.repoFullName || !area.url) return generation;
  const [owner, repo] = area.repoFullName.split("/");

  const runs = await listWorkflowRuns(githubConfig(), {
    owner,
    repo,
    branch: area.branch ?? undefined,
    workflowFile: DEV_AREA_WORKFLOW_FILE,
    perPage: 10,
  });
  let lastRun = latestDevRun(runs);

  // Recém-configurado e a execução ainda não apareceu: segue "publicando"
  // até desistir.
  const atual = area.lastRun ?? null;
  const aindaSemExecucao =
    atual?.status === "pending" &&
    !atual.runUrl &&
    (!lastRun || time(lastRun.at) < time(atual.at) - CLOCK_SKEW_MS);
  if (aindaSemExecucao) {
    lastRun =
      Date.now() - time(atual.at) > GIVE_UP_MS
        ? { ...atual, status: "unknown" }
        : atual;
  }

  // Em andamento, o passo em que está: é o que diz se falta pouco.
  if (lastRun?.status === "pending" && lastRun.runUrl) {
    lastRun = { ...lastRun, progress: await runProgressOf(owner, repo, lastRun.runUrl) };
  }

  const patch = { lastRun: lastRun ?? atual };
  let probe = null;
  const precisaConferir =
    lastRun?.status === "success" &&
    (force ||
      lastRun.sha !== area.publishedSha ||
      Date.now() - time(area.checkedAt) > RECHECK_MS);

  if (precisaConferir) {
    const sonda = await probeDevArea(area.url);
    patch.checkedAt = sonda.checkedAt;
    if (sonda.state === "alive" && sonda.sha && sonda.sha === lastRun?.sha) {
      patch.publishedSha = sonda.sha;
      if (sonda.sha !== area.publishedSha) patch.publishedAt = sonda.checkedAt;
      patch.detail = null;
      probe = sonda;
    } else if (sonda.state === "alive") {
      // Abre, mas com outro commit: o cache do servidor ou um envio que não
      // terminou. A próxima conferência resolve.
      patch.detail = "A pasta ainda mostra a versão anterior do site.";
      if (area.publishedSha) probe = sonda;
    } else {
      patch.detail = sonda.detail;
      probe = sonda;
    }
  } else if (lastRun?.status === "unknown") {
    patch.detail = "O GitHub não iniciou a publicação. Confira o repositório.";
  } else if (lastRun?.status === "failure") {
    // O motivo é lido uma vez por execução: o log não muda depois que ela
    // termina.
    const jaLido = area.state === "failed" && area.lastRun?.runUrl === lastRun.runUrl && area.detail;
    patch.detail = jaLido ? area.detail : await failureReasonOf(owner, repo, lastRun.runUrl);
  }

  patch.state = devAreaStateOf(patch.lastRun ?? null, patch.publishedSha ?? area.publishedSha);
  return setGenerationDevArea(projectId, generation.id, patch, probe);
}

const following = new Set();

/** Confere de perto enquanto a publicação estiver em andamento. */
export function followDevArea(projectId, lovableId) {
  const chave = `${projectId}:${lovableId}`;
  if (following.has(chave)) return;
  following.add(chave);

  const seguir = async () => {
    const inicio = Date.now();
    for (;;) {
      await new Promise((done) => setTimeout(done, POLL_MS));
      const geracao = ((await listGenerations())[projectId] ?? []).find(
        (item) => item.id === lovableId,
      );
      if (!geracao?.devArea) return;
      const atualizada = await syncDevArea(projectId, geracao);
      if (atualizada.devArea?.state !== "publishing" || Date.now() - inicio > GIVE_UP_MS) return;
    }
  };

  void seguir()
    .catch((err) =>
      console.warn(`[area-dev] não acompanhou ${chave}:`, err?.message ?? err),
    )
    .finally(() => following.delete(chave));
}

/**
 * Uma passada por todos os projetos: descobre repositórios novos, regrava o
 * workflow de versão velha e relê as execuções. O último site de cada projeto
 * é o que vale.
 */
export async function sweepDevArea() {
  if (!isDevAreaConfigured() || !runtimeConfig().githubToken) return;
  const area = devAreaConfig();
  const todas = await listGenerations();
  /** @type {Array<{ full_name: string, name: string, default_branch?: string }> | null} */
  let repos = null;
  /** @type {Set<string> | null} */
  let producao = null;

  for (const [projectId, lista] of Object.entries(todas)) {
    const geracao = lista.at(-1);
    if (!geracao?.id) continue;
    try {
      const configurada = geracao.devArea?.repoFullName;
      const desatualizada =
        configurada &&
        (geracao.devArea?.templateVersion !== DEV_AREA_TEMPLATE_VERSION ||
          !geracao.devArea?.url?.startsWith(`${area.url}/`));

      if (configurada && !desatualizada) {
        const { devArea } = geracao;
        const ativa = devArea?.state === "publishing";
        if (ativa) followDevArea(projectId, geracao.id);
        else await syncDevArea(projectId, geracao);
        continue;
      }

      repos ??= await listOrgRepos();
      const repo = findRepoForGeneration(geracao, repos);

      if (!configurada) {
        producao ??= await productionRepoSet();
        if (!joinsAutomatically(geracao, repo?.full_name ?? null, producao)) continue;
      }
      if (!repo) {
        if (geracao.devArea?.state !== "waiting-repo") {
          await setGenerationDevArea(projectId, geracao.id, {
            state: "waiting-repo",
            detail: "Conecte o projeto ao GitHub no Lovable.",
          });
        }
        continue;
      }
      await configureDevArea(projectId, geracao, repo);
    } catch (err) {
      console.warn(
        `[area-dev] projeto ${projectId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Publica agora, a pedido — inclusive um site que não entraria sozinho (com
 * link curto antigo, por exemplo). Com a área já configurada, só confere.
 */
export async function publishDevAreaNow(projectId, lovableId, by = null) {
  if (!isDevAreaConfigured()) {
    throw httpError(409, "A área de aprovação não está configurada. Preencha-a em Configurações → Área de aprovação.");
  }
  if (!runtimeConfig().githubToken) {
    throw httpError(409, "Configure o token do GitHub em Configurações → GitHub e publicação.");
  }
  const geracao = ((await listGenerations())[projectId] ?? []).find(
    (item) => item.id === lovableId,
  );
  if (!geracao) throw httpError(404, "Geração não encontrada neste projeto");

  const repo = findRepoForGeneration(geracao, await listOrgRepos());
  if (!repo) {
    const conhecido = geracao.devArea?.repoFullName ?? geracao.repoFullName;
    throw httpError(
      409,
      conhecido
        ? `O repositório ${conhecido} não foi encontrado na organização. Confira se ele existe e se o token do GitHub o enxerga.`
        : "O repositório deste site ainda não existe. Conecte o projeto ao GitHub no Lovable (ou informe o repositório em “Vincular site”) e tente de novo.",
    );
  }
  return configureDevArea(projectId, geracao, repo, by);
}

/** Reconfere a pasta — o "Verificar link" dos sites na área. */
export async function checkDevArea(projectId, lovableId) {
  const geracao = ((await listGenerations())[projectId] ?? []).find(
    (item) => item.id === lovableId,
  );
  if (!geracao?.devArea?.repoFullName) {
    throw httpError(409, "Este site ainda não está na área de desenvolvimento.");
  }
  return syncDevArea(projectId, geracao, { force: true });
}

/** Na subida da API: uma passada logo e outra a cada intervalo. */
export function startDevAreaWatch({ intervalMs = devAreaConfig().watchIntervalMs } = {}) {
  if (!isDevAreaConfigured()) {
    console.log("[area-dev] desligada: faltam DEV_AREA_URL e as credenciais de FTP no .env.");
    return () => {};
  }
  if (!intervalMs || intervalMs <= 0) {
    console.log("[area-dev] publicação automática desligada (intervalo 0).");
    return () => {};
  }

  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await sweepDevArea();
    } catch (err) {
      console.error(`[area-dev] varredura falhou: ${err?.message ?? err}`);
    } finally {
      rodando = false;
    }
  };

  const timer = setInterval(() => void rodar(), intervalMs);
  timer.unref();
  const inicial = setTimeout(() => void rodar(), 15_000);
  inicial.unref();

  console.log(
    `[area-dev] ${devAreaConfig().url} — conferindo a cada ${Math.round(intervalMs / 60_000)} min.`,
  );
  return () => {
    clearInterval(timer);
    clearTimeout(inicial);
  };
}
