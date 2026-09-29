import { describe, expect, it } from "vitest";
import type { SettingField, SettingSection } from "@/lib/api/settings";
import { changeOf, initialDrafts, sectionUpdates } from "@/features/settings/settings-form";

const campo = (over: Partial<SettingField>): SettingField => ({
  key: "K",
  label: "K",
  type: "text",
  help: null,
  placeholder: null,
  options: null,
  required: false,
  restart: false,
  pendingRestart: false,
  min: null,
  max: null,
  ...over,
});

describe("changeOf", () => {
  it("campo comum: só vai se mudou, e vazio apaga", () => {
    const f = campo({ value: "org" });
    expect(changeOf(f, { kind: "value", value: "org " })).toBeUndefined();
    expect(changeOf(f, { kind: "value", value: "outra" })).toBe("outra");
    expect(changeOf(f, { kind: "value", value: "" })).toBeNull();
  });

  it("segredo: vazio mantém o gravado; apagar só vale se havia algo", () => {
    const definido = campo({ type: "secret", set: true, hint: "gh…1234" });
    expect(changeOf(definido, { kind: "secret", replacement: "", clear: false })).toBeUndefined();
    expect(changeOf(definido, { kind: "secret", replacement: " novo ", clear: false })).toBe("novo");
    expect(changeOf(definido, { kind: "secret", replacement: "", clear: true })).toBeNull();
    const vazio = campo({ type: "secret", set: false });
    expect(changeOf(vazio, { kind: "secret", replacement: "", clear: true })).toBeUndefined();
  });
});

describe("sectionUpdates", () => {
  it("monta o pedido só com o que mudou na seção", () => {
    const secao: SettingSection = {
      id: "github",
      title: "GitHub",
      description: "",
      fields: [
        campo({ key: "GITHUB_ORG", value: "org" }),
        campo({ key: "GITHUB_TOKEN", type: "secret", set: true }),
        campo({ key: "DEFAULT_FTP_HOST", value: "" }),
      ],
    };
    const drafts = initialDrafts([secao]);
    expect(sectionUpdates(secao, drafts)).toEqual({});

    drafts.GITHUB_ORG = { kind: "value", value: "nova-org" };
    drafts.GITHUB_TOKEN = { kind: "secret", replacement: "github_pat_x", clear: false };
    expect(sectionUpdates(secao, drafts)).toEqual({ GITHUB_ORG: "nova-org", GITHUB_TOKEN: "github_pat_x" });
  });
});
