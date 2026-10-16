import { config } from "../config.js";
import { httpError } from "../http.js";
import { STOCK_ZIP_NAME, stockImageName, stockZipPath } from "../../../shared/stock-images.js";
import { createZip } from "../archive/zip-writer.js";

/**
 * Imagens de banco do Pixabay para completar o material do cliente.
 *
 * O fluxo é o do script de busca da equipe (`termo:quantidade`, um grupo por
 * seção do site), com duas diferenças: a busca devolve candidatas para a
 * pessoa escolher na tela de geração, e as fotos escolhidas não vão para o
 * disco — são baixadas no momento da geração e sobem ao Lovable num `.zip`
 * só, com uma pasta por grupo. O teto de anexos do Lovable é por arquivo; o
 * zip conta como um.
 *
 * A chave (`PIXABAY_API_KEY`) fica só aqui. O navegador recebe o id de cada
 * foto e a miniatura passa pelo painel (`thumbnail`), como as do Drive: as
 * URLs do Pixabay ficam fora da CSP e expiram. Na geração o painel busca a
 * foto de novo pelo id, em vez de baixar uma URL que veio do navegador.
 *
 * Licença Pixabay: uso comercial livre, sem exigência de atribuição. Os termos
 * da API pedem cache das respostas por 24 h e no máximo 100 buscas por minuto.
 */

const API_URL = "https://pixabay.com/api/";
/** Só destes hosts o painel baixa — a URL da foto vem da resposta da API. */
const IMAGE_HOSTS = new Set(["pixabay.com", "cdn.pixabay.com"]);
const CACHE_TTL_MS = 24 * 60 * 60_000;
const API_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Miniatura de 640 px: dezenas de KB. O teto só barra resposta absurda. */
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
/** Downloads simultâneos ao montar o zip — rápido sem martelar o CDN. */
const DOWNLOAD_CONCURRENCY = 4;

/** Tetos de uma busca: o bastante para um site institucional inteiro. */
const STOCK_LIMITS = {
  maxTerms: 8,
  maxQuantity: 10,
  defaultQuantity: 5,
  maxTermChars: 100,
  maxSectionChars: 40,
  /** Fotos por envio. Num zip não há teto do Lovable; este é do tamanho (~400 KB cada). */
  maxImages: 80,
};

/** A chave lida a cada uso: a tela de Configurações pode gravá-la com o painel de pé. */
export const pixabayKey = () => (process.env.PIXABAY_API_KEY ?? "").trim();

export const isPixabayConfigured = () => Boolean(pixabayKey());

const NOT_CONFIGURED =
  "A chave do Pixabay não está configurada. Preencha-a em Configurações → Geração de sites (PIXABAY_API_KEY).";

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

const texto = (value, max) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Os termos de uma busca. Aceita o formato do script (`"hero:3"`) e o da tela
 * (`{ term, quantity, section }`); a quantidade padrão é 5.
 *
 * @param {unknown} raw
 * @returns {Array<{ term: string, quantity: number, section: string | null }>}
 */
export function parseTerms(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw httpError(400, "Informe ao menos um termo de busca.");
  }
  if (raw.length > STOCK_LIMITS.maxTerms) {
    throw httpError(400, `Busque no máximo ${STOCK_LIMITS.maxTerms} termos de uma vez.`);
  }

  return raw.map((item) => {
    let term = "";
    let quantity;
    let section = "";
    if (typeof item === "string") {
      const [termo, qtd] = item.split(":");
      term = texto(termo, STOCK_LIMITS.maxTermChars);
      quantity = qtd;
    } else if (item && typeof item === "object") {
      term = texto(item.term, STOCK_LIMITS.maxTermChars);
      quantity = item.quantity;
      section = texto(item.section, STOCK_LIMITS.maxSectionChars);
    }
    if (!term) throw httpError(400, "Há um termo de busca vazio.");

    const numero = Math.trunc(Number(quantity));
    return {
      term,
      quantity:
        Number.isFinite(numero) && numero > 0
          ? Math.min(numero, STOCK_LIMITS.maxQuantity)
          : STOCK_LIMITS.defaultQuantity,
      section: section || null,
    };
  });
}

/**
 * As fotos de banco escolhidas para uma geração, como chegam do navegador.
 * Só id e grupo: o resto o painel busca de novo no Pixabay.
 *
 * @param {unknown} raw
 * @returns {Array<{ id: number, term: string, section: string | null }>}
 */
