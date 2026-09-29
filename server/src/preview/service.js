import { cached } from "../cache.js";
import { httpError } from "../http.js";
import { config } from "../config.js";
import { getFileMeta } from "../drive.js";
import {
  listGenerations,
  setGenerationPreview,
  setGenerationPreviewState,
} from "../store/generations.js";
import { listProjectNames } from "../store/project-names.js";
import {
  ensureShortLink,
  inspectShortLink,
  isConfigured as shortlinksConfigured,
  slugifyShortlink,
} from "../shortlinks/service.js";
import {
  parseSharePreviewUrl,
  probeSharePreview,
  probeShortLink,
} from "./share-link.js";

/**
 * O link que vai ao cliente, de ponta a ponta.
 *
 * Fluxo: o operador cria o "Share preview" no Lovable (o MCP de lá não tem
 * tool para isso) e cola aqui. O painel sonda, mascara com um link curto
 * estável do BetterLinks e passa a vigiar. Quando o share morre, o mesmo link
 * curto é repontado para o novo — o cliente nunca troca de endereço.
 */

/** `[04/09/2026] www.aurora.eng.br` → `www.aurora.eng.br`. */
const nomeSemData = (nome) =>
  String(nome ?? "")
    .trim()
    .replace(/^\[\d{2}\/\d{2}\/\d{4}\]\s*/, "");

/**
 * O slug pertence ao projeto, não à geração: é o que mantém o endereço do
 * cliente igual quando o site é gerado de novo.
 */
export async function slugForProject(projectId) {
  const apelidos = await listProjectNames();
  const apelido = apelidos[projectId];

  if (apelido) {
    const slug = slugifyShortlink(apelido);
    if (slug) return slug;
  }

  const meta = await cached(`meta:${projectId}`, () => getFileMeta(projectId));
  const slug = slugifyShortlink(nomeSemData(meta?.name));
  // Pasta sem nome aproveitável cai no id do Drive, que é feio mas único.
  return slug || slugifyShortlink(projectId);
}

/**
 * Registra (ou troca) o link de share e garante o link curto que o mascara.
 *
 * Um share que a sonda reprova é recusado aqui: mascarar um link morto seria
 * entregar ao cliente um endereço que não abre. Já um resultado
 * indeterminado passa — a rede pode ter falhado —, e quem barra o envio nesse
 * caso é a trava do "pronto", que exige `alive`.
 */
export async function attachSharePreview(projectId, lovableId, rawUrl) {
  const { url } = parseSharePreviewUrl(rawUrl);

  const probe = await probeSharePreview(url);
  if (probe.state === "dead") {
    throw httpError(422, `Este link não abre para o cliente. ${probe.detail} Crie um novo "Share preview" no Lovable e cole o link novo.`);
  }

  const slug = await slugForProject(projectId);
  const meta = await cached(`meta:${projectId}`, () => getFileMeta(projectId));
  const titulo = nomeSemData(meta?.name) || slug;

  const geracoes = (await listGenerations())[projectId] ?? [];
  if (!geracoes.some((item) => item.id === lovableId)) {
    throw httpError(404, "Geração não encontrada neste projeto");
  }

  // O link é do projeto, não da geração: uma geração nova ainda não tem
  // `shortLinkId`, mas herda o endereço que as anteriores já entregaram.
  const link = await ensureShortLink({
    slug,
    ownIds: geracoes.map((item) => item.shortLinkId),
    title: titulo,
    targetUrl: url,
  });

  await setGenerationPreview(projectId, lovableId, {
    sharePreviewUrl: url,
    shortLinkId: link.id,
    shortSlug: link.slug,
    shortUrl: link.url,
  });

  const entry = await setGenerationPreviewState(projectId, lovableId, probe);
  return { generation: entry, shortLink: link };
}

/**
 * Confere o link de cliente pelo que o cliente recebe: o link curto.
 *
 * 1. Sincroniza com o encurtador o endereço real (com o prefixo que ele
 *    antepõe) e o destino — se alguém repontou no WordPress, é para lá que o
 *    cliente vai, e é esse destino que vale;
 * 2. sonda a prévia;
 * 3. com a prévia aberta, sonda o link curto: ele tem de redirecionar para
 *    ela. Antes só a prévia era sondada, e um link curto em 404 passava como
 *    aberto.
 */
