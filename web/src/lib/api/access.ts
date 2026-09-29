import type { AccessPermission } from "@shared/access-permissions.js";
import { get, request, send } from "./http";

export type PanelUser = { name: string; kind: "admin" | "user" };

/**
 * O que uma chave pode fazer. A lista é a mesma que a API aplica: as duas
 * importam de `shared/access-permissions.js`.
 */
export {
  ACCESS_PERMISSIONS,
  type AccessPermission,
} from "@shared/access-permissions.js";

export type AccessUser = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  permissions: AccessPermission[];
};

export const fetchMe = () =>
  get<{
    user: PanelUser;
    canManageAccess: boolean;
    permissions: AccessPermission[];
  }>("/api/me");

export const fetchAccessKeys = () =>
  get<{ users: AccessUser[] }>("/api/access-keys");

/** A chave em claro volta **uma única vez**, nesta resposta. */
export const createAccessKey = (
  name: string,
  permissions: AccessPermission[],
) =>
  send<{ user: AccessUser; key: string }>("POST", "/api/access-keys", {
    name,
    permissions,
  });

/** Muda o que a chave pode sem invalidá-la: ninguém precisa receber outra. */
export const setAccessKeyPermissions = (
  id: string,
  permissions: AccessPermission[],
) =>
  send<{ user: AccessUser }>("PUT", `/api/access-keys/${id}/permissions`, {
    permissions,
  });

export const revokeAccessKey = (id: string) =>
  send<{ revoked: true; sessionsClosed: number }>(
    "DELETE",
    `/api/access-keys/${id}`,
  );

export const logoutPanel = () => send<void>("POST", "/api/session/logout");

/**
 * Se o painel pede chave. É a única rota pública além do retorno do OAuth —
 * de propósito: antes a tela de entrada lia `/api/deploy/status`, que entregava
 * organização, host de FTP e pasta do Drive a quem nem tinha a chave.
 */
export const fetchGate = () =>
  get<{ authenticationRequired: boolean; authenticated: boolean }>("/api/gate");

/**
 * Troca a chave por um cookie de sessão. É o único momento em que a chave
 * trafega: ela não é guardada, e dali em diante tudo — inclusive miniaturas e
 * previews — se autentica pelo cookie.
 */
export const openSession = (accessKey: string) =>
  request<{ authenticationRequired: boolean }>("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessKey}` },
    body: JSON.stringify({}),
  });
