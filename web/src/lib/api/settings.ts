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
  id: "lovable" | "claude";
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

export type GeminiKeyCheck =
  | {
      ok: true;
      /** Tudo que a chave alcança e gera texto. */
      models: string[];
      /** Dos modelos que o painel tenta, os que a chave alcança. */
      available: string[];
      /** Os Flash de texto do catálogo, do mais novo ao mais antigo. */
      flash: string[];
      preferredModel: string | null;
      preferredAvailable: boolean | null;
    }
  | { ok: false; reason: string };

/**
 * O motor Claude nesta máquina, para a seção dele: o que o painel encontrou e
 * o que uma geração dispararia. `custom` diz que o valor vem das Configurações,
 * e não do padrão do motor.
 */
export type ClaudeDiagnostics = {
  installed: boolean;
  /** Por que o motor não está disponível, ou o que ele respondeu no lugar do estado. */
  reason: string | null;
  generation: { enabled: boolean; reason: string | null };
  claude: { found: boolean; version: string | null; custom: boolean } | null;
  /** Do navegador, só o nome do programa. */
  browser: { found: boolean; name: string | null; custom: boolean } | null;
  model: { effective: string; expected: string; custom: boolean } | null;
  /** O esforço de raciocínio de uma geração: o que vale e o que o motor espera. */
  effort: { effective: string; expected: string; custom: boolean } | null;
  /** A geração para e espera a aprovação da direção criativa? */
  humanApproval: { enabled: boolean; custom: boolean } | null;
  /** O comando de uma geração, já sem os caminhos desta máquina. */
  command: string | null;
};

/** A resposta de "Testar Claude". */
export type ClaudeLoginTest = {
  ok: boolean;
  message: string;
  model: string | null;
  apiKeySource: string | null;
  /** Estimativa do Claude Code; o consumo de verdade sai da assinatura. */
  estimatedCostUsd: number | null;
};

const TIMEOUT_MS = 30_000;
/** O teste do Claude espera a resposta de um `claude -p` de verdade. */
const CLAUDE_TEST_TIMEOUT_MS = 150_000;

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

/** O estado do motor Claude nesta máquina. Não dispara o Claude Code. */
export const fetchClaudeDiagnostics = () =>
  request<ClaudeDiagnostics>("/api/settings/claude", { timeoutMs: TIMEOUT_MS });

/**
 * "Testar Claude": uma pergunta mínima ao Claude Code, pelo login da
 * assinatura. É o único teste desta tela que gasta — só é chamado depois de a
 * pessoa confirmar, e o servidor o recusa com a trava desligada.
 */
export const testClaudeLogin = () =>
  request<ClaudeLoginTest>("/api/settings/check/claude", {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
    timeoutMs: CLAUDE_TEST_TIMEOUT_MS,
  });

/** Confere a chave do Gemini listando os modelos — sem gerar nada, sem custo. */
export const checkGeminiKey = (input: { apiKey?: string; model?: string }) =>
  request<GeminiKeyCheck>("/api/settings/check/gemini", {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: TIMEOUT_MS,
  });