export function parseStockSelection(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw httpError(400, "Lista de imagens de banco inválida.");

  const vistos = new Set();
  const escolhidas = [];
  for (const item of raw) {
    const id = Number(item?.id);
    const term = texto(item?.term, STOCK_LIMITS.maxTermChars);
    if (!Number.isSafeInteger(id) || id <= 0 || !term) {
      throw httpError(400, "Imagem de banco inválida na seleção.");
    }
    if (vistos.has(id)) continue;
    vistos.add(id);
    escolhidas.push({ id, term, section: texto(item?.section, STOCK_LIMITS.maxSectionChars) || null });
  }
  if (escolhidas.length > STOCK_LIMITS.maxImages) {
    throw httpError(400, `Marque no máximo ${STOCK_LIMITS.maxImages} imagens de banco por envio.`);
  }
  return escolhidas;
}

/**
 * O que o navegador recebe de cada foto: nenhuma URL de imagem do Pixabay. A
 * miniatura vem de `/api/images/:id/thumbnail`.
 */
const toCandidate = (hit) => ({
  id: hit.id,
  width: hit.imageWidth ?? null,
  height: hit.imageHeight ?? null,
  tags: hit.tags ?? "",
  user: hit.user ?? "",
  pageUrl: hit.pageURL ?? null,
});

/**
 * Cliente do Pixabay com as dependências explícitas: os testes trocam o
 * `fetch` e a chave sem tocar na rede.
 *
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => string} [deps.apiKey]
 * @param {() => number} [deps.now]
 */
