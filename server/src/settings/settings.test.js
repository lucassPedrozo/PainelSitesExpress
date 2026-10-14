import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { claudeConfig, config } from "../config.js";
import { readSettings, validateSettings, writeSettings } from "./service.js";
import { SETTING_FIELDS } from "./schema.js";

/*
 * A tela de configuração lê e grava o `.env`. Os testes nunca tocam no `.env`
 * do projeto: a gravação vai para um arquivo temporário, e as variáveis do
 * processo mexidas aqui voltam ao que eram.
 */

const chaves = [
  "GITHUB_TOKEN",
  "SERVER_HOST",
  "PANEL_ACCESS_TOKEN",
  "DEV_AREA_FTP_PASSWORD",
  "AI_API_KEY",
  "PORT",
  "CLAUDE_ENABLE_GENERATION",
  "CLAUDE_HUMAN_APPROVAL",
  "CLAUDE_MODEL",
  "CLAUDE_REASONING_EFFORT",
  "CLAUDE_REVIEW_ROUNDS",
  "CLAUDE_PARALLEL_ADJUSTMENTS",
  "CLAUDE_ART_DIRECTION",
  "CLAUDE_MOTION",
];
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

  it("o motor próprio ainda não pode ser escolhido; o Claude pode vir marcado", () => {
    assert.match(validateSettings({ GENERATION_ENGINE: "own" }).errors.GENERATION_ENGINE, /ainda não está disponível/);
    assert.equal(validateSettings({ GENERATION_ENGINE: "lovable" }).ok, true);
    assert.equal(validateSettings({ GENERATION_ENGINE: "claude" }).ok, true);
    assert.equal(validateSettings({ GENERATION_ENGINE: "" }).ok, true);
    assert.equal(validateSettings({ GENERATION_ENGINE: "outro" }).ok, false);
  });

  it("a chave de IA precisa ter o formato do provedor", () => {
    assert.equal(validateSettings({ AI_API_KEY: "chave-qualquer" }).ok, false);
    assert.equal(validateSettings({ AI_API_KEY: "sk-ant-api03-abcdefghijklmnop" }).ok, true);
  });

  it("a chave do Gemini é um token sem espaço e o modelo preferido precisa ser Flash", () => {
    assert.equal(validateSettings({ GEMINI_API_KEY: "chave com espaço" }).ok, false);
    assert.equal(validateSettings({ GEMINI_API_KEY: "curta" }).ok, false);
    assert.equal(validateSettings({ GEMINI_API_KEY: "AIzaTeste-curta-demais-para-o-scanner" }).ok, true);
    assert.equal(validateSettings({ GEMINI_API_KEY: "gk.abcdefghijklmnop.qrstuvwxyz0123456789-ABCDEFGHIJ_KL" }).ok, true);
    assert.match(validateSettings({ GEMINI_MODEL: "gemini-2.5-pro" }).errors.GEMINI_MODEL, /Flash/);
    assert.match(validateSettings({ GEMINI_MODEL: "modelo inválido" }).errors.GEMINI_MODEL, /id do modelo/);
    assert.equal(validateSettings({ GEMINI_MODEL: "gemini-2.5-flash-lite" }).ok, true);
    assert.equal(validateSettings({ GEMINI_MODEL: "" }).ok, true);
  });
});

