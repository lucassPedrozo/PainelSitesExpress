/**
 * O domínio de uma coleta, a partir do nome da pasta.
 *
 * As pastas nascem do formulário do cliente como "[dd/mm/aaaa] <o que ele
 * digitou>", e o que ele digita varia: "www.site.com.br", "Https://site.com.br",
 * "*site.com.br*", "- site.com", às vezes um e-mail. API e interface leem
 * daqui: a API para ligar o projeto à publicação do mesmo domínio, a interface
 * para mostrar um nome limpo.
 */

const COLLECTION_NAME = /^\[(\d{2})\/(\d{2})\/(\d{4})\]\s*(.*)$/;

const DOMAIN = /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/i;

/** Enfeites em volta do que o cliente digitou: asteriscos, traços, pontos. */
const NOISE = /^[\s*\-–—•.]+|[\s*\-–—•./]+$/g;

/**
 * O primeiro domínio do texto, em minúsculas e sem `www.`, ou `null`.
 *
 * `exact` diz se o texto era só o domínio (com enfeites): nesse caso o nome
 * limpo pode substituir o original. "a.com.br (principal) e b.com.br" tem
 * domínio, mas não é exato — reescrevê-lo perderia informação.
 *
 * @param {string | null | undefined} text
 * @returns {{ domain: string, exact: boolean } | null}
 */
export function findDomain(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim().replace(NOISE, "");
  // Um e-mail tem cara de domínio depois do @, mas não é o site do cliente.
  if (!cleaned || cleaned.includes("@")) return null;

  const match = cleaned.match(DOMAIN);
  if (!match) return null;

  const domain = match[1].toLowerCase();
  // Precisa de um TLD de letras: "v1.2" não é domínio.
  if (!/\.[a-z]{2,}$/.test(domain)) return null;

  const rest = cleaned.slice(match.index + match[0].length).replace(NOISE, "");
  return { domain, exact: match.index === 0 && rest === "" };
}

/** Só o domínio normalizado, para comparar dois textos. */
export const normalizeDomain = (text) => findDomain(text)?.domain ?? null;

/**
 * Data, domínio e o nome a exibir de uma pasta de coleta.
 *
 * @param {string} rawName
 * @returns {{
 *   label: string,
 *   domain: string | null,
 *   collected: { day: number, month: number, year: number } | null,
 * }}
 */
export function parseCollectionName(rawName) {
  const name = String(rawName ?? "").trim();
  const match = name.match(COLLECTION_NAME);
  if (!match) {
    const found = findDomain(name);
    return {
      label: found?.exact ? found.domain : name,
      domain: found?.domain ?? null,
      collected: null,
    };
  }

  const [, dd, mm, yyyy, rest] = match;
  const typed = rest.trim();
  const found = findDomain(typed);
  const label = found?.exact
    ? found.domain
    : typed.replace(NOISE, "") || name;

  return {
    label,
    domain: found?.domain ?? null,
    collected: { day: Number(dd), month: Number(mm), year: Number(yyyy) },
  };
}
