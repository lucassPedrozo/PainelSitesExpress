import { config } from "../config.js";
import {
  callTool,
  isConfigured,
  ShortlinkConfirmationRequired,
  ShortlinkError,
} from "./mcp.js";

/**
 * O link curto que vai ao cliente.
 *
 * A regra que manda no desenho: **o link é estável**. Ele pertence ao projeto,
 * não à geração. Quando o preview do Lovable é recriado (o antigo foi excluído,
 * ou o site foi gerado de novo), o painel repõe o destino do mesmo link em vez
 * de emitir outro — quem já recebeu o endereço continua com ele valendo.
 */

const MAX_SLUG = 60;

/** Slug seguro para o BetterLinks, que troca o que não conhece por hífen. */
export function slugifyShortlink(valor) {
  const base = String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base.slice(0, MAX_SLUG).replace(/-+$/, "");
}

/** `formularios.joinvix.com.br` + caminho do link. */
export function publicUrlFor(path) {
  const base = config.shortlinks.publicBase;
  if (!base) return null;
  return `${base}/${path}`;
}

/**
 * O caminho em que o link responde. Não é o slug: o BetterLinks antepõe o
 * prefixo configurado (hoje "siteprofissional/") aos links criados depois que
 * ele foi ligado, e só `short_url` diz o caminho real. Montar o endereço pelo
 * slug entregava ao cliente um link que respondia 404.
 */
export const shortLinkPath = (link) =>
  String(link?.short_url || link?.link_slug || "").replace(/^\/+/, "") || null;

/**
 * Os links de uma página do `list-links`, nos dois formatos que o BetterLinks
 * já usou: o atual (`results`, paginado) e o antigo (listas por categoria).
 * O painel lia só o antigo e, depois da mudança, enxergava zero links — nunca
 * reapontava, só criava outro.
 */
export function linksFromListResponse(dados) {
  if (!dados || typeof dados !== "object") return [];
  if (Array.isArray(dados.results)) return dados.results;
  return Object.values(dados).flatMap((categoria) => categoria?.lists ?? []);
}

/** O teto do `list-links` por página. */
const PAGE_SIZE = 200;

const listarLinks = async () => {
  const links = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const dados = await callTool("list-links", { limit: PAGE_SIZE, offset });
    const pagina = linksFromListResponse(dados);
    links.push(...pagina);
    // Formato antigo não pagina; o novo avisa quando há mais.
    if (!dados?.has_more || pagina.length === 0) return links;
  }
};

/** O link pelo ID (uma chamada só) ou, sem ele, pelo slug na lista. */
const encontrarLink = async ({ slug, id }) => {
  if (id) {
    const dados = await callTool("get-link", { ID: Number(id) });
    const achado = Array.isArray(dados?.results) ? dados.results[0] : dados;
    if (achado?.ID) return achado;
  }
  if (!slug) return null;
  const links = await listarLinks();
  return links.find((link) => link.link_slug === slug) ?? null;
};

/** Até onde procurar um slug livre (`slug`, `slug-2`, … `slug-20`). */
const MAX_SLUG_ATTEMPTS = 20;

const slugWithSuffix = (slug, n) => {
  if (n === 1) return slug;
  const suffix = `-${n}`;
  return `${slug.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "")}${suffix}`;
};

/**
 * Decide qual link curto usar. Separado da rede de propósito: é a regra que
 * impede um cliente de receber o site de outro, e regra assim merece teste.
 *
 * Antes, sem `id`, qualquer link com o mesmo slug era reaproveitado e
 * **repontado**. Dois projetos com o mesmo apelido — ou um link criado à mão
 * no WordPress — faziam o endereço já entregue ao cliente A passar a abrir o
 * site do cliente B. Agora só se reaproveita link cujo ID já pertence a este
 * projeto; slug ocupado por qualquer outro link ganha um sufixo.
 *
 * @param {object} params
 * @param {Array<{ID: unknown, link_slug?: string}>} params.links
 * @param {string} params.slug
 * @param {Iterable<string>} [params.ownIds] IDs de links já gravados neste projeto
 * @returns {{ action: "reuse", link: object } | { action: "create", slug: string }}
 */
export function chooseShortLink({ links, slug, ownIds = [] }) {
  const own = new Set([...ownIds].filter(Boolean).map(String));

  // Link do próprio projeto, achado pelo ID: é ele, mesmo que o slug mude.
  const doProjeto = links.find((link) => own.has(String(link.ID)));
  if (doProjeto) return { action: "reuse", link: doProjeto };

  for (let n = 1; n <= MAX_SLUG_ATTEMPTS; n += 1) {
    const candidato = slugWithSuffix(slug, n);
    if (!links.some((link) => link.link_slug === candidato)) {
      return { action: "create", slug: candidato };
    }
  }

  throw new ShortlinkError(
    `Todos os endereços curtos de "${slug}" já estão em uso por outros links. Dê um apelido diferente ao projeto.`,
    409,
  );
}