async function conferirLinkDoCliente(projectId, entry) {
  let atual = entry;
  let problema = null;

  if (entry.shortLinkId && shortlinksConfigured()) {
    try {
      const real = await inspectShortLink({
        id: entry.shortLinkId,
        slug: entry.shortSlug,
      });
      if (!real) {
        problema = "O link curto foi apagado no encurtador.";
      } else {
        const patch = {};
        if (real.url && real.url !== entry.shortUrl) {
          patch.shortUrl = real.url;
          patch.shortSlug = real.slug;
        }
        if (real.targetUrl && real.targetUrl !== entry.sharePreviewUrl) {
          patch.sharePreviewUrl = real.targetUrl;
        }
        if (Object.keys(patch).length > 0) {
          atual = await setGenerationPreview(projectId, entry.id, patch);
        }
      }
    } catch (err) {
      // Encurtador fora do ar não condena o link: a sonda da prévia segue.
      console.warn(`[preview] encurtador indisponível: ${err?.message ?? err}`);
    }
  }

  let probe = await probeSharePreview(atual.sharePreviewUrl);
  if (problema) {
    probe = { state: "dead", detail: problema, checkedAt: probe.checkedAt };
  } else if (probe.state === "alive" && atual.shortUrl) {
    const curto = await probeShortLink(atual.shortUrl, atual.sharePreviewUrl);
    if (curto.ok === false) {
      probe = { state: "dead", detail: curto.detail, checkedAt: probe.checkedAt };
    }
  }

  return setGenerationPreviewState(projectId, entry.id, probe);
}

/** Reconfere um link já registrado. */
export async function checkSharePreview(projectId, lovableId) {
  const atual = await geracao(projectId, lovableId);

  if (!atual?.sharePreviewUrl) {
    throw httpError(409, 'Nenhum link de visualização registrado. Cole o link do "Share preview" primeiro.');
  }

  const entry = await conferirLinkDoCliente(projectId, atual);
  return { generation: entry };
}

/**
 * Reconfere tudo que tem link registrado. É o varredor que responde à pergunta
 * "algum cliente está com link quebrado agora?" sem abrir projeto por projeto.
 */
export async function checkAllSharePreviews() {
  const todas = await listGenerations();
  const resultados = [];

  for (const [projectId, lista] of Object.entries(todas)) {
    for (const entry of lista) {
      if (!entry.sharePreviewUrl || !entry.id) continue;
      // Na área de desenvolvimento quem responde pelo link é a pasta, conferida
      // pelo acompanhamento de lá.
      if (entry.devArea?.repoFullName) continue;
      const conferida = await conferirLinkDoCliente(projectId, entry);
      resultados.push({
        projectId,
        lovableId: entry.id,
        state: conferida.previewState,
        detail: conferida.previewDetail,
      });
    }
  }

  const contagem = { alive: 0, dead: 0, unknown: 0 };
  for (const item of resultados) contagem[item.state] += 1;
  return { checked: resultados.length, summary: contagem, results: resultados };
}

/**
 * Vigia os links de cliente sozinho.
 *
 * Sem isto, um link que morre só é descoberto quando alguém clica em
 * verificar — e o intervalo entre morrer e descobrir é exatamente a janela em
 * que um cliente abre um link quebrado. A varredura fecha essa janela, e a
 * marca de "pronto" cai junto, porque `setGenerationPreviewState` desmarca o
 * que deixou de abrir.
 *
 * `unref()` no timer: um relógio pendurado não deve ser o motivo de o processo
 * continuar vivo quando o operador encerra o painel.
 */
export function startSharePreviewWatch({
  intervalMs = config.shortlinks.watchIntervalMs,
} = {}) {
  if (!intervalMs || intervalMs <= 0) {
    console.log("[preview] varredura automática desligada (intervalo 0).");
    return () => {};
  }

  let rodando = false;

  const rodar = async () => {
    // Uma varredura por vez: a anterior pode estar lenta por causa do Lovable.
    if (rodando) return;
    rodando = true;
    try {
      const { checked, summary } = await checkAllSharePreviews();
      if (!checked) return;
      if (summary.dead) {
        console.warn(
          `[preview] ${summary.dead} link(s) de cliente não abrem.`,
        );
      } else {
        console.log(
          `[preview] ${checked} link(s) conferido(s); todos abrem para o cliente.`,
        );
      }
    } catch (err) {
      console.error(`[preview] varredura falhou: ${err.message}`);
    } finally {
      rodando = false;
    }
  };

  const timer = setInterval(() => void rodar(), intervalMs);
  timer.unref();

  // A primeira passada espera um pouco: no arranque o que importa é a API
  // responder, não conferir link.
  const inicial = setTimeout(() => void rodar(), 20_000);
  inicial.unref();

  const minutos = Math.round(intervalMs / 60_000);
  console.log(`[preview] varredura automática dos links a cada ${minutos} min.`);

  return () => {
    clearInterval(timer);
    clearTimeout(inicial);
  };
}

const geracao = async (projectId, lovableId) => {
  const todas = await listGenerations();
  return (todas[projectId] ?? []).find((item) => item.id === lovableId) ?? null;
};
