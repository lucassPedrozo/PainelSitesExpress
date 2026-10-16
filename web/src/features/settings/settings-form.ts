import type { EngineStatus, SettingField, SettingSection } from "@/lib/api/settings";
import { formatBytes, formatDate, timeOf } from "@/lib/format";

/**
 * A grade das linhas da tela: rótulo numa coluna fixa, controle no resto. O
 * respiro lateral é o do cabeçalho do `SectionCard` (px-5), para o rótulo
 * alinhar com o título da seção.
 */
export const FIELD_GRID = "grid gap-x-8 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]";

/** "60000" num campo em milissegundos → "1 min"; em bytes → "64 MB". */
export function humanUnit(key: string, raw: string): string | null {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n) || n < 0) return null;
  if (key.endsWith("_MS")) {
    if (n === 0) return "desligado";
    if (n % 3_600_000 === 0) return `${n / 3_600_000} h`;
    if (n % 60_000 === 0) return `${n / 60_000} min`;
    if (n % 1000 === 0) return `${n / 1000} s`;
    return null;
  }
  if (key.endsWith("_BYTES")) return formatBytes(n);
  return null;
}

/**
 * O rascunho da tela de configuração e o pedido de gravação que sai dele.
 *
 * Campo comum: o texto no campo. Segredo: nunca chega do servidor, então o
 * rascunho é "trocar por este valor" ou "apagar"; campo vazio mantém o que
 * está gravado. Só o que mudou vai no pedido.
 */

export type FieldDraft =
  | { kind: "value"; value: string }
  | { kind: "secret"; replacement: string; clear: boolean };

export type Drafts = Record<string, FieldDraft>;

const initialDraft = (field: SettingField): FieldDraft =>
  field.type === "secret"
    ? { kind: "secret", replacement: "", clear: false }
    : { kind: "value", value: field.value ?? "" };

export const initialDrafts = (sections: SettingSection[]): Drafts =>
  Object.fromEntries(sections.flatMap((s) => s.fields.map((f) => [f.key, initialDraft(f)])));

/** O que mudou num campo, no formato da API: texto novo, `null` para apagar, ou nada. */
export function changeOf(field: SettingField, draft: FieldDraft | undefined): string | null | undefined {
  if (!draft) return undefined;
  if (draft.kind === "secret") {
    if (draft.clear) return field.set ? null : undefined;
    const novo = draft.replacement.trim();
    return novo ? novo : undefined;
  }
  const atual = (field.value ?? "").trim();
  const novo = draft.value.trim();
  if (novo === atual) return undefined;
  return novo === "" ? null : novo;
}

/** O pedido de gravação de uma seção: só os campos que mudaram. */
export function sectionUpdates(section: SettingSection, drafts: Drafts): Record<string, string | null> {
  const updates: Record<string, string | null> = {};
  for (const field of section.fields) {
    const mudanca = changeOf(field, drafts[field.key]);
    if (mudanca !== undefined) updates[field.key] = mudanca;
  }
  return updates;
}

/* ---- O estado de cada integração ------------------------------------ */

/** O selo de uma seção (e da visão geral no topo): o que está gravado, não o rascunho. */
export type SectionStatus = {
  label: string;
  variant: "success" | "warning" | "info" | "outline";
  /** "Incompleto": os rótulos dos campos que faltam, para dizer o que completar. */
  missing?: string[];
};

/**
 * Os campos sem os quais cada integração não funciona — o mesmo critério do
 * servidor: o Drive lê a pasta e a chave da service account; o GitHub, token e
 * organização; a área de aprovação, `isDevAreaConfigured`; o encurtador, o
 * `isConfigured` dele. Antes só os segredos contavam, e um GitHub com token e
 * sem organização aparecia "Configurado". O `required` do schema soma aqui.
 */
const ESSENCIAIS: Record<string, string[]> = {
  drive: ["DRIVE_ROOT_FOLDER_ID", "GOOGLE_CREDENTIALS_PATH"],
  assistant: ["GEMINI_API_KEY"],
  github: ["GITHUB_TOKEN", "GITHUB_ORG"],
  "dev-area": ["DEV_AREA_URL", "DEV_AREA_FTP_SERVER", "DEV_AREA_FTP_LOGIN", "DEV_AREA_FTP_PASSWORD"],
  shortlinks: ["BETTERLINKS_MCP_URL", "BETTERLINKS_MCP_TOKEN"],
};