const normalizar = (link) => {
  // O slug de volta pode não ser o enviado: o BetterLinks sanitiza e resolve
  // colisão por conta dele. A URL pública usa o caminho que ele gravou.
  const path = shortLinkPath(link);
  return {
    id: link.ID ? String(link.ID) : null,
    slug: link.link_slug ?? path,
    path,
    url: path ? publicUrlFor(path) : null,
    targetUrl: link.target_url ?? null,
  };
};

/**
 * Garante um link curto apontando para `targetUrl`.
 *
 * - link já pertencente ao projeto (`ownIds`): repõe o destino e mantém o slug;
 * - caso contrário, cria um novo — com sufixo se o slug estiver ocupado.
 *
 * Um link de mesmo slug que não é do projeto **nunca** é repontado: ele pode
 * ser o endereço que outro cliente já recebeu.
 */
export async function ensureShortLink({ slug, title, targetUrl, ownIds = [] }) {
  if (!isConfigured()) {
    throw new ShortlinkError(
      "O encurtador não está configurado. Preencha-o em Configurações → Encurtador (BetterLinks).",
      503,
    );
  }
  if (!slug) throw new ShortlinkError("Slug do link curto ausente.", 500);

  const escolha = chooseShortLink({ links: await listarLinks(), slug, ownIds });

  if (escolha.action === "reuse") {
    const existente = escolha.link;
    const atual = normalizar(existente);
    if (atual.targetUrl === targetUrl) return { ...atual, action: "unchanged" };

    /**
     * O payload vai **completo** de propósito, e isso não é redundância.
     *
     * Um `update-link` só com `ID` e `target_url` grava a linha no banco mas
     * não invalida o cache de redirecionamento do BetterLinks: medindo, o
     * link continuou servindo o destino antigo por mais de 6 minutos, com o
     * banco já correto. Com o conjunto inteiro de campos — como o admin do
     * WordPress envia — o novo destino passa a valer na hora.
     *
     * Repontar depender disso é o coração do recurso: o cliente tem um
     * endereço só, e ele precisa apontar para o preview certo agora.
     */
    const atualizado = await updateWithConfirmation(
      (args) => callTool("update-link", args),
      {
        ID: Number(atual.id),
        link_title: title,
        // O caminho exato, e não o slug: com `link_slug` o BetterLinks antepõe
        // o prefixo atual, e um link antigo (sem prefixo) mudaria de endereço
        // — o que o cliente já recebeu passaria a dar 404.
        short_url: atual.path,
        target_url: targetUrl,
        redirect_type: existente.redirect_type ?? "307",
        link_status: "publish",
        // Sem `cat_id`: o link não guarda categoria nesse campo, e mandar um
        // valor virava "sobrescrever (vazio) → 1", que o BetterLinks recusa.
      },
    );
    // O `update-link` devolve um payload enxuto; o slug vem do que já existia.
    return {
      ...normalizar({ ...existente, ...(atualizado ?? {}) }),
      action: "repointed",
    };
  }

  const criado = await callTool("create-link", {
    link_title: title,
    target_url: targetUrl,
    link_slug: escolha.slug,
    // 307 preserva o método e não fica em cache de navegador, então repontar o
    // link tem efeito imediato para quem já abriu antes.
    redirect_type: "307",
    link_status: "publish",
  });

  if (!criado) throw new ShortlinkError("O encurtador não devolveu o link criado.");
  // Relê pelo ID: o caminho gravado (com o prefixo) é o que vai ao cliente, e
  // a resposta do create-link não é garantia de trazê-lo.
  const gravado = criado.ID
    ? await encontrarLink({ id: criado.ID, slug: null })
    : null;
  return { ...normalizar(gravado ?? criado), action: "created" };
}

/**
 * Os campos que repontar pretende mudar. Só eles podem ser confirmados sem
 * perguntar: foi o operador quem pediu, ao colar o preview novo.
 */
export const REPOINT_FIELDS = new Set(["target_url", "link_title"]);

/**
 * Confirma sozinho o que foi pedido — e nada além. Se o BetterLinks quiser
 * sobrescrever outro campo, o painel para e mostra o resumo dele.
 *
 * @param {(args: object) => Promise<any>} call
 * @param {object} args
 * @returns {Promise<any>}
 */
export async function updateWithConfirmation(call, args) {
  try {
    return await call(args);
  } catch (err) {
    if (!(err instanceof ShortlinkConfirmationRequired)) throw err;
    const inesperados = Object.keys(err.details).filter((campo) => !REPOINT_FIELDS.has(campo));
    if (inesperados.length) {
      throw new ShortlinkError(
        `O encurtador também mudaria ${inesperados.join(", ")} — nada foi alterado. ${err.summary}`,
        409,
      );
    }
    return call({ ...args, confirm: true });
  }
}

/** Estado atual do link curto no encurtador, para conferência na tela. */
export async function inspectShortLink({ slug, id }) {
  if (!isConfigured()) return null;
  const link = await encontrarLink({ slug, id });
  return link ? normalizar(link) : null;
}

export { isConfigured, ShortlinkError };
