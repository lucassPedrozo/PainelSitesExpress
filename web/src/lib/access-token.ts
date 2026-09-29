/**
 * Autenticação da interface.
 *
 * A chave de acesso **não fica guardada no navegador**. Ela é digitada uma vez,
 * vai no `POST /api/session` e é trocada por um cookie `httpOnly` — que o
 * JavaScript da página não lê. Antes a chave morava no `sessionStorage` e ia em
 * toda requisição, então qualquer script injetado na página a levaria inteira.
 * A API guarda as sessões em disco (só o hash), e por isso reiniciá-la não
 * obriga mais a informar a chave de novo.
 */
const LEGACY_ACCESS_TOKEN_KEY = "sites-express-access-token";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Versões anteriores guardavam a chave aqui; ela some na primeira carga. */
export const forgetStoredAccessToken = () => {
  try {
    sessionStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  } catch {
    // Armazenamento bloqueado: não havia o que apagar.
  }
};

/** Uma resposta 401 significa sessão encerrada, vencida ou chave revogada. */
type UnauthorizedListener = (message: string) => void;

const listeners = new Set<UnauthorizedListener>();

export const onUnauthorized = (listener: UnauthorizedListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const reportUnauthorized = (message: string) => {
  for (const listener of listeners) listener(message);
};
