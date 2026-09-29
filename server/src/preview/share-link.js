/**
 * O link público do Lovable — o que o botão "Share preview" gera.
 *
 * Ele não é o preview do projeto: `id-preview--<id>.lovable.app` exige sessão
 * do Lovable e devolve 401 a qualquer visitante, mesmo com o projeto marcado
 * como `public`. O que abre para o cliente é `lovable.dev/preview/<token>`, que
 * responde 307 para o host de preview carregando um `__lovable_token` — um JWT
 * `access_type: viewer`, válido por 7 dias, reemitido a cada visita.
 *
 * Daí a regra de validade: **a idade do link não diz nada**. Medindo os links
 * em uso, havia link de 32 dias funcionando e de 7 dias morto. O que mata um é
 * ser excluído no Lovable (ou o projeto sair de lá), e isso só se descobre
 * batendo na URL. Por isso a validação aqui é sonda, não aritmética de datas.
 */

const PROBE_TIMEOUT_MS = 15_000;

/** Formato do link de share. O token é opaco, gerado pelo Lovable. */
const SHARE_URL = /^https:\/\/lovable\.dev\/preview\/([A-Za-z0-9_-]{8,128})\/?$/;

export class SharePreviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    // Mensagem escrita para a interface: o tratador de erros pode devolvê-la.
    this.expose = true;
  }
}

/**
 * Normaliza o que foi colado. Aceita sem protocolo e com espaços ou barra
 * sobrando, porque link colado vem sempre um pouco sujo.
 */
export function parseSharePreviewUrl(input) {
  const bruto = String(input ?? "").trim();
  if (!bruto) {
    throw new SharePreviewError("Informe o link de compartilhamento.");
  }

  const comProtocolo = /^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`;
  const semQuery = comProtocolo.split(/[?#]/)[0];
  const normalizado = semQuery.replace(/\/+$/, "").replace(/^http:/i, "https:");

  const casou = SHARE_URL.exec(normalizado);
  if (!casou) {
    throw new SharePreviewError(
      'Use o link do botão "Share preview" do Lovable, no formato https://lovable.dev/preview/<código>.',
    );
  }

  return { url: normalizado, token: casou[1] };
}

/** Estados possíveis de um link de share. */
export const PREVIEW_STATES = ["alive", "dead", "unknown"];

/**
 * Traduz a resposta da sonda. Separado do `fetch` de propósito: é a regra que
 * decide se o link vai ao cliente, e regra que decide isso merece teste.
 */
export function classifyProbe({ status, location }) {
  if (status >= 300 && status < 400) {
    const destino = String(location ?? "");
    // Um share vivo joga para o host de preview. Qualquer outro destino
    // (login, home do Lovable) significa que ele não abre para o cliente.
    // O `[/?#]|$` não é detalhe: o Lovable manda o token em query direto no
    // host, sem barra — `...lovable.app?__lovable_token=...`.
    if (/^https:\/\/[^/?#]*\.lovable\.app([/?#]|$)/i.test(destino)) {
      return { state: "alive", detail: "O link abre o site sem pedir login." };
    }
    return {
      state: "dead",
      detail: `O link redireciona para ${destino || "um destino inesperado"}.`,
    };
  }

  if (status === 404 || status === 410) {
    return {
      state: "dead",
      detail: "O Lovable não reconhece mais este link — ele foi excluído.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      state: "dead",
      detail: "O link exige autenticação e não serve para o cliente.",
    };
  }

  return {
    state: "unknown",
    detail: `Resposta inesperada do Lovable (HTTP ${status}).`,
  };
}

/**
 * Bate na URL sem seguir o redirecionamento: é justamente o 307 e o seu
 * destino que dizem se o link está vivo. Seguir a cadeia daria 401 no fim,
 * porque só um cliente com cookies completa o salto do token.
 */
export async function probeSharePreview(url) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        // Sem User-Agent de navegador o Cloudflare do Lovable pode barrar.
        "User-Agent":
          "Mozilla/5.0 (compatible; PainelSitesExpress/1.0; +verificacao-de-preview)",
        Accept: "text/html",
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "TimeoutError"
        ? "O Lovable não respondeu dentro do tempo limite."
        : "Não foi possível alcançar o Lovable para verificar o link.";
    return { state: "unknown", detail, checkedAt: new Date().toISOString() };
  }

  const { state, detail } = classifyProbe({
    status: response.status,
    location: response.headers.get("location"),
  });

  return { state, detail, checkedAt: new Date().toISOString() };
}

/**
 * O link curto, conferido pelo que ele faz: tem de redirecionar para a prévia
 * gravada. Antes o painel só sondava a prévia, e um link curto que respondia
 * 404 (o prefixo do BetterLinks) ou apontava para outra prévia passava como
 * aberto — e era ele que ia ao cliente.
 *
 * @param {{ status: number, location: string | null, targetUrl: string }} params
 * @returns {{ ok: boolean | null, detail: string }} `null`: não deu para dizer
 */
export function classifyShortLinkProbe({ status, location, targetUrl }) {
  if (status >= 300 && status < 400) {
    if (String(location ?? "") === targetUrl) return { ok: true, detail: "" };
    return {
      ok: false,
      detail: `O link curto redireciona para ${location || "um destino vazio"}, não para a prévia registrada.`,
    };
  }
  if (status === 404 || status === 410) {
    return { ok: false, detail: "O link curto não existe no encurtador (404)." };
  }
  return { ok: null, detail: `Resposta inesperada do encurtador (HTTP ${status}).` };
}

/** Bate no link curto sem seguir o redirecionamento. */
export async function probeShortLink(url, targetUrl) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "text/html" },
    });
    await response.body?.cancel().catch(() => undefined);
    return classifyShortLinkProbe({
      status: response.status,
      location: response.headers.get("location"),
      targetUrl,
    });
  } catch {
    return { ok: null, detail: "Não foi possível alcançar o encurtador." };
  }
}
