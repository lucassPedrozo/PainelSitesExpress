const ALLOWED = { allowed: true, retryAfterSeconds: 0 };

/** Descarta entradas ociosas para os mapas não crescerem indefinidamente. */
const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Bloqueio progressivo por origem para tentativas de autenticação.
 * A comparação da chave já é feita em tempo constante; isto evita que alguém
 * na LAN tente adivinhá-la por força bruta.
 */
export class AuthThrottle {
  #entries = new Map();
  #maxFailures;
  #windowMs;
  #baseBlockMs;
  #maxBlockMs;
  #now;

  constructor(options = {}) {
    this.#maxFailures = options.maxFailures ?? 5;
    this.#windowMs = options.windowMs ?? 5 * 60_000;
    this.#baseBlockMs = options.baseBlockMs ?? 15_000;
    this.#maxBlockMs = options.maxBlockMs ?? 10 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  check(key) {
    const entry = this.#entries.get(key);
    if (!entry) return ALLOWED;

    const now = this.#now();

    if (entry.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
      };
    }

    if (now - entry.firstFailureAt > this.#windowMs) {
      this.#entries.delete(key);
    }

    return ALLOWED;
  }

  registerFailure(key) {
    const now = this.#now();
    const current = this.#entries.get(key);
    const entry =
      current && now - current.firstFailureAt <= this.#windowMs
        ? current
        : { failures: 0, firstFailureAt: now, blockedUntil: 0 };

    entry.failures += 1;

    if (entry.failures >= this.#maxFailures) {
      const exponent = entry.failures - this.#maxFailures;
      const blockMs = Math.min(
        this.#baseBlockMs * 2 ** exponent,
        this.#maxBlockMs,
      );
      entry.blockedUntil = now + blockMs;
    }

    this.#entries.set(key, entry);
    return this.check(key);
  }

  reset(key) {
    this.#entries.delete(key);
  }

  prune() {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (
        entry.blockedUntil <= now &&
        now - entry.firstFailureAt > this.#windowMs
      ) {
        this.#entries.delete(key);
      }
    }
  }
}

/** Janela deslizante simples para proteger as rotas que alteram repositórios. */
export class RateLimiter {
  #hits = new Map();
  #limit;
  #windowMs;
  #now;

  constructor(options) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
  }

  consume(key) {
    const now = this.#now();
    const recent = (this.#hits.get(key) ?? []).filter(
      (time) => now - time < this.#windowMs,
    );

    if (recent.length >= this.#limit) {
      const retryAfterSeconds = Math.ceil(
        (this.#windowMs - (now - recent[0])) / 1000,
      );
      this.#hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(retryAfterSeconds, 1),
      };
    }

    recent.push(now);
    this.#hits.set(key, recent);
    return ALLOWED;
  }

  prune() {
    const now = this.#now();
    for (const [key, times] of this.#hits) {
      const recent = times.filter((time) => now - time < this.#windowMs);
      if (recent.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, recent);
    }
  }
}

/**
 * O painel fica ligado o dia inteiro; sem esta limpeza os mapas guardariam uma
 * entrada por IP visto, para sempre. `unref` evita segurar o processo aberto.
 */
export const scheduleThrottlePruning = (...throttles) => {
  const timer = setInterval(() => {
    for (const throttle of throttles) throttle.prune();
  }, PRUNE_INTERVAL_MS);
  timer.unref?.();
  return timer;
};
