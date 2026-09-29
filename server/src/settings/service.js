import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { envPath, resetRuntimeConfig } from "../config.js";
import { maskSecret, upsertEnvFile } from "../deploy/env-file.js";
import { SETTING_FIELDS, SETTINGS_SCHEMA } from "./schema.js";

/**
 * Leitura e gravação das configurações do `.env` pela tela de configuração.
 *
 * Segredos nunca saem daqui em claro: a tela recebe `set` e uma dica. Campo
 * que só vale depois de reiniciar é marcado quando o valor gravado já não é o
 * que o painel carregou na subida — é o aviso "reinicie para valer".
 */

/**
 * O ambiente como estava na subida. Serve para saber se um campo lido só no
 * arranque mudou desde então.
 */
const startupEnv = { ...process.env };

const current = (key) => (process.env[key] ?? "").trim();

/** Prefixos públicos de tokens: mostrá-los não revela nada. */
const KNOWN_PREFIXES = ["github_pat_", "sk-ant-"];

/**
 * A dica de um segredo gravado — o bastante para reconhecer qual está lá, sem
 * entregar o valor. Token de formato conhecido mostra o prefixo e o final;
 * senha e o resto, no máximo os dois últimos caracteres. (A `maskSecret` do
 * Deploy mostrava 4 + 4 de qualquer valor: numa senha, eram 8 caracteres dela.)
 *
 * @param {string} value
 */
export function secretHint(value) {
  if (!value) return "";
  const prefixo = KNOWN_PREFIXES.find((p) => value.startsWith(p));
  if (prefixo && value.length >= prefixo.length + 12) return maskSecret(value);
  return value.length >= 12 ? `••••${value.slice(-2)}` : "••••";
}

/** O que a tela recebe de um campo. */
function describeField(field) {
  const valor = current(field.key);
  const base = {
    key: field.key,
    label: field.label,
    type: field.type,
    help: field.help ?? null,
    placeholder: field.placeholder ?? null,
    options: field.options ?? null,
    required: Boolean(field.required),
    restart: Boolean(field.restart),
    min: field.min ?? null,
    max: field.max ?? null,
    // Gravado, mas o painel em execução ainda usa o valor da subida.
    pendingRestart: Boolean(field.restart) && valor !== (startupEnv[field.key] ?? "").trim(),
  };
  if (field.type === "secret") return { ...base, set: Boolean(valor), hint: secretHint(valor) };
  return { ...base, value: valor };
}

export function readSettings() {
  return {
    envPath,
    sections: SETTINGS_SCHEMA.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      fields: section.fields.map(describeField),
    })),
  };
}

/**
 * Normaliza e valida um valor pelo tipo do campo. `null` na resposta de erro
 * significa "valor aceito"; o valor normalizado volta em `value`.
 *
 * @returns {{ value: string, error: string | null }}
 */
function normalize(field, raw) {
  if (raw === null || raw === undefined) return { value: "", error: null };
  if (typeof raw === "boolean" && field.type === "boolean") return { value: raw ? "1" : "0", error: null };
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { value: "", error: "Valor inválido." };
  }
  const value = String(raw).trim();
  if (value === "") return { value, error: null };
  if (/[\r\n]/.test(value)) return { value, error: "O valor não pode ter quebra de linha." };

  switch (field.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isInteger(n)) return { value, error: "Use um número inteiro." };
      if (field.min !== undefined && n < field.min) return { value, error: `Mínimo ${field.min}.` };
      if (field.max !== undefined && n > field.max) return { value, error: `Máximo ${field.max}.` };
      return { value: String(n), error: null };
    }
    case "boolean":
      if (["1", "true", "sim"].includes(value.toLowerCase())) return { value: "1", error: null };
      if (["0", "false", "não", "nao"].includes(value.toLowerCase())) return { value: "0", error: null };
      return { value, error: "Use ligado ou desligado." };
    case "select": {
      const opcao = field.options?.find((option) => option.value === value);
      if (!opcao) return { value, error: "Opção inválida." };
      return { value, error: null };
    }
    default:
      return { value, error: null };
  }
}

/**
 * Valida o pedido inteiro antes de gravar qualquer coisa: ou tudo entra, ou
 * nada muda.
 *
 * @param {Record<string, unknown>} updates chave do `.env` → valor; `null` ou
 *   "" apaga
 * @returns {{ ok: true, values: Record<string, string> } | { ok: false, errors: Record<string, string> }}
 */
export function validateSettings(updates) {
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {Record<string, string>} */
  const values = {};

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return { ok: false, errors: { _: "Nenhuma configuração informada." } };
  }
  const chaves = Object.keys(updates);
  if (chaves.length === 0) return { ok: false, errors: { _: "Nenhuma configuração informada." } };

  for (const key of chaves) {
    const field = SETTING_FIELDS.get(key);
    if (!field) {
      errors[key] = "Configuração desconhecida.";
      continue;
    }
    const { value, error } = normalize(field, updates[key]);
    if (error) errors[key] = error;
    else values[key] = value;
  }

  // Como o `.env` fica depois da gravação: as validações que dependem de
  // outro campo (a rede exige a chave do painel) olham o conjunto.
  const depois = Object.fromEntries(
    [...SETTING_FIELDS.keys()].map((key) => [key, key in values ? values[key] : current(key)]),
  );

  for (const [key, value] of Object.entries(values)) {
    const field = SETTING_FIELDS.get(key);
    if (value === "") {
      if (field.required) errors[key] = "Este campo é obrigatório.";
      continue;
    }
    const erro = field.validate?.(value, depois);
    if (erro) errors[key] = erro;
  }

  // Apagar a chave com o painel aberto para a rede deixaria a porta sem senha.
  const host = (depois.SERVER_HOST || "127.0.0.1").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && !depois.PANEL_ACCESS_TOKEN) {
    errors.PANEL_ACCESS_TOKEN ??= "Com o painel aberto para a rede, a chave do administrador é obrigatória.";
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

/**
 * Grava no `.env` (modo 600), atualiza o ambiente do processo e o cache da
 * configuração relida a cada uso.
 *
 * @param {Record<string, string>} values já validados
 * @param {string} [file] o `.env` — trocado nos testes, que nunca tocam no real
 * @returns {{ saved: string[], restartRequired: string[] }}
 */
export function writeSettings(values, file = envPath) {
  const conteudo = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, upsertEnvFile(conteudo, values), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // No Windows o modo é ignorado; o arquivo continua fora do alcance da web.
  }

  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  resetRuntimeConfig();

  const saved = Object.keys(values);
  return {
    saved,
    restartRequired: saved.filter((key) => SETTING_FIELDS.get(key)?.restart),
  };
}
