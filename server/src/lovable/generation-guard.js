/**
 * Trava contra gasto duplicado de crédito na geração.
 *
 * As travas que já existiam (confirmação explícita, `LOVABLE_ENABLE_GENERATION`
 * e o diálogo) impedem a geração *acidental*, mas não a *repetida*: duas abas,
 * duas pessoas ou um segundo clique durante uma chamada lenta disparavam dois
 * `create_project` para a mesma coleta — dois sites, dois débitos.
 *
 * Duas regras, ambas por projeto:
 *
 * - **Em andamento:** enquanto uma geração roda, outra do mesmo projeto é
 *   recusada.
 * - **Resultado incerto:** se o `create_project` fica sem resposta (timeout,
 *   rede, erro 5xx), o site pode ter sido criado do outro lado. Liberar nova
 *   tentativa na hora é convidar exatamente o clique que duplica. O projeto
 *   fica bloqueado por um tempo, com a instrução de conferir no Lovable.
 *
 * O estado vive na memória: reiniciar a API libera tudo, o que serve de saída
 * para quem já conferiu e precisa gerar de novo antes do prazo.
 */

export const UNCERTAIN_HOLD_MS = 10 * 60_000;

export class GenerationBlockedError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
    this.expose = true;
  }
}

export class GenerationGuard {
  #running = new Set();
  #uncertainUntil = new Map();
  #holdMs;
  #now;

  constructor({ holdMs = UNCERTAIN_HOLD_MS, now = Date.now } = {}) {
    this.#holdMs = holdMs;
    this.#now = now;
  }

  /** Reserva o projeto. Devolve a função que libera a reserva. */
  acquire(projectId) {
    if (this.#running.has(projectId)) {
      throw new GenerationBlockedError(
        "Já existe uma geração em andamento para este projeto. Aguarde ela terminar antes de gerar de novo.",
      );
    }

    const until = this.#uncertainUntil.get(projectId);
    if (until !== undefined) {
      const remaining = until - this.#now();
      if (remaining > 0) {
        const minutes = Math.max(1, Math.ceil(remaining / 60_000));
        throw new GenerationBlockedError(
          "A última tentativa de gerar este projeto ficou sem resposta do Lovable e pode ter criado o site mesmo assim. " +
            `Confira a lista de projetos no Lovable antes de tentar de novo. Nova geração liberada em ${minutes} min.`,
        );
      }
      this.#uncertainUntil.delete(projectId);
    }

    this.#running.add(projectId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#running.delete(projectId);
    };
  }

  /** Registra que a última chamada pode ter criado o site sem confirmar. */
  markUncertain(projectId) {
    this.#uncertainUntil.set(projectId, this.#now() + this.#holdMs);
  }

  get holdMinutes() {
    return Math.round(this.#holdMs / 60_000);
  }
}
