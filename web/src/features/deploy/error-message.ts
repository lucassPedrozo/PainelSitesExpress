/** A mensagem de um erro de leitura, ou `null` quando não há o que mostrar. */
export const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : null;
