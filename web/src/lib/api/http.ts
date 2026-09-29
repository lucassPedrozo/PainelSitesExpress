import { ApiError, reportUnauthorized } from "@/lib/access-token";

/**
 * O cliente HTTP da interface. A autenticação vai no cookie de sessão, que o
 * navegador envia sozinho.
 */

export type RequestOptions = RequestInit & {
  /**
   * Sem valor, a requisição espera o quanto for preciso: a geração sobe
   * anexos grandes ao Lovable e não pode ser cortada no meio.
   */
  timeoutMs?: number;
};

export async function request<T>(
  url: string,
  { timeoutMs, ...init }: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal:
        init.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(504, "A API local não respondeu dentro do tempo limite.");
    }
    throw new ApiError(
      0,
      "Não foi possível falar com a API local. Verifique se o servidor está ativo.",
    );
  }

  // 204 e corpos vazios chegam como `null`.
  const body = (await res.json().catch(() => null)) as { error?: string } | null;

  if (!res.ok) {
    const message = body?.error ?? `Falha na requisição (${res.status})`;
    // A sessão pode ter vencido, ou a chave ter sido revogada ou trocada
    // enquanto a aba estava aberta; quem cuida da tela pede a chave de novo.
    if (res.status === 401) reportUnauthorized(message);
    throw new ApiError(res.status, message);
  }

  return body as T;
}

export const get = <T,>(url: string) => request<T>(url);

export const send = <T,>(method: string, url: string, body?: unknown) =>
  request<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
