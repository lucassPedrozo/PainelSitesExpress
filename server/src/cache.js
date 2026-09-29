import { config } from "./config.js";

/**
 * Cache em memória com TTL — evita estourar a cota da API do Drive.
 *
 * Guarda a **promise**, e não o valor resolvido. Antes, duas requisições que
 * chegavam com o cache vazio (a lista de projetos e o card abrindo ao mesmo
 * tempo, por exemplo) disparavam cada uma a sua varredura no Drive; agora a
 * segunda espera a mesma chamada da primeira. Falha não fica guardada: a
 * entrada sai e a próxima chamada tenta de novo.
 */

/** @type {Map<string, { promise: Promise<unknown>, expires: number }>} */
const store = new Map();

/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T> | T} loader
 * @param {number} [ttl]
 * @returns {Promise<T>}
 */
export function cached(key, loader, ttl = config.cacheTtlMs) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return /** @type {Promise<T>} */ (hit.promise);

  const entry = {
    promise: Promise.resolve().then(loader),
    // Enquanto carrega, a entrada vale: quem chegar agora espera a mesma
    // promise. O prazo de verdade começa quando o valor chega.
    expires: Number.POSITIVE_INFINITY,
  };
  store.set(key, entry);

  entry.promise.then(
    () => {
      entry.expires = Date.now() + ttl;
    },
    () => {
      // Só remove se ninguém substituiu a entrada enquanto ela carregava.
      if (store.get(key) === entry) store.delete(key);
    },
  );

  return entry.promise;
}

/**
 * Grava um valor já conhecido, sem precisar de loader.
 * @param {string} key
 * @param {unknown} value
 * @param {number} [ttl]
 */
export function remember(key, value, ttl = config.cacheTtlMs) {
  store.set(key, { promise: Promise.resolve(value), expires: Date.now() + ttl });
}

/** @param {string} [prefix] */
export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (!prefix || key.startsWith(prefix)) store.delete(key);
  }
}
