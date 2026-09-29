import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readSettings, validateSettings, writeSettings } from "./service.js";
import { SETTING_FIELDS } from "./schema.js";

/*
 * A tela de configuração lê e grava o `.env`. Os testes nunca tocam no `.env`
 * do projeto: a gravação vai para um arquivo temporário, e as variáveis do
 * processo mexidas aqui voltam ao que eram.
 */

const chaves = ["GITHUB_TOKEN", "SERVER_HOST", "PANEL_ACCESS_TOKEN", "DEV_AREA_FTP_PASSWORD", "AI_API_KEY", "PORT"];
let salvo = {};

beforeEach(() => {
  salvo = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const [k, v] of Object.entries(salvo)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("readSettings", () => {
  it("segredo nunca sai em claro: só se está definido e a dica", () => {
    process.env.GITHUB_TOKEN = "github_pat_abcdefghijklmnop1234";
    const campo = readSettings()
      .sections.flatMap((s) => s.fields)
      .find((f) => f.key === "GITHUB_TOKEN");
    assert.equal(campo.set, true);
    assert.equal(campo.hint, "github_pat_…1234");
    assert.equal("value" in campo, false);
    assert.equal(JSON.stringify(readSettings()).includes("abcdefghijklmnop"), false);
  });

  it("cobre todas as chaves do .env.example", () => {
    const exemplo = readFileSync(path.resolve(import.meta.dirname, "../../../.env.example"), "utf8");
    const noExemplo = [...exemplo.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    const faltando = noExemplo.filter((k) => !SETTING_FIELDS.has(k));
    assert.deepEqual(faltando, []);
  });
});

describe("validateSettings", () => {
  it("valida pelo tipo e pela regra do campo, e recusa chave desconhecida", () => {
    const r = validateSettings({
      GITHUB_TOKEN: "ghp_antigo",
      PORT: "70000",
      DEV_AREA_URL: "http://sem-https.com",
      QUALQUER_COISA: "x",
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.GITHUB_TOKEN, /github_pat_/);
    assert.match(r.errors.PORT, /Máximo/);
    assert.match(r.errors.DEV_AREA_URL, /https/);
    assert.match(r.errors.QUALQUER_COISA, /desconhecida/);
  });

  it("normaliza número e liga/desliga", () => {
    const r = validateSettings({ PORT: " 3334 ", LOVABLE_ENABLE_GENERATION: true, DEV_AREA_FTP_PORT: "" });
    assert.deepEqual(r, { ok: true, values: { PORT: "3334", LOVABLE_ENABLE_GENERATION: "1", DEV_AREA_FTP_PORT: "" } });
  });

  it("não aceita quebra de linha — ela injetaria outra variável no .env", () => {
    const r = validateSettings({ DEV_AREA_FTP_PASSWORD: "senha\nPANEL_ACCESS_TOKEN=x" });
    assert.equal(r.ok, false);
  });

  it("campo obrigatório não pode ser apagado", () => {
    const r = validateSettings({ DRIVE_ROOT_FOLDER_ID: null });
    assert.match(r.errors.DRIVE_ROOT_FOLDER_ID, /obrigatório/);
  });

  it("painel aberto para a rede exige a chave do administrador", () => {
    process.env.PANEL_ACCESS_TOKEN = "";
    assert.equal(validateSettings({ SERVER_HOST: "0.0.0.0" }).ok, false);
    process.env.SERVER_HOST = "0.0.0.0";
    process.env.PANEL_ACCESS_TOKEN = "uma-chave-bem-comprida-aqui";
    // Apagar a chave com a rede aberta também é recusado.
    const r = validateSettings({ PANEL_ACCESS_TOKEN: "" });
    assert.match(r.errors.PANEL_ACCESS_TOKEN, /obrigatória/);
  });

  it("o motor próprio ainda não pode ser escolhido", () => {
    assert.equal(validateSettings({ GENERATION_ENGINE: "own" }).ok, false);
    assert.equal(validateSettings({ GENERATION_ENGINE: "lovable" }).ok, true);
  });

  it("a chave de IA precisa ter o formato do provedor", () => {
    assert.equal(validateSettings({ AI_API_KEY: "chave-qualquer" }).ok, false);
    assert.equal(validateSettings({ AI_API_KEY: "sk-ant-api03-abcdefghijklmnop" }).ok, true);
  });
});

describe("writeSettings", () => {
  it("grava preservando o resto do arquivo e diz o que pede reinício", () => {
    const pasta = mkdtempSync(path.join(tmpdir(), "painel-env-"));
    const arquivo = path.join(pasta, ".env");
    writeFileSync(arquivo, "# comentário\nGITHUB_ORG=org\nPORT=3333\n");
    try {
      const r = writeSettings({ PORT: "3334", DEV_AREA_FTP_PASSWORD: 'com "aspas" e espaço' }, arquivo);
      assert.deepEqual(r.restartRequired, ["PORT"]);
      const conteudo = readFileSync(arquivo, "utf8");
      assert.match(conteudo, /^# comentário$/m);
      assert.match(conteudo, /^GITHUB_ORG=org$/m);
      assert.match(conteudo, /^PORT=3334$/m);
      assert.match(conteudo, /^DEV_AREA_FTP_PASSWORD="com \\"aspas\\" e espaço"$/m);
      assert.equal(process.env.PORT, "3334");
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});

describe("secretHint", () => {
  it("senha não aparece: no máximo os dois últimos caracteres", async () => {
    const { secretHint } = await import("./service.js");
    assert.equal(secretHint("jZbMsenhaSecreta4ryS"), "••••yS");
    assert.equal(secretHint("curta"), "••••");
    assert.equal(secretHint("github_pat_abcdefghijklmnop1234"), "github_pat_…1234");
    assert.equal(secretHint("sk-ant-api03-abcdefghijklmnop"), "sk-a…mnop");
    assert.equal(secretHint(""), "");
  });
});
