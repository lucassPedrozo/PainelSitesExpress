import type { SettingField, SettingSection } from "@/lib/api/settings";

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

export const initialDraft = (field: SettingField): FieldDraft =>
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