/** Há valor gravado: o segredo está definido, ou o texto não é vazio. */
const isFieldSet = (field: SettingField) =>
  field.type === "secret" ? Boolean(field.set) : (field.value ?? "").trim() !== "";

/** Os endereços em que o painel só atende esta máquina; vazio é o padrão, 127.0.0.1. */
const SO_ESTA_MAQUINA = new Set(["", "127.0.0.1", "localhost", "::1"]);

/** O estado de um motor de geração, na linha "Motores" e no selo da seção dele. */
export function engineStatus(motor: EngineStatus): SectionStatus {
  if (motor.id === "claude") {
    // O motor Claude não tem segredo: o estado dele é o pacote e a trava.
    if (!motor.available) return { label: "Não instalado", variant: "warning" };
    return motor.details.enabled
      ? { label: "Uso liberado", variant: "success" }
      : { label: "Uso desligado", variant: "outline" };
  }
  return motor.available
    ? { label: "Conectado", variant: "success" }
    : { label: "Não conectado", variant: "outline" };
}

/** O selo de uma seção, ou `null` quando ela não tem um estado a dizer. */
export function sectionStatus(section: SettingSection, engines: EngineStatus[]): SectionStatus | null {
  if (section.id === "claude") {
    const motor = engines.find((engine) => engine.id === "claude");
    return motor ? engineStatus(motor) : null;
  }
  if (section.id === "generation") {
    // A geração tem dois motores; o Claude tem seção própria, então aqui vale o Lovable.
    const lovable = engines.find((engine) => engine.id === "lovable");
    if (!lovable) return null;
    return lovable.available
      ? { label: "Lovable conectado", variant: "success" }
      : { label: "Lovable não conectado", variant: "outline" };
  }
  if (section.id === "network") {
    const host = section.fields.find((campo) => campo.key === "SERVER_HOST");
    if (!host) return null;
    return SO_ESTA_MAQUINA.has((host.value ?? "").trim().toLowerCase())
      ? { label: "Só esta máquina", variant: "outline" }
      : { label: "Aberto à rede local", variant: "info" };
  }

  const essenciais = section.fields.filter(
    (campo) => campo.required || ESSENCIAIS[section.id]?.includes(campo.key),
  );
  if (essenciais.length === 0) return null;
  const faltam = essenciais.filter((campo) => !isFieldSet(campo));
  if (faltam.length === 0) return { label: "Configurado", variant: "success" };
  if (faltam.length === essenciais.length) return { label: "Não configurado", variant: "outline" };
  return { label: "Incompleto", variant: "warning", missing: faltam.map((campo) => campo.label) };
}

/* ---- Validade do token do GitHub ------------------------------------ */

const DIA_MS = 86_400_000;
/** Quantos dias antes do vencimento o teste passa a avisar: tempo de gerar outro token. */
const AVISO_DE_VENCIMENTO_DIAS = 14;

/**
 * A validade do token, como o teste do GitHub a informa: "vence em
 * 12/03/2027", "sem data de validade", ou o aviso de que venceu ou está perto.
 * `ok` segue o ícone da linha (certo, atenção, erro).
 */
export function tokenValidity(
  expiresAt: string | null,
  now: number,
): { ok: boolean | "warn"; text: string } {
  if (!expiresAt) return { ok: true, text: "Token sem data de validade." };
  const quando = timeOf(expiresAt);
  // O GitHub mandou a data num formato que não se lê: mostra como veio.
  if (quando === null) return { ok: "warn", text: `Validade do token: ${expiresAt}.` };
  const data = formatDate(quando);
  if (quando <= now) return { ok: false, text: `O token venceu em ${data}. Gere outro no GitHub e troque acima.` };
  if (quando - now < AVISO_DE_VENCIMENTO_DIAS * DIA_MS) {
    return { ok: "warn", text: `O token vence em ${data}: gere outro antes disso.` };
  }
  return { ok: true, text: `O token vence em ${data}.` };
}
