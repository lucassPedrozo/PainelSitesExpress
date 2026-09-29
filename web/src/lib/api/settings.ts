import { ApiError, reportUnauthorized } from "@/lib/access-token";
import type { AccessCheckResult } from "./deploy";
import { request } from "./http";

/* ---- Tela de configuração do .env ----------------------------------- */

export type SettingFieldType = "text" | "secret" | "number" | "boolean" | "select" | "url";

export type SettingField = {
  key: string;
  label: string;
  type: SettingFieldType;
  help: string | null;
  placeholder: string | null;
  options: Array<{ value: string; label: string; disabled?: boolean }> | null;
  required: boolean;
  /** Só vale depois de reiniciar o painel. */
  restart: boolean;
  /** Gravado, mas o painel em execução ainda usa o valor da subida. */
  pendingRestart: boolean;
  min: number | null;
  max: number | null;
  /** Campos comuns. */
  value?: string;
  /** Segredos: nunca vêm em claro — só se estão definidos e uma dica. */
  set?: boolean;
  hint?: string;
};

export type SettingSection = {
  id: string;
  title: string;
  description: string;
  fields: SettingField[];
};

export type EngineStatus = {
  id: "lovable" | "own";
  label: string;
  description: string;
  available: boolean;
  reason: string | null;
  details: Record<string, unknown>;
};

export type SettingsResponse = {
  envPath: string;
  sections: SettingSection[];
  engines: EngineStatus[];
};

export type SaveSettingsResponse = SettingsResponse & {
  saved: string[];
  restartRequired: string[];
  sessionsClosed: number;
};

/** Erro de gravação com o motivo de cada campo recusado. */
export class SettingsValidationError extends ApiError {
  readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string>) {
    super(400, message);
    this.fieldErrors = fieldErrors;
  }
}

export type AiKeyCheck =
  | { ok: true; models: string[]; model: string; modelAvailable: boolean }
  | { ok: false; reason: string };

const TIMEOUT_MS = 30_000;

export const fetchSettings = () =>
  request<SettingsResponse>("/api/settings", { timeoutMs: TIMEOUT_MS });

/**
 * Grava as mudanças. `null` ou "" apaga a chave; o que não vier fica como
 * está. O servidor recusa o pedido inteiro se um campo não passar, e o motivo
 * de cada um volta em `fieldErrors`.
 */
export async function saveSettings(updates: Record<string, string | null>) {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ApiError(0, "Não foi possível falar com a API local.");
  });
  const body = (await res.json().catch(() => null)) as
    | (SaveSettingsResponse & { error?: string; fieldErrors?: Record<string, string> })
    | null;
  if (!res.ok) {
    const message = body?.error ?? `Falha ao gravar (${res.status})`;
    if (res.status === 401) reportUnauthorized(message);
    if (body?.fieldErrors) throw new SettingsValidationError(message, body.fieldErrors);
    throw new ApiError(res.status, message);
  }
  return body as SaveSettingsResponse;
}

export const checkGithubAccess = (input: { token?: string; organization?: string }) =>
  request<AccessCheckResult>("/api/settings/check/github", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: TIMEOUT_MS,
  });

/** Confere a chave do modelo de IA listando os modelos — sem custo. */
export const checkAiKey = (input: { provider?: string; apiKey?: string; model?: string }) =>
  request<AiKeyCheck>("/api/settings/check/ai", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: TIMEOUT_MS,
  });
