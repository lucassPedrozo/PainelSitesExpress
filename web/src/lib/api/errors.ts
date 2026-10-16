/** Os erros das chamadas à API e o aviso de sessão perdida. */

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
