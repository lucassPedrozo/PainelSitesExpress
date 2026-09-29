import { randomUUID } from "node:crypto";
import {
  generateAccessKey,
  hashAccessKey,
  newSalt,
  sameHash,
} from "../security/access.js";
import {
  permissionsOf,
  sanitizePermissions,
} from "../security/permissions.js";
import { httpError } from "../http.js";
import { flush, normalize, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Acessos ao painel
 *
 * Uma chave por pessoa, guardada em hash. A do `.env` continua valendo como
 * chave do administrador — sem ela, migrar trancaria o operador fora.
 * ------------------------------------------------------------------ */

/** Valida a lista vinda da API, traduzindo a recusa em erro HTTP. */
const readPermissions = (raw) => {
  const { permissions, error } = sanitizePermissions(raw);
  if (error) throw httpError(400, error);
  return permissions;
};

/** Sem a chave em claro: ela existe uma única vez, na resposta da criação. */
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  createdAt: user.createdAt,
  lastSeenAt: user.lastSeenAt ?? null,
  permissions: permissionsOf(user),
});

export async function listAccessUsers() {
  const { accessUsers } = await read();
  return accessUsers.map(publicUser);
}

export async function createAccessUser(rawName, rawPermissions = []) {
  const name = String(rawName ?? "").trim();
  if (!name) throw httpError(400, "Informe o nome de quem vai usar a chave.");
  if (name.length > 60) throw httpError(400, "O nome excede 60 caracteres.");
  const permissions = readPermissions(rawPermissions);

  const data = await read();
  if (data.accessUsers.some((user) => normalize(user.name) === normalize(name))) {
    throw httpError(409, `Já existe uma chave para "${name}".`);
  }

  const key = generateAccessKey();
  const salt = newSalt();
  const user = {
    id: randomUUID(),
    name,
    salt,
    keyHash: hashAccessKey(key, salt),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
    // Sempre gravado, mesmo vazio: é o que distingue "não concedi nada" de
    // uma chave antiga, anterior às permissões, que vale como "pode tudo".
    permissions,
  };

  data.accessUsers.push(user);
  await flush();

  // A chave só existe aqui. Perdida, o caminho é revogar e criar outra.
  return { user: publicUser(user), key };
}

/** Troca o que uma chave pode fazer, sem invalidá-la nem recriá-la. */
export async function setAccessUserPermissions(id, rawPermissions) {
  const permissions = readPermissions(rawPermissions);
  const data = await read();
  const user = data.accessUsers.find((item) => item.id === id);
  if (!user) throw httpError(404, "Chave de acesso não encontrada.");

  user.permissions = permissions;
  await flush();
  return publicUser(user);
}

export async function revokeAccessUser(id) {
  const data = await read();
  const antes = data.accessUsers.length;
  data.accessUsers = data.accessUsers.filter((user) => user.id !== id);
  if (data.accessUsers.length === antes) {
    throw httpError(404, "Chave de acesso não encontrada.");
  }
  await flush();
}

/** Encontra a pessoa por trás de uma chave apresentada. */
export async function findAccessUserByKey(key) {
  if (!key) return null;
  const { accessUsers } = await read();

  for (const user of accessUsers) {
    if (sameHash(user.keyHash, hashAccessKey(key, user.salt))) {
      return publicUser(user);
    }
  }
  return null;
}

export async function findAccessUserById(id) {
  const { accessUsers } = await read();
  const user = accessUsers.find((item) => item.id === id);
  return user ? publicUser(user) : null;
}

/**
 * Registra que a pessoa esteve no painel. Gravado no máximo uma vez por hora:
 * uma escrita por requisição encheria o disco de I/O sem informação nova.
 */
export async function touchAccessUser(id) {
  const data = await read();
  const user = data.accessUsers.find((item) => item.id === id);
  if (!user) return;

  const agora = Date.now();
  const anterior = user.lastSeenAt ? Date.parse(user.lastSeenAt) : 0;
  if (agora - anterior < 60 * 60_000) return;

  user.lastSeenAt = new Date(agora).toISOString();
  await flush();
}
