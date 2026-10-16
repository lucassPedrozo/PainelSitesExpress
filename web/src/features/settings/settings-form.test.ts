import { describe, expect, it } from "vitest";
import type { EngineStatus, SettingField, SettingSection } from "@/lib/api/settings";
import {
  changeOf,
  humanUnit,
  initialDrafts,
  sectionStatus,
  sectionUpdates,
  tokenValidity,
} from "@/features/settings/settings-form";

describe("humanUnit", () => {
  it("lê milissegundos e bytes como gente, e cala quando não há leitura redonda", () => {
    expect(humanUnit("CACHE_TTL_MS", "60000")).toBe("1 min");
    expect(humanUnit("PREVIEW_WATCH_INTERVAL_MS", "1800000")).toBe("30 min");
    expect(humanUnit("DEV_AREA_WATCH_INTERVAL_MS", "7200000")).toBe("2 h");
    expect(humanUnit("DEV_AREA_WATCH_INTERVAL_MS", "0")).toBe("desligado");
    expect(humanUnit("CACHE_TTL_MS", "1500")).toBeNull();
    expect(humanUnit("LOVABLE_MAX_ATTACHMENT_BYTES", "67108864")).toBe("64 MB");
    expect(humanUnit("PORT", "3333")).toBeNull();
    expect(humanUnit("CACHE_TTL_MS", "")).toBeNull();
  });
});

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

const secao = (id: string, fields: SettingField[]): SettingSection => ({ id, title: id, description: "", fields });

const motor = (over: Partial<EngineStatus> & Pick<EngineStatus, "id">): EngineStatus => ({
  label: over.id,
  description: "",
  available: true,
  reason: null,
  details: {},
  ...over,
});

describe("sectionStatus", () => {
  it("GitHub com token e sem organização está incompleto, e diz o que falta", () => {
    const token = campo({ key: "GITHUB_TOKEN", type: "secret", set: true });
    const org = (value: string) => campo({ key: "GITHUB_ORG", label: "Organização", value });
    const ftp = campo({ key: "DEFAULT_FTP_HOST", value: "" });

    expect(sectionStatus(secao("github", [token, org(""), ftp]), [])).toEqual({
      label: "Incompleto",
      variant: "warning",
      missing: ["Organização"],
    });
    expect(sectionStatus(secao("github", [token, org("joinvix"), ftp]), [])?.label).toBe("Configurado");
    expect(
      sectionStatus(secao("github", [campo({ key: "GITHUB_TOKEN", type: "secret", set: false }), org(""), ftp]), [])
        ?.label,
    ).toBe("Não configurado");
  });

  it("um campo obrigatório do schema conta, mesmo fora da lista de essenciais", () => {
    expect(sectionStatus(secao("outra", [campo({ key: "X", required: true, value: "" })]), [])?.label).toBe(
      "Não configurado",
    );
    expect(sectionStatus(secao("outra", [campo({ key: "X", required: true, value: "1" })]), [])?.label).toBe(
      "Configurado",
    );
    expect(sectionStatus(secao("outra", [campo({ key: "X", value: "" })]), [])).toBeNull();
  });

  it("rede: só esta máquina ou aberta à rede local", () => {
    const host = (value: string) => secao("network", [campo({ key: "SERVER_HOST", value })]);
    expect(sectionStatus(host(""), [])?.label).toBe("Só esta máquina");
    expect(sectionStatus(host("127.0.0.1"), [])?.label).toBe("Só esta máquina");
    expect(sectionStatus(host("0.0.0.0"), [])?.label).toBe("Aberto à rede local");
  });

  it("motores: o Claude pelo pacote e pela trava; a geração pelo Lovable", () => {
    const claude = secao("claude", []);
    expect(sectionStatus(claude, [motor({ id: "claude", available: false })])?.label).toBe("Não instalado");
    expect(sectionStatus(claude, [motor({ id: "claude", details: { enabled: true } })])?.label).toBe("Uso liberado");
    expect(sectionStatus(claude, [motor({ id: "claude", details: { enabled: false } })])?.label).toBe("Uso desligado");
    expect(sectionStatus(secao("generation", []), [motor({ id: "lovable", available: false })])?.label).toBe(
      "Lovable não conectado",
    );
  });
});

describe("tokenValidity", () => {
  const agora = Date.parse("2026-10-14T12:00:00Z");

  it("diz a data de vencimento, e avisa quando venceu ou está perto", () => {
    expect(tokenValidity(null, agora)).toEqual({ ok: true, text: "Token sem data de validade." });
    expect(tokenValidity("2027-03-12T15:00:00Z", agora)).toEqual({ ok: true, text: "O token vence em 12/03/2027." });
    expect(tokenValidity("2026-10-20T15:00:00Z", agora).ok).toBe("warn");
    expect(tokenValidity("2026-10-01T15:00:00Z", agora).ok).toBe(false);
  });
});
