import type { PublicationSettings } from "@/lib/api/deploy";
import type { ValidationErrors } from "./deploy-types";

/**
 * Espelho dos validadores da API (`server/src/deploy/routes.js`). Sem ele o
 * operador só descobre o campo errado por um toast, depois da ida ao servidor
 * — e pior, sem saber qual dos campos foi recusado.
 */
const domainPattern =
  /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const hostPattern = /^(?!https?:\/\/)[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
const serverDirPattern = /^[a-z0-9._/-]{1,255}$/i;
const buildEnvLinePattern = /^[A-Z_][A-Z0-9_]*=/i;

const MAX_LOGIN = 200;
const MAX_PASSWORD = 512;
const MAX_BUILD_ENV = 16 * 1024;

/** Do campo do formulário para o `id` do controle, para focar o primeiro erro. */
export const fieldElementId: Record<keyof ValidationErrors, string> = {
  repo: "repository",
  domain: "domain",
  ftpServer: "ftp-server",
  ftpLogin: "ftp-login",
  ftpPassword: "ftp-password",
  serverDir: "server-dir",
  port: "ftp-port",
  buildEnv: "build-env",
};

/** Ordem visual dos campos — o primeiro erro a focar é o de cima. */
export const fieldOrder: Array<keyof ValidationErrors> = [
  "repo",
  "domain",
  "ftpServer",
  "ftpLogin",
  "ftpPassword",
  "serverDir",
  "port",
  "buildEnv",
];

/** Campos que moram dentro de "Opções avançadas". */
export const advancedFields = ["serverDir", "port", "buildEnv"] as const;

export const hasAdvancedError = (errors: ValidationErrors) =>
  advancedFields.some((field) => Boolean(errors[field]));

/** Quantos campos avançados o operador preencheu — vira contador no gatilho. */
export const advancedFilledCount = (settings: PublicationSettings) =>
  [
    settings.serverDir.trim(),
    settings.port.trim(),
    settings.buildEnv.trim() || (settings.clearBuildEnv ? "remover" : ""),
    settings.protocol !== "auto" ? settings.protocol : "",
  ].filter(Boolean).length;

export function validateSettings(
  settings: PublicationSettings,
  options: { hasRepo: boolean },
): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!options.hasRepo) errors.repo = "Selecione um repositório.";

  const domain = settings.domain.trim();
  if (!domain) errors.domain = "Informe o domínio.";
  else if (!domainPattern.test(domain)) {
    errors.domain = "Use apenas o domínio, sem https:// ou caminho.";
  }

  const ftpServer = settings.ftpServer.trim();
  if (!ftpServer) errors.ftpServer = "Informe o servidor FTP.";
  else if (!hostPattern.test(ftpServer)) {
    errors.ftpServer = "Use apenas o host, sem ftp:// ou barra.";
  }

  const ftpLogin = settings.ftpLogin.trim();
  if (!ftpLogin) errors.ftpLogin = "Informe o login FTP.";
  else if (ftpLogin.length > MAX_LOGIN) {
    errors.ftpLogin = `O login excede ${MAX_LOGIN} caracteres.`;
  }

  const ftpPassword = settings.ftpPassword.trim();
  if (!ftpPassword) errors.ftpPassword = "Informe a senha FTP.";
  else if (ftpPassword.length > MAX_PASSWORD) {
    errors.ftpPassword = `A senha excede ${MAX_PASSWORD} caracteres.`;
  }

  const serverDir = settings.serverDir.trim();
  if (serverDir) {
    if (serverDir.includes("..")) {
      errors.serverDir = 'A pasta remota não pode conter "..".';
    } else if (!serverDirPattern.test(serverDir)) {
      errors.serverDir =
        "Use apenas letras, números, ponto, hífen, barra e sublinhado.";
    }
  }

  const port = settings.port.trim();
  if (port) {
    const parsed = Number(port);
    if (!/^\d+$/.test(port) || !Number.isInteger(parsed)) {
      errors.port = "Informe apenas números.";
    } else if (parsed < 1 || parsed > 65535) {
      errors.port = "A porta precisa estar entre 1 e 65535.";
    }
  }

  const buildEnv = settings.buildEnv.trim();
  if (buildEnv) {
    if (buildEnv.length > MAX_BUILD_ENV) {
      errors.buildEnv = "As variáveis de build excedem o limite de 16 KB.";
    } else {
      // Comentários e linhas vazias são ignorados pelo workflow, como no .env.
      const invalid = buildEnv
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(
          (line) =>
            line && !line.startsWith("#") && !buildEnvLinePattern.test(line),
        );
      if (invalid) {
        errors.buildEnv = `Use CHAVE=valor. Linha inválida: "${invalid.slice(0, 40)}".`;
      }
    }
  }

  return errors;
}

/**
 * A API recusa alguns casos que o formulário não tem como prever (um domínio
 * que o GitHub rejeita, por exemplo). Quando isso acontece, a mensagem é
 * devolvida ao campo de origem em vez de morrer num toast.
 */
export function serverErrorField(
  message: string,
): keyof ValidationErrors | undefined {
  const text = message.toLowerCase();
  if (text.includes("domínio")) return "domain";
  if (text.includes("servidor ftp")) return "ftpServer";
  if (text.includes("login ftp")) return "ftpLogin";
  if (text.includes("senha ftp")) return "ftpPassword";
  if (text.includes("pasta remota")) return "serverDir";
  if (text.includes("porta ftp")) return "port";
  if (text.includes("variáve")) return "buildEnv";
  return undefined;
}