export function createPixabayClient({
  fetchImpl = (...args) => fetch(...args),
  apiKey = pixabayKey,
  now = () => Date.now(),
} = {}) {
  /** @type {Map<string, { value: any, expires: number }>} */
  const cache = new Map();
  /** Toda foto vista numa busca, por id: a geração quase sempre acha aqui. */
  /** @type {Map<number, { hit: any, expires: number }>} */
  const porId = new Map();

  const lembrar = (hits) => {
    for (const hit of hits) porId.set(hit.id, { hit, expires: now() + CACHE_TTL_MS });
  };

  /** Chamada à API. A URL leva a chave: nunca entra em mensagem nem em log. */
  async function api(params) {
    const key = apiKey();
    if (!key) throw httpError(409, NOT_CONFIGURED);

    const url = new URL(API_URL);
    url.searchParams.set("key", key);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));

    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch (err) {
      throw httpError(
        504,
        err?.name === "TimeoutError"
          ? "O Pixabay não respondeu a tempo. Tente de novo."
          : "Não foi possível falar com o Pixabay.",
      );
    }

    if (res.status === 429) {
      throw httpError(429, "O Pixabay limitou as buscas (100 por minuto). Espere um pouco e tente de novo.");
    }
    if (!res.ok) {
      // O Pixabay responde erro em texto ("[ERROR 400] Invalid or missing API
      // key"). Só o motivo vai adiante — a URL, com a chave, não.
      const detalhe = (await res.text().catch(() => "")).replace(/^\[ERROR \d+\]\s*/i, "").slice(0, 160);
      if (/api key/i.test(detalhe)) {
        throw httpError(502, "O Pixabay recusou a chave configurada. Confira PIXABAY_API_KEY em Configurações.");
      }
      throw httpError(502, `O Pixabay recusou a busca (${res.status})${detalhe ? `: ${detalhe}` : ""}.`);
    }

    const data = /** @type {any} */ (await res.json().catch(() => null));
    if (!Array.isArray(data?.hits)) throw httpError(502, "Resposta inesperada do Pixabay.");
    return data.hits;
  }

  /**
   * Candidatas de um termo. Vêm mais fotos que a quantidade pedida, para a
   * pessoa poder trocar alguma; as primeiras `quantity` são as sugeridas.
   *
   * @param {{ term: string, quantity: number }} item
   */
  async function search({ term, quantity }) {
    // A API exige ao menos 3 por página.
    const perPage = Math.min(Math.max(quantity * 2, 6), 30);
    const chave = `${term.toLowerCase()}|${perPage}`;
    const salvo = cache.get(chave);
    let hits;
    if (salvo && salvo.expires > now()) {
      hits = salvo.value;
    } else {
      hits = await api({
        q: term,
        per_page: Math.max(perPage, 3),
        image_type: "photo",
        orientation: "horizontal",
        lang: "pt",
        safesearch: "true",
      });
      cache.set(chave, { value: hits, expires: now() + CACHE_TTL_MS });
    }
    lembrar(hits);
    return hits;
  }

  /** @param {number} id */
  async function byId(id) {
    const salvo = porId.get(id);
    if (salvo && salvo.expires > now()) return salvo.hit;
    const hits = await api({ id });
    const hit = hits.find((item) => item.id === id);
    if (!hit) throw httpError(404, `A imagem ${id} não existe mais no Pixabay. Busque de novo.`);
    lembrar([hit]);
    return hit;
  }

  /**
   * Os bytes de uma imagem do Pixabay. A URL vem da resposta da API e ainda
   * assim é conferida: só https, só hosts do Pixabay.
   *
   * @param {unknown} endereco
   * @param {string} label
   * @param {number} limite
   */
  async function fetchImage(endereco, label, limite) {
    let url;
    try {
      url = new URL(String(endereco));
    } catch {
      throw httpError(502, `O Pixabay não informou o arquivo de ${label}.`);
    }
    if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname)) {
      throw httpError(502, `Endereço inesperado para ${label}.`);
    }

    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch {
      throw httpError(504, `Não foi possível baixar ${label} do Pixabay.`);
    }
    if (!res.ok) throw httpError(502, `Download de ${label} falhou (${res.status}).`);

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim() || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw httpError(502, `O Pixabay não devolveu uma imagem para ${label}.`);
    }

    const declarado = Number(res.headers.get("content-length"));
    if (declarado > limite) {
      throw httpError(413, `${label} passa de ${formatBytes(limite)}.`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > limite) throw httpError(413, `${label} passa de ${formatBytes(limite)}.`);
    return { bytes, contentType };
  }

  /**
   * Baixa as fotos em tamanho grande, poucas de cada vez. Cada uma sai com o
   * caminho que tem dentro do zip (`<grupo>/pixabay-<grupo>-<id>.jpg`).
   *
   * @param {Array<{ id: number, term: string, section: string | null, name: string, hit: any }>} images
   * @returns {Promise<Array<{ path: string, bytes: Buffer }>>}
   */
  async function download(images) {
    const baixadas = new Array(images.length);
    let proxima = 0;
    const worker = async () => {
      while (proxima < images.length) {
        const indice = proxima++;
        const image = images[indice];
        const { bytes } = await fetchImage(
          image.hit.largeImageURL,
          `“${image.name}”`,
          config.lovable.maxAttachmentBytes,
        );
        baixadas[indice] = { path: stockZipPath(image), bytes };
      }
    };
    await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, images.length) }, worker));
    return baixadas;
  }

  return {
    /**
     * As fotos escolhidas, baixadas — para o motor que as quer como arquivos
     * soltos, e não num zip.
     */
    download,

    /**
     * Busca cada termo, um depois do outro (a API limita a 100 por minuto).
     * @param {ReturnType<typeof parseTerms>} terms
     */
    async searchTerms(terms) {
      const results = [];
      for (const item of terms) {
        const hits = await search(item);
        results.push({ ...item, images: hits.map(toCandidate) });
      }
      return results;
    },

    /**
     * Confere a seleção antes de gastar: cada id precisa existir no Pixabay.
     * Devolve o que será anexado, com o nome que o prompt cita.
     *
     * @param {ReturnType<typeof parseStockSelection>} selection
     */
    async resolve(selection) {
      const resolvidas = [];
      for (const image of selection) {
        const hit = await byId(image.id);
        resolvidas.push({
          ...image,
          name: stockImageName(image),
          path: stockZipPath(image),
          pageUrl: hit.pageURL ?? null,
          user: hit.user ?? "",
          hit,
        });
      }
      return resolvidas;
    },

    /**
     * Miniatura para a grade da tela de geração (640 px). Só de foto que o
     * Pixabay devolve para este id: o painel não vira proxy de URL qualquer.
     *
     * @param {number} id
     */
    async thumbnail(id) {
      const hit = await byId(id);
      return fetchImage(hit.webformatURL || hit.previewURL, "a miniatura", THUMBNAIL_MAX_BYTES);
    },

    /**
     * O anexo único com todas as fotos: `imagens-pixabay.zip`, uma pasta por
     * grupo. Uma falha em qualquer foto derruba o zip inteiro — melhor do que
     * o prompt citar um arquivo que não foi.
     *
     * @param {Array<{ id: number, term: string, section: string | null, name: string, hit: any }>} images
     */
    async buildZip(images) {
      const baixadas = await download(images);

      const bytes = createZip(baixadas);
      const limite = config.lovable.maxAttachmentBytes;
      if (bytes.length > limite) {
        throw httpError(
          413,
          `O zip das imagens de banco ficou com ${formatBytes(bytes.length)}, acima do limite de ${formatBytes(limite)} por anexo. Desmarque algumas fotos.`,
        );
      }
      return { name: STOCK_ZIP_NAME, contentType: "application/zip", bytes, count: images.length };
    },
  };
}

/** O cliente de produção: um cache por processo, para todas as gerações. */
export const pixabay = createPixabayClient();

export const pixabayStatus = () => ({
  configured: isPixabayConfigured(),
  limits: STOCK_LIMITS,
});
