import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config, envPath, resetRuntimeConfig, runtimeConfig } from "../config.js";
import { HttpError } from "../http.js";
import { maskSecret, upsertEnvFile } from "../settings/env-file.js";
import { HOST_PATTERN } from "../../../shared/deploy-rules.js";

/** Chaves que a tela de configuração pode gravar no `.env`. */
const editableSettings = [
  "GITHUB_TOKEN",
  "GITHUB_ORG",
  "DEFAULT_FTP_HOST",
  "PANEL_ACCESS_TOKEN",
];

/**
 * Grava as configurações no `.env` da máquina e recarrega o cache, para o
 * painel passar a usar os novos valores sem reiniciar o servidor.
 * `PORT` e `SERVER_HOST` são exceções: eles são lidos na subida do processo.
 */
export const saveSettings = (updates) => {
  const entries = Object.entries(updates).filter(
    ([key, value]) => editableSettings.includes(key) && value !== undefined,
  );
  if (entries.length === 0) return envPath;

  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(envPath, upsertEnvFile(current, Object.fromEntries(entries)), {
    encoding: "utf8",
    mode: 0o600,
  });

  for (const [key, value] of entries) process.env[key] = value;
  resetRuntimeConfig();

  return envPath;
};

/** Estado da configuração local. Nenhum segredo é devolvido, só a dica. */
export const readPanelSettings = () => {
  const runtime = runtimeConfig();
  return {
    envPath,
    githubConfigured: Boolean(runtime.githubToken),
    // O token nunca volta para o navegador; a dica só serve para a pessoa
    // reconhecer qual token está gravado.
    githubTokenHint: maskSecret(runtime.githubToken),
    organization: runtime.organization,
    defaultFtpHost: runtime.defaultFtpHost,
    panelAccessTokenSet: Boolean(runtime.panelAccessToken),
    serverHost: config.serverHost,
    port: config.port,
  };
};

const settingKeys = new Set([
  "githubToken",
  "organization",
  "defaultFtpHost",
  "panelAccessToken",
]);

/** O painel escuta além desta máquina: agora, ou no próximo início. */
const abertoParaARede = () =>
  [config.serverHost, process.env.SERVER_HOST].some((valor) => {
    const host = (valor ?? "").trim().toLowerCase() || "127.0.0.1";
    return host !== "127.0.0.1" && host !== "localhost";
  });

/**
 * Valida o formulário de configuração e o traduz em chaves do `.env`. As
 * regras que valem para todo campo são as mesmas da tela de Configurações
 * (`settings/service.js`): nenhuma quebra de linha, e a chave do administrador
 * não some com o painel aberto para a rede.
 */
export const parseSettingsPayload = (body) => {
  const input = body ?? {};
  const updates = {};

  for (const [campo, valor] of Object.entries(input)) {
    if (typeof valor === "string" && /[\r\n]/.test(valor.trim())) {
      throw new HttpError(400, `${campo}: o valor não pode ter quebra de linha.`);
    }
  }

  if (typeof input.githubToken === "string" && input.githubToken.trim()) {
    const token = input.githubToken.trim();
    if (!token.startsWith("github_pat_")) {
      throw new HttpError(
        400,
        "Use um fine-grained personal access token (prefixo github_pat_).",
      );
    }
    if (token.length > 512) throw new HttpError(400, "Token do GitHub inválido.");
    updates.GITHUB_TOKEN = token;
  }

  if (typeof input.organization === "string") {
    const organization = input.organization.trim();
    if (organization && !/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(organization)) {
      throw new HttpError(
        400,
        "Organização inválida. Use o identificador do GitHub, sem espaços.",
      );
    }
    updates.GITHUB_ORG = organization;
  }

  if (typeof input.defaultFtpHost === "string") {
    const host = input.defaultFtpHost.trim().toLowerCase();
    if (host && !HOST_PATTERN.test(host)) {
      throw new HttpError(
        400,
        "Servidor FTP padrão inválido. Informe apenas o host.",
      );
    }
    updates.DEFAULT_FTP_HOST = host;
  }

  if (typeof input.panelAccessToken === "string") {
    const token = input.panelAccessToken.trim();
    if (token && token.length < 16) {
      throw new HttpError(
        400,
        "A chave do painel precisa de pelo menos 16 caracteres.",
      );
    }
    if (token.length > 256) throw new HttpError(400, "Chave do painel muito longa.");
    if (!token && abertoParaARede()) {
      throw new HttpError(
        400,
        "Com o painel aberto para a rede, a chave do administrador é obrigatória.",
      );
    }
    updates.PANEL_ACCESS_TOKEN = token;
  }

  const unknownField = Object.keys(input).find((field) => !settingKeys.has(field));
  if (unknownField) {
    throw new HttpError(400, `Campo desconhecido: ${unknownField}.`);
  }

  if (!editableSettings.some((key) => key in updates)) {
    throw new HttpError(400, "Nenhuma configuração informada.");
  }

  return updates;
};