describe("Motor Claude", () => {
  /** O motivo da recusa de um campo, ou `null` quando ele passa. */
  const recusa = (chave, valor) => {
    const r = validateSettings({ [chave]: valor });
    return "errors" in r ? r.errors[chave] : null;
  };
  /** Um caminho completo fora das pastas do painel. */
  const instalado = (...partes) => path.join(path.parse(config.projectRoot).root, "programas-de-teste", ...partes);

  it("a trava vem desligada, é só liga e desliga e vale sem reiniciar", () => {
    delete process.env.CLAUDE_ENABLE_GENERATION;
    assert.equal(claudeConfig().enableGeneration, false);
    for (const chave of [
      "CLAUDE_ENABLE_GENERATION",
      "CLAUDE_HUMAN_APPROVAL",
      "CLAUDE_MODEL",
      "CLAUDE_REASONING_EFFORT",
      "CLAUDE_REVIEW_ROUNDS",
      "CLAUDE_PARALLEL_ADJUSTMENTS",
      "CLAUDE_ART_DIRECTION",
      "CLAUDE_MOTION",
      "CLAUDE_BIN",
      "CLAUDE_BROWSER_PATH",
    ]) {
      assert.ok(SETTING_FIELDS.has(chave), `${chave} está na tela de Configurações`);
      assert.equal(Boolean(SETTING_FIELDS.get(chave)?.restart), false, chave);
    }
    assert.deepEqual(validateSettings({ CLAUDE_ENABLE_GENERATION: true }), { ok: true, values: { CLAUDE_ENABLE_GENERATION: "1" } });
    assert.match(recusa("CLAUDE_ENABLE_GENERATION", "talvez"), /ligado ou desligado/);

    const pasta = mkdtempSync(path.join(tmpdir(), "painel-env-"));
    try {
      writeSettings({ CLAUDE_ENABLE_GENERATION: "1", CLAUDE_HUMAN_APPROVAL: "1", CLAUDE_MODEL: "claude-opus-5-5" }, path.join(pasta, ".env"));
      const ligado = claudeConfig();
      assert.deepEqual([ligado.enableGeneration, ligado.humanApproval, ligado.model], [true, true, "claude-opus-5-5"]);
      writeSettings({ CLAUDE_ENABLE_GENERATION: "0", CLAUDE_HUMAN_APPROVAL: "", CLAUDE_MODEL: "" }, path.join(pasta, ".env"));
      const desligado = claudeConfig();
      assert.deepEqual([desligado.enableGeneration, desligado.humanApproval, desligado.model], [false, null, ""]);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("a escolha da rota criativa tem três posições, e o modelo é só um id", () => {
    for (const valor of ["", "1", "0"]) assert.equal(recusa("CLAUDE_HUMAN_APPROVAL", valor), null, JSON.stringify(valor));
    assert.match(recusa("CLAUDE_HUMAN_APPROVAL", "sim"), /Opção inválida/);
    for (const valor of ["claude-opus-5-5", "sonnet", "opus[1m]", ""]) assert.equal(recusa("CLAUDE_MODEL", valor), null, valor);
    // O modelo vira um argumento do claude: nada que pareça outra opção dele.
    for (const valor of ["--dangerously-skip-permissions", "opus --resume x", "modelo;rm"]) {
      assert.match(recusa("CLAUDE_MODEL", valor), /id ou o apelido do modelo/, valor);
    }
  });

  it("esforço, rodadas, direção de arte e movimento: listas fechadas, com o vazio deixando a escolha com o motor", () => {
    const aceitos = {
      CLAUDE_REASONING_EFFORT: ["", "low", "medium", "high", "xhigh", "max"],
      CLAUDE_REVIEW_ROUNDS: ["", "1", "2", "3", "4"],
      CLAUDE_ART_DIRECTION: ["", "sobria", "autoral", "ousada"],
      CLAUDE_MOTION: ["", "discreto", "expressivo", "cinematografico"],
    };
    for (const [chave, valores] of Object.entries(aceitos)) {
      assert.deepEqual(SETTING_FIELDS.get(chave).options.map((opcao) => opcao.value), valores, chave);
      for (const valor of valores) assert.equal(recusa(chave, valor), null, `${chave}=${valor}`);
    }
    // O esforço vira um argumento do claude, e as outras três seguem para o motor: nada fora da lista entra.
    for (const [chave, valor] of [["CLAUDE_REASONING_EFFORT", "ultra"], ["CLAUDE_REASONING_EFFORT", "--resume"], ["CLAUDE_REVIEW_ROUNDS", "5"], ["CLAUDE_REVIEW_ROUNDS", "0"], ["CLAUDE_ART_DIRECTION", "neutra"], ["CLAUDE_MOTION", "cinematográfico"]]) {
      assert.match(recusa(chave, valor), /Opção inválida/, `${chave}=${valor}`);
    }

    const pasta = mkdtempSync(path.join(tmpdir(), "painel-env-"));
    try {
      const arquivo = path.join(pasta, ".env");
      writeSettings({ CLAUDE_REASONING_EFFORT: "max", CLAUDE_REVIEW_ROUNDS: "3", CLAUDE_ART_DIRECTION: "ousada", CLAUDE_MOTION: "cinematografico" }, arquivo);
      const escolhido = claudeConfig();
      assert.deepEqual([escolhido.effort, escolhido.reviewRounds, escolhido.artDirection, escolhido.motion], ["max", 3, "ousada", "cinematografico"]);
      // Vale na hora: apagar devolve cada escolha ao motor.
      writeSettings({ CLAUDE_REASONING_EFFORT: "", CLAUDE_REVIEW_ROUNDS: "", CLAUDE_ART_DIRECTION: "", CLAUDE_MOTION: "" }, arquivo);
      const padrao = claudeConfig();
      assert.deepEqual([padrao.effort, padrao.reviewRounds, padrao.artDirection, padrao.motion], ["", null, "", ""]);
      // Um `.env` editado à mão com um número de rodadas que o motor não aceita vale como vazio.
      for (const valor of ["0", "5", "2.5", "duas"]) {
        process.env.CLAUDE_REVIEW_ROUNDS = valor;
        assert.equal(claudeConfig().reviewRounds, null, valor);
      }
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("o programa do Claude Code: só o claude, instalado nesta máquina e fora das pastas do painel", () => {
    assert.equal(recusa("CLAUDE_BIN", "claude"), null, "o do PATH");
    assert.equal(recusa("CLAUDE_BIN", instalado("bin", "claude")), null);
    assert.equal(recusa("CLAUDE_BIN", instalado("bin", "claude.exe")), null);
    assert.equal(recusa("CLAUDE_BIN", ""), null, "vazio volta ao padrão");

    assert.match(recusa("CLAUDE_BIN", "node"), /claude ou claude\.exe/);
    assert.match(recusa("CLAUDE_BIN", instalado("bin", "powershell.exe")), /claude ou claude\.exe/);
    // O claude falso dos testes é um script, e script o painel roda pelo Node: pela tela, nunca.
    assert.match(recusa("CLAUDE_BIN", instalado("claude-falso.mjs")), /claude ou claude\.exe/);
    assert.match(recusa("CLAUDE_BIN", "claude --dangerously-skip-permissions"), /claude ou claude\.exe/);
    assert.match(recusa("CLAUDE_BIN", '"claude"'), /sem aspas nem argumentos/);
    assert.match(recusa("CLAUDE_BIN", "bin/claude"), /caminho completo/);
    assert.match(recusa("CLAUDE_BIN", "\\\\servidor\\pasta\\claude.exe"), /caminho de rede/);
    assert.match(recusa("CLAUDE_BIN", "//servidor/pasta/claude"), /caminho de rede/);
    // O material que um cliente manda mora na pasta de dados: um "claude.exe" enviado por ali não vira o motor.
    const noMaterial = path.join(config.dataDir, "joinvixable", "trabalho", "clientes", "x", "material", "claude.exe");
    assert.match(recusa("CLAUDE_BIN", noMaterial), /dentro das pastas do painel/);
    assert.match(recusa("CLAUDE_BIN", path.join(config.projectRoot, "claude")), /dentro das pastas do painel/);
  });

  it("o navegador das capturas: Chrome, Edge ou Chromium, pelo caminho completo", () => {
    for (const nome of ["chrome.exe", "msedge.exe", "chromium", "google-chrome", "Google Chrome"]) {
      assert.equal(recusa("CLAUDE_BROWSER_PATH", instalado("navegador", nome)), null, nome);
    }
    assert.match(recusa("CLAUDE_BROWSER_PATH", "chrome.exe"), /caminho completo de um Chrome, Edge ou Chromium/);
    assert.match(recusa("CLAUDE_BROWSER_PATH", instalado("navegador", "cmd.exe")), /um Chrome, Edge ou Chromium/);
    assert.match(recusa("CLAUDE_BROWSER_PATH", path.join(config.dataDir, "chrome.exe")), /dentro das pastas do painel/);
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
    assert.equal(secretHint("AIzaTeste-curta-demais-para-o-scanner"), "AIza…nner");
    assert.equal(secretHint(""), "");
  });
});
