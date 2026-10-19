import {
  BUILD_ENV_LINE_PATTERN,
  DOMAIN_PATTERN,
  HOST_PATTERN,
  MAX_BUILD_ENV,
  MAX_FTP_LOGIN,
  MAX_FTP_PASSWORD,
  MAX_PORT,
  MIN_PORT,
  PORT_PATTERN,
  SERVER_DIR_PATTERN,
} from "../../../shared/deploy-rules.js";
import { HttpError } from "../http.js";

/*
 * Validação da entrada — tudo que vem do navegador passa por aqui antes de
 * virar chamada ao GitHub. Os padrões e limites vêm de shared/deploy-rules.js,
 * os mesmos com que a interface (web/src/features/deploy/validation.ts) avisa
 * antes de enviar.
 */

/** `auto` exige FTPS explícito e para a publicação se o servidor não aceitar: nunca cai sozinho para FTP simples. */
const ftpProtocols = ["auto", "ftps", "ftps-legacy", "ftp"];

export const assertIdentifier = (value, label) => {
  if (!/^[a-z0-9_.-]+$/i.test(value)) throw new HttpError(400, `${label} inválido.`);
  return value;
};

export const assertBranch = (value) => {
  if (typeof value !== "string" || !/^(?!.*\.\.)[a-z0-9._/-]+$/i.test(value)) {
    throw new HttpError(400, "Branch inválida.");
  }
  return value;
};

export const assertWorkflowPath = (value) => {
  if (
    typeof value !== "string" ||
    !/^\.github\/workflows\/[a-z0-9._-]+\.ya?ml$/i.test(value)
  ) {
    throw new HttpError(400, "Caminho de workflow inválido.");
  }
  return value;
};

export const assertWorkflowFileName = (value) => {
  if (typeof value !== "string" || !/^[a-z0-9._-]+\.ya?ml$/i.test(value)) {
    throw new HttpError(400, "Nome de workflow inválido.");
  }
  return value;
};

export const assertDomain = (value) => {
  const domain = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new HttpError(
      400,
      "Domínio inválido. Informe apenas o domínio, sem https:// ou caminho.",
    );
  }
  return domain;
};

const assertFtpServer = (value) => {
  const host = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!HOST_PATTERN.test(host)) {
    throw new HttpError(
      400,
      "Servidor FTP inválido. Informe apenas o host, sem ftp:// ou caminho.",
    );
  }
  return host;
};

const assertRequiredText = (value, label, maxLength = 200) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(400, `${label} é obrigatório.`);
  if (text.length > maxLength) {
    throw new HttpError(400, `${label} excede ${maxLength} caracteres.`);
  }
  return text;
};

export const assertServerDir = (value) => {
  const dir = typeof value === "string" ? value.trim() : "";
  if (!dir) return "";
  if (dir.includes("..")) {
    throw new HttpError(400, 'A pasta remota não pode conter "..".');
  }
  if (!SERVER_DIR_PATTERN.test(dir)) {
    throw new HttpError(400, "Pasta remota inválida.");
  }
  return dir.replace(/\/+$/, "");
};

const assertProtocol = (value) => {
  if (value === undefined || value === null || value === "") return "auto";
  if (typeof value !== "string" || !ftpProtocols.includes(value)) {
    throw new HttpError(400, "Protocolo de transferência inválido.");
  }
  return value;
};

/** Aceita a porta em texto ou número (`"21"` ou `21`), sempre só com dígitos. */
export const assertPort = (value) => {
  if (value === undefined || value === null || value === "") return "";
  const texto = String(value).trim();
  const port = Number(texto);
  if (!PORT_PATTERN.test(texto) || port < MIN_PORT || port > MAX_PORT) {
    throw new HttpError(400, "Porta FTP inválida.");
  }
  return String(port);
};

export const assertBuildEnv = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length > MAX_BUILD_ENV) {
    throw new HttpError(400, "As variáveis de build excedem o limite de 16 KB.");
  }
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith("#")) continue;
    if (!BUILD_ENV_LINE_PATTERN.test(entry)) {
      throw new HttpError(
        400,
        `Variável de build inválida: "${entry.slice(0, 40)}". Use o formato CHAVE=valor.`,
      );
    }
  }
  return text;
};

/**
 * O corpo de "Salvar configuração": os campos validados e os secrets que vão
 * para o repositório.
 */
export const parsePublicationRequest = (rawBody) => {
  const body = rawBody ?? {};
  const branch = assertBranch(body.branch);
  const domain = assertDomain(body.domain);
  const ftpServer = assertFtpServer(body.ftpServer);
  const ftpLogin = assertRequiredText(body.ftpLogin, "Login FTP", MAX_FTP_LOGIN);
  const ftpPassword = assertRequiredText(body.ftpPassword, "Senha FTP", MAX_FTP_PASSWORD);
  const serverDir = assertServerDir(body.serverDir);
  const protocol = assertProtocol(body.protocol);
  const port = assertPort(body.port);
  const buildEnv = assertBuildEnv(body.buildEnv);
  const clearBuildEnv = body.clearBuildEnv === true;
  if (buildEnv && clearBuildEnv) {
    throw new HttpError(
      400,
      "Informe as variáveis de build ou peça para removê-las, não os dois.",
    );
  }
  const autoDeploy = body.autoDeploy === true;

  const secrets = [
    { name: "DEPLOY_DOMAIN", value: domain },
    { name: "FTP_SERVER", value: ftpServer },
    { name: "FTP_LOGIN", value: ftpLogin },
    { name: "FTP_PASSWORD", value: ftpPassword },
    // Valores opcionais: quando vazios o secret é removido para não deixar
    // configuração antiga ativa no repositório.
    { name: "FTP_SERVER_DIR", value: serverDir || null },
    { name: "FTP_PROTOCOL", value: protocol === "auto" ? null : protocol },
    { name: "FTP_PORT", value: port || null },
    // As variáveis de build podem conter chaves de API, então a interface
    // não as guarda para preencher o campo de novo. Campo vazio, portanto,
    // significa "manter o que já está no repositório" (`undefined` não grava
    // nem remove); remover exige o pedido explícito.
    {
      name: "BUILD_ENV_FILE",
      value: buildEnv || (clearBuildEnv ? null : undefined),
    },
  ];

  // O que não é segredo volta para o formulário de quem abrir este
  // repositório depois — em qualquer navegador, não só no de quem salvou.
  const settings = { ftpServer, ftpLogin, serverDir, protocol, port, autoDeploy };

  return { branch, domain, autoDeploy, secrets, settings };
};
