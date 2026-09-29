import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createSerialQueue, writeFileAtomic } from "../atomic-write.js";

/**
 * Chaves de acesso por pessoa.
 *
 * Antes havia uma chave só, no `.env`, igual para todos: quem saía da equipe
 * obrigava a trocar a de todo mundo, e o painel não tinha como saber quem
 * estava usando. Agora cada pessoa tem a sua, revogável isoladamente.
 *
 * A chave é **guardada em hash**, nunca em claro. São 32 bytes aleatórios —
 * entropia suficiente para dispensar KDF lento, o que importa porque a
 * verificação roda em toda requisição. O `.env` continua valendo como chave do
 * administrador, para ninguém se trancar fora ao migrar.
 */

const KEY_BYTES = 32;

/** Chave nova, mostrada uma única vez a quem a criou. */
export const generateAccessKey = () => randomBytes(KEY_BYTES).toString("base64url");

export const newSalt = () => randomBytes(16).toString("hex");

export const hashAccessKey = (key, salt) =>
  createHash("sha256").update(`${salt}:${key}`).digest("hex");

/** Comparação de tempo constante — os dois lados são hex de tamanho fixo. */
export const sameHash = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/**
 * Sessões.
 *
 * Antes viviam só na memória, e a interface compensava guardando a **chave**
 * no `sessionStorage` para reabrir a sessão depois de cada reinício da API —
 * ou seja, a chave ficava ao alcance de qualquer script da página. Agora a
 * sessão sobrevive ao reinício e o navegador não precisa guardar a chave.
 *
 * Em disco vai só o **hash** do id de sessão: quem ler o arquivo não obtém um
 * cookie utilizável. Sem `configureSessionPersistence` (os testes, por
 * exemplo), tudo continua só na memória.
 */
const sessions = new Map();

/** Uma sessão parada por mais de 12 h deixa de valer. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Nem uma sessão usada todo dia vale para sempre. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Atualizar o "visto por último" a cada requisição regravaria o arquivo o
 * tempo todo; com ociosidade de 12 h, precisão de 5 min basta.
 */
const PERSIST_SEEN_EVERY_MS = 5 * 60_000;

const hashSessionId = (id) => createHash("sha256").update(id).digest("hex");

/**
 * Impressão digital de uma credencial, para amarrar a sessão a ela. A chave
 * mestra do `.env` não tem cadastro que se revogue: se ela for trocada, é esta
 * marca que faz as sessões abertas com a antiga deixarem de valer — inclusive
 * quando a troca é feita à mão no arquivo.
 */
export const credentialFingerprint = (secret) =>
  secret
    ? createHash("sha256").update(`painel-sessao:${secret}`).digest("hex")
    : null;

let persistence = null;

const isExpired = (session, now) =>
  now - session.seenAt > SESSION_TTL_MS ||
  now - session.createdAt > SESSION_MAX_AGE_MS;

const snapshot = () =>
  JSON.stringify(
    {
      version: 1,
      sessions: Object.fromEntries(
        [...sessions].map(([hash, { userId, credential, createdAt, seenAt }]) => [
          hash,
          { userId, credential, createdAt, seenAt },
        ]),
      ),
    },
    null,
    2,
  );

/** Grava o estado atual. Falhar aqui não derruba a requisição: vai para o log. */
const persist = () => {
  if (!persistence) return Promise.resolve();
  const content = snapshot();
  return persistence
    .enqueue(async () => {
      await mkdir(path.dirname(persistence.file), { recursive: true });
      await writeFileAtomic(persistence.file, content, {
        encoding: "utf8",
        mode: 0o600,
      });
    })
    .catch((err) => {
      console.error(`[sessões] não foi possível gravar: ${err.message}`);
    });
};

/**
 * Liga a persistência e carrega as sessões gravadas. Síncrono de propósito:
 * roda uma vez, na subida, e mantém `readSession` síncrono.
 */
export const configureSessionPersistence = ({ file }) => {
  persistence = { file, enqueue: createSerialQueue() };
  sessions.clear();

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    // Primeira execução, ou arquivo ilegível: começar sem sessões só obriga
    // a informar a chave de novo — nada se perde.
    if (err.code !== "ENOENT") {
      console.error(`[sessões] ${file} ilegível, sessões descartadas: ${err.message}`);
    }
    return 0;
  }

  const now = Date.now();
  for (const [hash, session] of Object.entries(parsed?.sessions ?? {})) {
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      typeof session?.userId !== "string" ||
      !Number.isFinite(session.createdAt) ||
      !Number.isFinite(session.seenAt) ||
      isExpired(session, now)
    ) {
      continue;
    }
    sessions.set(hash, {
      userId: session.userId,
      credential: typeof session.credential === "string" ? session.credential : null,
      createdAt: session.createdAt,
      seenAt: session.seenAt,
      persistedSeenAt: session.seenAt,
    });
  }
  return sessions.size;
};

/** Sessões vencidas saem a cada criação, para o arquivo não crescer à toa. */
const pruneExpiredSessions = (now) => {
  for (const [hash, session] of sessions) {
    if (isExpired(session, now)) sessions.delete(hash);
  }
};

/**
 * Cria uma sessão e devolve o id que vai no cookie — ele não é guardado em
 * lugar nenhum, só o hash.
 */
export const createSession = (userId, { credential = null } = {}) => {
  const now = Date.now();
  pruneExpiredSessions(now);
  const id = randomBytes(24).toString("base64url");
  sessions.set(hashSessionId(id), {
    userId,
    credential,
    createdAt: now,
    seenAt: now,
    persistedSeenAt: now,
  });
  void persist();
  return id;
};

export const readSession = (id) => {
  if (!id || typeof id !== "string") return null;
  const hash = hashSessionId(id);
  const session = sessions.get(hash);
  if (!session) return null;

  const now = Date.now();
  if (isExpired(session, now)) {
    sessions.delete(hash);
    void persist();
    return null;
  }

  session.seenAt = now;
  if (now - session.persistedSeenAt > PERSIST_SEEN_EVERY_MS) {
    session.persistedSeenAt = now;
    void persist();
  }
  return session;
};

/** Encerrar é gravado na hora: uma sessão encerrada não pode voltar no reinício. */
export const dropSession = (id) => {
  if (!id || typeof id !== "string") return;
  if (sessions.delete(hashSessionId(id))) void persist();
};

/** Revogar uma chave tem de cortar as sessões abertas com ela na hora. */
export const dropSessionsOfUser = (userId) => {
  let removidas = 0;
  for (const [hash, session] of sessions) {
    if (session.userId === userId) {
      sessions.delete(hash);
      removidas += 1;
    }
  }
  if (removidas) void persist();
  return removidas;
};

export const countSessions = () => sessions.size;

/** Só para teste: zera o estado e desliga a persistência entre casos. */
export const resetSessions = () => {
  sessions.clear();
  persistence = null;
};

/** Só para teste: espera as gravações pendentes. */
export const flushSessions = () => persist();
