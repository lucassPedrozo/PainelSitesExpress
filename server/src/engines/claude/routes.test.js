import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

/**
 * As rotas do motor Claude na API de verdade — política de rede, sessão,
 * permissões e tratador de erros —, com pasta de dados temporária, o claude
 * falso no lugar do executável e um motor de mentira no lugar do pacote
 * (`joinvixable/` vive num repositório privado: o CI não o tem).
 *
 * Nenhum teste chama o claude de verdade, o Drive, o GitHub ou o Pixabay.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-claude-rotas-"));
const dataDir = path.join(raiz, "dados");
const MASTER_KEY = "chave-mestra-de-teste-0123456789";

process.env.PANEL_DATA_DIR = dataDir;
process.env.PANEL_ACCESS_TOKEN = MASTER_KEY;
process.env.PREVIEW_WATCH_INTERVAL_MS = "0";

const { createApp } = await import("../../app.js");
const { createZip } = await import("../../images/zip.js");
const { writeFile: gravarNoProjeto } = await import("../../local/storage.js");
const registro = await import("../../store/claude.js");
const { linkGeneration, listGenerations, setGenerationDevArea } = await import("../../store/generations.js");
const { caminhoDeRegra } = await import("./command.js");
const { CLAUDE_FALSO, SEGREDOS_DO_PAINEL } = await import("./fixtures/apoio.mjs");
const { criarMotorFalso } = await import("./fixtures/motor-falso.mjs");
const { caminhosProtegidos, criarServicoClaude, usarServicoClaude } = await import("./service.js");
const { caminhosDoMotor } = await import("./workspace.js");

const engineDir = path.join(raiz, "pacote");
fs.mkdirSync(path.join(engineDir, "node_modules"), { recursive: true });
const caminhos = caminhosDoMotor({ dataDir, dirMotor: engineDir });
const chamadasEm = path.join(raiz, "chamadas.jsonl");

/** O que o teste controla: a trava do `.env`, o que o claude falso faz e o que ele "vaza". */
const controle = {
  trava: false,
  cenario: "ok",
  texto: "",
  /** Quanto o claude falso demora para responder, em ms. */
  atraso: "",
  /** O que as Configurações dizem do modelo e da aprovação da direção criativa. */
  modelo: "",
  aprovacao: /** @type {boolean | null} */ (null),
  /** O que o build e a validação do motor respondem. */
  validacao: { ok: true, texto: "BUILD OK. VALIDAÇÃO OK." },
  /** A área de aprovação está configurada no `.env`? */
  area: false,
};
const { motor, estado: doMotor } = criarMotorFalso({ trabalho: caminhos.trabalho });

/** Um serviço novo sobre a mesma pasta de dados: é o painel subindo de novo. */
const novoServico = (extras = {}) =>
  criarServicoClaude({
    ...extras,
    dataDir,
    motor,
    lerConfig: () => ({
      enableGeneration: controle.trava,
      bin: CLAUDE_FALSO,
      model: controle.modelo,
      browserPath: "",
      humanApproval: controle.aprovacao,
      engineDir,
    }),
    // O ambiente do painel, com os segredos dele.
    base: () => ({ ...process.env, ...SEGREDOS_DO_PAINEL }),
    ambienteExtra: () => ({
      CLAUDE_FALSO_CENARIO: controle.cenario,
      CLAUDE_FALSO_REGISTRO: chamadasEm,
      CLAUDE_FALSO_TEXTO: controle.texto,
      CLAUDE_FALSO_ATRASO_MS: controle.atraso,
    }),
    validar: async () => controle.validacao,
    log: () => undefined,
  });

let servico = novoServico();
usarServicoClaude(servico);

const chamadas = () =>
  fs.existsSync(chamadasEm)
    ? fs.readFileSync(chamadasEm, "utf8").trim().split("\n").map((linha) => JSON.parse(linha))
    : [];

let base;
let parar;
/** Sessões: a chave mestra, uma chave que só organiza e uma que gera mas não publica. */
const sessoes = { admin: "", organiza: "", gera: "" };

const quietly = async (fn) => {
  const { error, log, warn } = console;
  console.error = () => {};
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, log, warn });
  }
};

/** @param {string} pathname @param {{ method?: string, json?: unknown, como?: keyof typeof sessoes, headers?: Record<string, string> }} [init] */
const call = (pathname, { method = "GET", json, como = "admin", headers = {} } = {}) =>
  quietly(async () => {
    const response = await fetch(base + pathname, {
      method,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(sessoes[como] ? { Cookie: sessoes[como] } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let body = null;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      body = bytes;
    }
    return {
      status: response.status,
      body,
      type: response.headers.get("content-type"),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null,
    };
  });

const entrar = async (chave) =>
  (await call("/api/session", { method: "POST", como: undefined, headers: { Authorization: `Bearer ${chave}` } })).cookie;

const esperarAte = async (condicao, ms = 30_000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await condicao();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error("a condição não chegou a tempo");
    await new Promise((ok) => setTimeout(ok, 100));
  }
};

/** Cria um projeto no painel e põe arquivos nele, como "Enviar arquivos" faria. */
async function novoProjeto(nome, arquivos) {
  const criado = await call("/api/projects", { method: "POST", json: { name: nome, kind: "site" } });
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  const projectId = criado.body.project.id;
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    await gravarNoProjeto(projectId, caminho, Readable.from([Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo)]));
  }
  return projectId;
}

const detalhe = async (projectId) => (await call(`/api/projects/${projectId}/claude`)).body;

/** Espera o pedido do projeto sair da fila e a execução dele ficar registrada no resumo. */
const esperarFim = (projectId, anterior = null) =>
  esperarAte(async () => {
    const d = await detalhe(projectId);
    return !d.project?.queue && d.project?.lastRun && d.project.lastRun.id !== anterior ? d : null;
  });

const pastaDe = async (projectId) => (await registro.getClaudeProject(projectId)).folder;
const noTrabalho = (...partes) => path.join(caminhos.trabalho, ...partes);

before(async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const ouvindo = app.listen(0, "127.0.0.1", () => resolve(ouvindo));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  parar = () => new Promise((resolve) => server.close(resolve));

  sessoes.admin = await entrar(MASTER_KEY);
  for (const [nome, permissions] of [
    ["organiza", ["organizar"]],
    ["gera", ["organizar", "gerar"]],
  ]) {
    const criada = await call("/api/access-keys", { method: "POST", json: { name: nome, permissions } });
    assert.equal(criada.status, 201, JSON.stringify(criada.body));
    sessoes[nome] = await entrar(criada.body.key);
  }
});

after(async () => {
  await servico.parar().catch(() => undefined);
  usarServicoClaude(undefined);
  await parar?.();
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Um JPEG e um PNG que não são imagens de verdade: o painel só copia os bytes. */
const FOTO = Buffer.from("bytes-de-uma-foto");

describe("motor Claude — nada que custa acontece por acaso", () => {
  let projectId;

  before(async () => {
    projectId = await novoProjeto("voltagem.com.br", {
      "informacoes.txt": "Voltagem Auto Elétrica. Rua das Palmeiras, 120, Vila Velha.",
      "fotos/Fachada da Loja.JPG": FOTO,
    });
  });

  it("sem permissão, sem confirmação, com pedido inválido e com a trava desligada: 403, 428, 400 e 423 — e o claude não roda", async () => {
    const semPermissao = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", como: "organiza", json: { confirm: true } });
    assert.equal(semPermissao.status, 403);
    assert.match(semPermissao.body.error, /não tem permissão para gerar sites/);

    const semConfirmar = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: {} });
    assert.equal(semConfirmar.status, 428);
    assert.match(semConfirmar.body.error, /confirm: true/);
    assert.deepEqual(doMotor.consultas, [], "recusado antes de o motor ser consultado");

    const invalido = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true, fileIds: "todos" } });
    assert.equal(invalido.status, 400);
    const deOutroProjeto = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true, fileIds: ["id-de-outro-lugar"] } });
    assert.deepEqual([deOutroProjeto.status, deOutroProjeto.body.error], [400, "Arquivo selecionado não é deste projeto"]);

    const travado = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true } });
    assert.equal(travado.status, 423);
    assert.match(travado.body.error, /Liberar o uso do Claude.*Configurações → Motor Claude/);

    // As outras rotas que gastam respondem igual.
    for (const rota of ["generate", "adjust", "continue", "approve"]) {
      const semChave = await call(`/api/projects/${projectId}/claude/${rota}`, { method: "POST", como: "organiza", json: { confirm: true, pedido: "x" } });
      const semConfirmacao = await call(`/api/projects/${projectId}/claude/${rota}`, { method: "POST", json: { pedido: "x" } });
      assert.deepEqual([semChave.status, semConfirmacao.status], [403, 428], rota);
    }
    for (const rota of ["/api/claude/queue/resume", "/api/claude/queue/interrupted/x/resume"]) {
      assert.equal((await call(rota, { method: "POST", como: "organiza", json: { confirm: true } })).status, 403, rota);
      assert.equal((await call(rota, { method: "POST", json: {} })).status, 428, rota);
    }
    assert.equal((await call("/api/claude/queue/resume", { method: "POST", json: { confirm: true } })).status, 423);

    // Nada foi disparado, copiado ou enfileirado.
    assert.deepEqual(chamadas(), []);
    const status = await call("/api/claude/status");
    assert.deepEqual(
      [status.body.installed, status.body.generation.enabled, status.body.queue.running, status.body.queue.waiting],
      [true, false, null, []],
    );
    assert.equal(fs.existsSync(noTrabalho("clientes", await pastaDe(projectId), "material")), false);
    assert.equal(fs.existsSync(caminhos.trava), false);
  });

  it("o ensaio funciona com a trava desligada: plano, frase e comando, sem copiar nem enfileirar", async () => {
    const material = await call(`/api/projects/${projectId}/claude/material`);
    assert.equal(material.status, 200);
    assert.deepEqual(
      material.body.files.map((file) => [file.name, file.folder, file.kind, file.recommended]).sort(),
      [["Fachada da Loja.JPG", "fotos", "image", true], ["informacoes.txt", null, "doc", true]],
    );
    assert.deepEqual([material.body.engine, material.body.generation.enabled], ["claude", false]);

    const ensaio = await call(`/api/projects/${projectId}/claude/briefing/preview`, {
      method: "POST",
      json: { observacoes: "Destaque o atendimento\n  a domicílio." },
    });
    assert.equal(ensaio.status, 200, JSON.stringify(ensaio.body));
    const pasta = await pastaDe(projectId);
    assert.match(pasta, /^voltagem-com-br-[0-9a-f]{4}$/, "a pasta de trabalho é o painel que escolhe");
    assert.deepEqual(
      [ensaio.body.dryRun, ensaio.body.plan.folder, ensaio.body.plan.phrase, ensaio.body.plan.files.length, ensaio.body.generation.enabled],
      [true, pasta, `gere o briefing do cliente ${pasta}\nObservações: Destaque o atendimento a domicílio.`, 2, false],
    );
    // O comando que rodaria, para a pessoa ver: as permissões do contrato, e nenhum caminho desta máquina.
    assert.match(ensaio.body.command, /^node "?[^"]*claude-falso\.mjs"? -p --output-format stream-json/);
    assert.match(ensaio.body.command, /--permission-mode dontAsk --permission-prompts none --setting-sources user/);
    assert.ok(ensaio.body.command.includes(`"Edit(./clientes/${pasta}/**)"`));
    assert.ok(!ensaio.body.command.includes(raiz) && !ensaio.body.command.includes(raiz.replace(/\\/g, "/")), ensaio.body.command);
    assert.match(ensaio.body.command, /<dados do motor>/);

    // Ainda sem briefing, a conferência do motor diz em que pasta procurou: na tela, sem o caminho desta máquina.
    const semBriefing = await detalhe(projectId);
    assert.deepEqual([semBriefing.review.existe, semBriefing.review.briefing], [false, null]);
    assert.match(semBriefing.review.erros[0], /^Nenhum arquivo \.json em <pasta do motor>/);
    const naTela = JSON.stringify(semBriefing);
    assert.ok(!naTela.includes(raiz) && !naTela.includes(raiz.replace(/\\/g, "\\\\")) && !naTela.includes(raiz.replace(/\\/g, "/")), naTela);

    const semPermissao = await call(`/api/projects/${projectId}/claude/briefing/preview`, { method: "POST", como: "organiza", json: {} });
    assert.equal(semPermissao.status, 403);
    assert.deepEqual(chamadas(), []);
    assert.equal((await call("/api/claude/status")).body.queue.waiting.length, 0);
  });

  it("projeto que não existe e projeto que nunca passou pelo motor", async () => {
    assert.equal((await call(`/api/projects/${encodeURIComponent("x' or '1'='1")}/claude`)).status, 404);
    const vazio = await novoProjeto("sem-nada.com.br", {});
    const d = await detalhe(vazio);
    assert.deepEqual([d.project, d.review, d.site, d.runs], [null, null, null, []]);
    const semMaterial = await call(`/api/projects/${vazio}/claude/briefing/preview`, { method: "POST", json: {} });
    assert.equal(semMaterial.status, 400);
    assert.match(semMaterial.body.error, /Não há material para analisar/);
    for (const rota of ["generate", "adjust", "continue", "approve"]) {
      const r = await call(`/api/projects/${vazio}/claude/${rota}`, { method: "POST", json: { confirm: true, pedido: "x" } });
      assert.equal(r.status, 409, rota);
    }
  });
});

describe("motor Claude — na tela de Configurações", () => {
  let projectId;
  const testar = (init = {}) => call("/api/settings/check/claude", { method: "POST", json: { confirm: true }, ...init });

  before(async () => {
    projectId = await novoProjeto("teste-do-login.com.br", { "sobre.txt": "Conta Simples MEI." });
  });

  after(() => {
    Object.assign(controle, { trava: false, cenario: "ok", atraso: "", modelo: "", aprovacao: null });
  });

  it("o estado do motor: versão do claude, navegador, modelo e comando — sem disparar nada", async () => {
    const antes = chamadas().length;
    assert.equal((await call("/api/settings/claude", { como: "gera" })).status, 403, "só quem configura o painel");

    const { status, body } = await call("/api/settings/claude");
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual([body.installed, body.reason, body.generation.enabled], [true, null, false]);
    assert.deepEqual(body.claude, { found: true, version: "0.0.0 (claude falso)", custom: true });
    // Do navegador, só o nome do programa: o caminho é desta máquina.
    assert.deepEqual(body.browser, { found: true, name: "chrome.exe", custom: false });
    assert.deepEqual(body.model, { effective: "claude-sonnet-5-5", expected: "claude-sonnet-5-5", custom: false });
    assert.deepEqual(body.humanApproval, { enabled: false, custom: false });
    assert.match(body.command, /claude-falso\.mjs"? -p --output-format stream-json --verbose --model claude-sonnet-5-5 /);
    assert.match(body.command, /--permission-mode dontAsk --permission-prompts none --setting-sources user/);
    const texto = JSON.stringify(body);
    assert.ok(!texto.includes(raiz) && !texto.includes(raiz.replace(/\\/g, "/")) && !texto.includes("Program Files"), texto);

    // O que as Configurações mudam aparece no estado e no comando.
    Object.assign(controle, { modelo: "claude-opus-5-5", aprovacao: true });
    const mudado = (await call("/api/settings/claude")).body;
    assert.deepEqual(mudado.model, { effective: "claude-opus-5-5", expected: "claude-sonnet-5-5", custom: true });
    assert.equal(mudado.humanApproval.custom, true);
    assert.match(mudado.command, /--model claude-opus-5-5 /);
    Object.assign(controle, { modelo: "", aprovacao: null });

    assert.equal(chamadas().length, antes, "nenhum claude -p");
    assert.equal(fs.existsSync(caminhos.trava), false);
  });

  it("os motores na tela: o Claude aparece instalado, com a trava como está", async () => {
    const { body } = await call("/api/settings");
    const claude = body.engines.find((motor) => motor.id === "claude");
    assert.deepEqual([claude.available, claude.reason, claude.details], [true, null, { installed: true, enabled: false }]);
    const secao = body.sections.find((section) => section.id === "claude");
    assert.deepEqual(
      secao.fields.map((campo) => campo.key),
      ["CLAUDE_ENABLE_GENERATION", "CLAUDE_HUMAN_APPROVAL", "CLAUDE_MODEL", "CLAUDE_BIN", "CLAUDE_BROWSER_PATH"],
    );
    // Vale na hora: o serviço relê a configuração a cada uso.
    assert.deepEqual(secao.fields.map((campo) => campo.restart), [false, false, false, false, false]);
  });

  it("Testar Claude: 403 sem a permissão, 428 sem confirmar e 423 com a trava desligada — e o claude não roda", async () => {
    const antes = chamadas().length;
    controle.trava = false;
    const semPermissao = await testar({ como: "gera" });
    assert.equal(semPermissao.status, 403);
    assert.match(semPermissao.body.error, /não tem permissão para configurar o painel/);
    const semConfirmar = await testar({ json: {} });
    assert.equal(semConfirmar.status, 428);
    assert.match(semConfirmar.body.error, /confirm: true/);
    const travado = await testar();
    assert.equal(travado.status, 423);
    assert.match(travado.body.error, /Liberar o uso do Claude.*Configurações → Motor Claude/);
    assert.equal(chamadas().length, antes);
    assert.equal(fs.existsSync(caminhos.trava), false);
  });

  it("Testar Claude com a trava ligada: a resposta do login da assinatura, o login que falhou e a chave de API", { timeout: 90_000 }, async () => {
    Object.assign(controle, { trava: true, cenario: "ok" });
    const antes = chamadas().length;
    const ok = await testar();
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.ok, ok.body.apiKeySource, ok.body.estimatedCostUsd], [true, "none", 0.4242]);
    assert.match(ok.body.message, /^O Claude Code respondeu ".*" pelo login da assinatura\.$/);
    assert.equal(chamadas().length, antes + 1, "um claude -p, e só um");
    const chamada = chamadas().at(-1);
    assert.equal(chamada.entrada, "Responda apenas com a palavra: ok");
    assert.ok(chamada.args.includes("--no-session-persistence"));
    // O teste não é a execução de um projeto: nada entra na fila nem no registro.
    const estado = (await call("/api/claude/status")).body;
    assert.deepEqual([estado.queue.running, estado.queue.waiting], [null, []]);
    assert.equal(fs.existsSync(caminhos.trava), false, "a trava de uma execução por vez é solta no fim");

    controle.cenario = "auth";
    const semLogin = await testar();
    assert.deepEqual([semLogin.status, semLogin.body.ok], [200, false]);
    assert.match(semLogin.body.message, /Falha de autenticação do Claude Code/);

    controle.cenario = "chave";
    const comChave = await testar();
    assert.deepEqual([comChave.status, comChave.body.ok], [200, false]);
    assert.match(comChave.body.message, /está usando uma chave de API \(apiKeySource="ANTHROPIC_API_KEY"\)/);
    controle.cenario = "ok";
  });

  it("o teste e a fila não se atropelam: no meio do teste nenhum pedido começa, e com um pedido rodando o teste não roda", { timeout: 120_000 }, async () => {
    Object.assign(controle, { trava: true, cenario: "ok", atraso: "2500" });
    const antes = chamadas().length;
    const emCurso = testar();
    await esperarAte(() => fs.existsSync(caminhos.trava));
    const pedido = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true } });
    assert.equal(pedido.status, 409, JSON.stringify(pedido.body));
    assert.match(pedido.body.error, /O teste do Claude está em andamento/);
    const outroTeste = await testar();
    assert.deepEqual([outroTeste.status, outroTeste.body.error], [409, "O teste do Claude já está em andamento."]);
    assert.equal((await emCurso).body.ok, true);
    controle.atraso = "";
    assert.equal(chamadas().length, antes + 1);
    // Recusado antes de copiar o material: nada do projeto foi para a pasta de trabalho.
    assert.equal(fs.existsSync(noTrabalho("clientes", await pastaDe(projectId), "material")), false);

    controle.cenario = "lento";
    const briefing = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true } });
    assert.equal(briefing.status, 201, JSON.stringify(briefing.body));
    await esperarAte(async () => (await call("/api/claude/status")).body.queue.running);
    const ocupado = await testar();
    assert.equal(ocupado.status, 409);
    assert.match(ocupado.body.error, /Há uma execução do Claude em andamento/);
    assert.deepEqual((await call("/api/claude/queue/cancel", { method: "POST", json: {} })).body, { cancelled: true });
    await esperarFim(projectId);
    controle.cenario = "ok";
  });
});

describe("motor Claude — do briefing ao ajuste, pelo painel", () => {
  let projectId;
  let pasta;

  before(async () => {
    projectId = await novoProjeto("Estúdio Raiz", {
      "informacoes.txt": "Estúdio Raiz — tatuagem e piercing em Vitória.",
      "fotos/Fachada da Loja.JPG": FOTO,
      // O mesmo nome de foto, depois de limpo, em outra pasta: no site as duas iriam para o mesmo lugar.
      "outras/Fachada-da-loja.jpeg": FOTO,
      "apresentacao.mp4": Buffer.from("video"),
      "fotos-extras.zip": createZip([
        { path: "logo.png", bytes: FOTO },
        { path: "textos/sobre.txt", bytes: Buffer.from("Desde 2014.") },
        { path: "making-of.mp4", bytes: Buffer.from("video") },
      ]),
    });
    controle.trava = true;
  });

  it("gerar o briefing: copia o material marcado, enfileira e o card passa a mostrar o briefing pronto", { timeout: 90_000 }, async () => {
    const material = (await call(`/api/projects/${projectId}/claude/material`)).body;
    const video = material.files.find((file) => file.name === "apresentacao.mp4");
    assert.deepEqual([video.recommended, video.blockedReason], [false, "O Claude não lê vídeo."]);
    const marcarVideo = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true, fileIds: [video.id] } });
    assert.deepEqual([marcarVideo.status, /O Claude não lê vídeo/.test(marcarVideo.body.error)], [400, true]);

    controle.cenario = "briefing-simples";
    const pedido = await call(`/api/projects/${projectId}/claude/briefing`, {
      method: "POST",
      json: { confirm: true, texto: "Estúdio Raiz. Av. Central, 45, Vitória.", observacoes: "Destaque os orçamentos pelo WhatsApp." },
    });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.body));
    pasta = await pastaDe(projectId);
    assert.deepEqual([pedido.body.item.tipo, pedido.body.item.projectId, pedido.body.material.arquivos], ["analisar", projectId, 6]);
    assert.match(pedido.body.material.pulados.join("\n"), /fotos-extras\.zip › making-of\.mp4: O Claude não lê vídeo/);

    const d = await esperarFim(projectId);
    assert.deepEqual(
      [d.project.lastRun.type, d.project.lastRun.status, d.project.briefing.state, d.project.briefing.errors, d.project.slug, d.project.queue],
      ["analisar", "sucesso", "ok", 0, null, null],
    );
    assert.equal(d.review.briefing.empresa.nome, "Voltagem Auto Elétrica");
    assert.deepEqual([d.project.material.files, d.runs.length, d.runs[0].tipo, d.runs[0].status], [6, 1, "analisar", "sucesso"]);
    // ESTIMATIVA DO CLAUDE CODE: o que o claude informou, guardado como estimativa.
    assert.equal(d.runs[0].custoEstimadoUsd, 0.4242);

    // O que o agente achou na pasta do cliente quando começou: o material, já no lugar.
    assert.deepEqual(d.review.briefing.material_visto, [
      "material/fotos-extras/logo.png",
      "material/fotos-extras/textos/sobre.txt",
      "material/fotos/fachada-da-loja.jpg",
      "material/informacoes-do-site.txt",
      "material/informacoes.txt",
      "material/outras/fachada-da-loja-2.jpg",
    ], "zip aberto, vídeo de fora, fotos com nome de site e sem repetição");
    assert.equal(fs.readFileSync(noTrabalho("clientes", pasta, "material", "informacoes-do-site.txt"), "utf8"), "Estúdio Raiz. Av. Central, 45, Vitória.\n");
    assert.deepEqual(fs.readdirSync(path.join(caminhos.dados, "entrada")), [], "nada sobra da montagem da cópia");

    // O pedido foi pelo stdin, com a frase do runbook; o claude rodou da pasta de trabalho.
    const chamada = chamadas().at(-1);
    assert.equal(chamada.entrada, `gere o briefing do cliente ${pasta}\nObservações: Destaque os orçamentos pelo WhatsApp.`);
    assert.equal(fs.realpathSync(chamada.cwd), fs.realpathSync(caminhos.trabalho));
    assert.ok(chamada.args.includes(`Edit(./clientes/${pasta}/**)`));
    // Nenhum segredo do painel chegou ao ambiente do agente.
    for (const nome of Object.keys(SEGREDOS_DO_PAINEL)) {
      assert.ok(!chamada.variaveis.some((v) => v.toUpperCase() === nome.toUpperCase()), `${nome} não chega ao claude`);
    }
    assert.deepEqual([chamada.painel, chamada.memoria, chamada.chave, chamada.token], ["1", "1", null, null]);

    // O que o agente não lê: o banco do painel e o que mais houver na pasta de dados, fora da pasta de trabalho.
    const negadas = chamada.configuracoes.permissions.deny;
    for (const alvo of [path.join(dataDir, "painel.json"), path.join(dataDir, "projetos"), caminhos.execucoes]) {
      assert.ok(negadas.includes(`Read(${caminhoDeRegra(alvo)})`) && negadas.includes(`Read(${caminhoDeRegra(alvo)}/**)`), alvo);
    }
    assert.ok(negadas.some((regra) => /\/\.env\)$/.test(regra)), "o .env do painel");
    const trabalho = caminhoDeRegra(caminhos.trabalho);
    assert.ok(!negadas.some((regra) => trabalho.startsWith(regra.slice(5).replace(/(\/\*\*)?\)$/, "") + "/") || regra.includes(`${trabalho})`)), "nenhuma regra cobre a pasta de trabalho");
  });

  it("corrigir o briefing e as opções na tela: gravados sem gastar, com a conferência na resposta", async () => {
    const antes = chamadas().length;
    const semPermissao = await call(`/api/projects/${projectId}/claude/briefing`, { method: "PUT", como: "organiza", json: { briefing: {} } });
    assert.equal(semPermissao.status, 403);
    assert.equal((await call(`/api/projects/${projectId}/claude/briefing`, { method: "PUT", json: { briefing: ["lista"] } })).status, 400);

    const quebrado = await call(`/api/projects/${projectId}/claude/briefing`, { method: "PUT", json: { briefing: { empresa: { nome: "Estúdio Raiz" } } } });
    assert.deepEqual([quebrado.status, quebrado.body.review.erros], [200, ["empresa.ramo: obrigatório"]]);
    assert.equal((await detalhe(projectId)).project.briefing.state, "refused");
    // Briefing com pendência não gera site: recusado antes da fila.
    const recusado = await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", json: { confirm: true } });
    assert.equal(recusado.status, 409);
    assert.match(recusado.body.error, /O briefing tem 1 pendência\(s\)[\s\S]*1\. empresa\.ramo: obrigatório/);

    const corrigido = await call(`/api/projects/${projectId}/claude/briefing`, {
      method: "PUT",
      json: { briefing: { empresa: { nome: "Estúdio Raiz", ramo: "tatuagem e piercing" }, servicos: [{ nome: "Tatuagem" }], contato: {} } },
    });
    assert.deepEqual([corrigido.status, corrigido.body.review.erros], [200, []]);
    assert.equal((await detalhe(projectId)).project.briefing.state, "ok");

    const opcoes = await call(`/api/projects/${projectId}/claude/options`, { method: "PUT", json: { opcoes: { multiplas_paginas: true, skills: [] } } });
    assert.deepEqual([opcoes.status, opcoes.body.review.opcoes.multiplas_paginas], [200, true]);
    const skillRuim = await call(`/api/projects/${projectId}/claude/options`, { method: "PUT", json: { opcoes: { skills: ["nao-existe"] } } });
    assert.deepEqual([skillRuim.status, skillRuim.body.error], [409, "Skill não encontrada: nao-existe."]);
    assert.equal((await call(`/api/projects/${projectId}/claude/options`, { method: "PUT", json: {} })).status, 400);
    assert.equal(chamadas().length, antes, "nada disso dispara o claude");
  });

  it("revisar e gerar: o ensaio mostra o comando, a geração cria o site e ele entra na lista de sites do projeto", { timeout: 90_000 }, async () => {
    const ensaio = await call(`/api/projects/${projectId}/claude/generate/preview`, { method: "POST", json: {} });
    assert.deepEqual(
      [ensaio.status, ensaio.body.dryRun, ensaio.body.plan.phrase, ensaio.body.plan.errors, ensaio.body.plan.previousSites],
      [200, true, `gere o site do cliente ${pasta}`, [], []],
    );
    assert.match(ensaio.body.command, /--effort xhigh/);
    assert.ok(!ensaio.body.command.includes("Edit(./clientes/"), "fora do briefing o agente não escreve na pasta do cliente");

    controle.cenario = "site";
    const anterior = (await detalhe(projectId)).project.lastRun.id;
    const pedido = await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", json: { confirm: true } });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.body));
    const d = await esperarFim(projectId, anterior);
    assert.deepEqual(
      [d.project.lastRun.type, d.project.lastRun.status, d.project.slug, d.project.site.delivered, d.project.site.openStage],
      ["cliente", "sucesso", pasta, true, null],
    );
    assert.equal(chamadas().at(-1).entrada, `gere o site do cliente ${pasta}`);

    // O site validado vira um site do projeto, como os dos outros motores — sem nunca ser consultado no Lovable.
    const sites = await esperarAte(async () => {
      const lista = (await listGenerations())[projectId] ?? [];
      return lista.length ? lista : null;
    });
    assert.equal(sites.length, 1);
    assert.match(sites[0].id, /^ext-[0-9a-f]{12}$/);
    assert.deepEqual(
      [sites[0].engine, sites[0].claudeSlug, sites[0].origin, sites[0].agentState, sites[0].repoFullName, sites[0].devArea],
      ["claude", pasta, "panel", "done", null, null],
    );

    // Gerar de novo sem dizer que é do zero: recusado antes de gastar.
    const antes = chamadas().length;
    const repetido = await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", json: { confirm: true } });
    assert.equal(repetido.status, 409);
    assert.match(repetido.body.error, /já tem um site gerado pelo Claude/);
    assert.equal(chamadas().length, antes);
  });

  it("ajustar: retoma a sessão do site, e a versão nova fica registrada no mesmo site", { timeout: 90_000 }, async () => {
    assert.equal((await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "   " } })).status, 400);
    const longo = await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "x".repeat(4001) } });
    assert.equal(longo.status, 400);

    const [antes] = (await listGenerations())[projectId];
    controle.cenario = "ok";
    const anterior = (await detalhe(projectId)).project.lastRun.id;
    // As imagens do pedido sobem antes, cruas, e ficam na pasta do site — fora do que vai ao GitHub.
    const subir = (query, corpo, como = "admin") =>
      fetch(`${base}/api/projects/${projectId}/claude/adjust/attachments?${new URLSearchParams(query)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", ...(sessoes[como] ? { Cookie: sessoes[como] } : {}) },
        body: corpo,
      }).then(async (resposta) => ({ status: resposta.status, body: await resposta.json().catch(() => null) }));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
    assert.equal((await subir({ name: "nota.png" }, Buffer.from("isto não é uma imagem"))).status, 415);
    assert.equal((await subir({ name: "a.png", draft: "../../fora" }, png)).status, 400);
    const captura = await subir({ name: "Captura de Tela (topo).PNG" }, png);
    assert.equal(captura.status, 201, JSON.stringify(captura.body));
    assert.deepEqual(
      [captura.body.file, captura.body.name, captura.body.size],
      ["01-captura-de-tela-topo.png", "Captura de Tela (topo).PNG", png.length],
    );
    const logo = await subir({ name: "..\\../logo nova.jpg", draft: captura.body.draft }, png);
    assert.deepEqual([logo.status, logo.body.file, logo.body.name], [201, "02-logo-nova.png", "logo nova.jpg"], "o tipo vem do conteúdo, e o nome perde o caminho");
    const dirAnexos = noTrabalho("projects", pasta, ".session", "anexos");
    assert.deepEqual(fs.readdirSync(path.join(dirAnexos, captura.body.draft)).sort(), ["01-captura-de-tela-topo.png", "02-logo-nova.png"]);

    // Imagem que não está no painel: o pedido é recusado antes de entrar na fila.
    const semImagem = await call(`/api/projects/${projectId}/claude/adjust`, {
      method: "POST",
      json: { confirm: true, pedido: "troque a logo", anexos: { draft: captura.body.draft, items: [{ file: "03-outra.png", name: "outra.png", use: false }] } },
    });
    assert.equal(semImagem.status, 400);
    assert.equal(fs.existsSync(path.join(dirAnexos, "pendente.json")), false);

    const pedido = await call(`/api/projects/${projectId}/claude/adjust`, {
      method: "POST",
      json: {
        confirm: true,
        pedido: "troque a descrição dos serviços",
        anexos: {
          draft: captura.body.draft,
          items: [
            { file: captura.body.file, name: captura.body.name, use: false },
            { file: logo.body.file, name: logo.body.name, use: true },
          ],
        },
      },
    });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.body));
    // O texto do pedido não muda: quem entrega as imagens ao agente é o motor, ao abrir a etapa.
    assert.equal(pedido.body.item.frase, `ajuste o site ${pasta}: troque a descrição dos serviços`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirAnexos, "pendente.json"), "utf8")), {
      pasta: captura.body.draft,
      itens: [
        { arquivo: "01-captura-de-tela-topo.png", nome: "Captura de Tela (topo).PNG", usar: false },
        { arquivo: "02-logo-nova.png", nome: "logo nova.jpg", usar: true },
      ],
    });

    // Enquanto roda, a tela acompanha por consulta com cursor.
    const d = await esperarFim(projectId, anterior);
    assert.deepEqual([d.project.lastRun.type, d.project.lastRun.status, d.runs.length], ["ajuste", "sucesso", 3]);
    const chamada = chamadas().at(-1);
    assert.equal(chamada.entrada, `ajuste o site ${pasta}: troque a descrição dos serviços`);
    assert.equal(chamada.args[chamada.args.indexOf("--resume") + 1], "sessao-falsa-1", "retoma a sessão da geração");
    assert.equal(d.runs[0].retomou, true);

    const eventos = await call("/api/claude/events");
    assert.equal(eventos.body.reset, true);
    assert.ok(eventos.body.events.length >= 4, JSON.stringify(eventos.body));
    assert.ok(eventos.body.events.every((evento) => evento.bruto === undefined && evento.legiveis.every((l) => typeof l.tipo === "string" && typeof l.texto === "string")), "só linhas legíveis: o evento cru não vai à tela");
    assert.match(JSON.stringify(eventos.body.events), /Etapa ajuste/);
    const depois = await call(`/api/claude/events?cursor=${encodeURIComponent(eventos.body.cursor)}`);
    assert.deepEqual([depois.body.reset, depois.body.events, depois.body.cursor], [false, [], eventos.body.cursor]);
    assert.equal((await call("/api/claude/events?cursor=outra-epoca:x:5")).body.reset, true);

    // O log de uma execução, refeito do stream guardado; só pelo projeto dela.
    const log = await call(`/api/projects/${projectId}/claude/runs/${d.runs[0].id}/log`);
    assert.equal(log.status, 200);
    assert.ok(log.body.lines.some((linha) => linha.tipo === "resultado"));
    const outro = await novoProjeto("outro.com.br", {});
    assert.equal((await call(`/api/projects/${outro}/claude/runs/${d.runs[0].id}/log`)).status, 404);
    assert.equal((await call(`/api/projects/${projectId}/claude/runs/..%2F..%2Fpainel/log`)).status, 404);

    const sites = (await listGenerations())[projectId];
    assert.equal(sites.length, 1, "o ajuste não cria outro site");
    assert.ok(sites[0].claudeValidatedAt >= antes.claudeValidatedAt && sites[0].id === antes.id);
  });

  it("o que o agente escreve passa pelo filtro: caminho da máquina e segredo não chegam à tela", { timeout: 90_000 }, async () => {
    controle.cenario = "vaza";
    controle.texto = SEGREDOS_DO_PAINEL.GITHUB_TOKEN;
    const anterior = (await detalhe(projectId)).project.lastRun.id;
    const pedido = await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "qualquer coisa" } });
    assert.equal(pedido.status, 201);
    const d = await esperarFim(projectId, anterior);

    const eventos = await call("/api/claude/events");
    const log = await call(`/api/projects/${projectId}/claude/runs/${d.runs[0].id}/log`);
    const naTela = JSON.stringify([eventos.body, log.body, d.project.lastRun, d.runs]);
    assert.ok(!naTela.includes(SEGREDOS_DO_PAINEL.GITHUB_TOKEN), "o segredo é coberto");
    assert.ok(!naTela.includes(raiz) && !naTela.includes(raiz.replace(/\\/g, "/")) && !naTela.includes(raiz.replace(/\\/g, "\\\\")), "o caminho vira rótulo");
    assert.match(naTela, /<pasta do motor>/);
    assert.match(naTela, /•••/);
    // No disco, fora do alcance do navegador, o stream bruto fica inteiro.
    const bruto = fs.readFileSync(path.join(caminhos.execucoes, `${d.runs[0].id}.jsonl`), "utf8");
    assert.ok(bruto.includes(SEGREDOS_DO_PAINEL.GITHUB_TOKEN));
    controle.texto = "";
  });

  it("telas e imagens: só imagem, só de dentro da pasta de trabalho, e nunca o site gerado", async () => {
    const capturas = await call(`/api/projects/${projectId}/claude/captures/telas`, { method: "POST", json: {} });
    assert.deepEqual([capturas.status, capturas.body.telas], [200, ["desktop-topo.png"]]);
    assert.equal((await call(`/api/projects/${projectId}/claude/captures/outra`, { method: "POST", json: {} })).status, 404);
    assert.equal((await call(`/api/projects/${projectId}/claude/captures/telas`, { method: "POST", como: "organiza", json: {} })).status, 403);

    const tela = await call(`/api/projects/${projectId}/claude/images/telas?path=desktop-topo.png`);
    assert.deepEqual([tela.status, tela.type, tela.body.subarray(1, 4).toString()], [200, "image/png", "PNG"]);
    const foto = await call(`/api/projects/${projectId}/claude/images/material?path=${encodeURIComponent("material/fotos/fachada-da-loja.jpg")}`);
    assert.deepEqual([foto.status, foto.type, foto.body.toString()], [200, "image/jpeg", "bytes-de-uma-foto"]);

    fs.mkdirSync(noTrabalho("projects", pasta, "dist"), { recursive: true });
    fs.writeFileSync(noTrabalho("projects", pasta, "dist", "index.html"), "<script>alert(1)</script>");
    fs.writeFileSync(noTrabalho("clientes", pasta, "material", "foto.svg"), "<svg onload='alert(1)'/>");
    // Uma foto de outro cliente: o briefing (que o modelo escreve) não pode apontar o painel para ela.
    fs.mkdirSync(noTrabalho("clientes", "outro-cliente", "material"), { recursive: true });
    fs.writeFileSync(noTrabalho("clientes", "outro-cliente", "material", "foto.png"), FOTO);
    for (const [tipo, caminho] of [
      ["material", "../outro-cliente/material/foto.png"],
      ["telas", "../session.json"],
      ["telas", "../../dist/index.html"],
      ["material", "../../../painel.json"],
      ["material", "material/informacoes-do-site.txt"],
      ["material", "material/foto.svg"],
      ["material", "projeto.json"],
      ["material", ""],
      ["miniatura", "../../../painel.json"],
      ["dist", "index.html"],
    ]) {
      const r = await call(`/api/projects/${projectId}/claude/images/${tipo}?path=${encodeURIComponent(caminho)}`);
      assert.equal(r.status, 404, `${tipo} ${caminho}`);
    }

    const validacao = await call(`/api/projects/${projectId}/claude/validate`, { method: "POST", json: {} });
    assert.deepEqual([validacao.status, validacao.body], [200, { ok: true, texto: "BUILD OK. VALIDAÇÃO OK." }]);
  });

  it("direção para aprovar, etapa aberta e geração do zero", { timeout: 120_000 }, async () => {
    // O site parou esperando a aprovação de uma pessoa: status próprio, nem sucesso nem falha.
    doMotor.projetos[pasta] = { aguardandoAprovacao: true, entregue: false };
    controle.cenario = "ok";
    let anterior = (await detalhe(projectId)).project.lastRun.id;
    await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "refaça a direção" } });
    let d = await esperarFim(projectId, anterior);
    assert.deepEqual([d.project.lastRun.status, d.project.site.awaitingApproval, d.site.brief], ["aguardando_aprovacao", true, "Arquétipo: vibrante-direto"]);

    controle.trava = false;
    assert.equal((await call(`/api/projects/${projectId}/claude/approve`, { method: "POST", json: { confirm: true } })).status, 423);
    assert.equal(doMotor.projetos[pasta].aguardandoAprovacao, true, "com a trava desligada a aprovação não acontece pela metade");
    controle.trava = true;

    // Aprovar segue direto para a geração — e ela termina com a etapa aberta: é falha, com continuar e abortar.
    anterior = d.project.lastRun.id;
    const aprovado = await call(`/api/projects/${projectId}/claude/approve`, { method: "POST", json: { confirm: true } });
    assert.deepEqual([aprovado.status, aprovado.body.aprovado, aprovado.body.item.frase], [201, true, `continue o site ${pasta}`]);
    doMotor.projetos[pasta] = { etapaAberta: "geracao", entregue: false };
    d = await esperarFim(projectId, anterior);
    assert.deepEqual([d.project.lastRun.type, d.project.lastRun.status, d.project.site.openStage], ["continuar", "falha", "geracao"]);
    assert.match(d.project.lastRun.message, /etapa "geracao" aberta/);
    assert.equal((await call(`/api/projects/${projectId}/claude/approve`, { method: "POST", json: { confirm: true } })).status, 409);

    const abortado = await call(`/api/projects/${projectId}/claude/abort`, { method: "POST", json: { motivo: "desistência pela tela" } });
    assert.deepEqual([abortado.status, abortado.body.site.etapaAberta], [200, null]);
    assert.equal((await detalhe(projectId)).project.site.openStage, null);

    // Outro site do zero: só com `refazer`, e vira um segundo site do projeto.
    doMotor.projetos[pasta] = {};
    controle.cenario = "site";
    anterior = (await detalhe(projectId)).project.lastRun.id;
    const doZero = await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", json: { confirm: true, refazer: true } });
    assert.equal(doZero.status, 201, JSON.stringify(doZero.body));
    d = await esperarFim(projectId, anterior);
    assert.deepEqual([d.project.lastRun.status, d.project.slug], ["sucesso", `${pasta}-2`]);
    assert.equal(chamadas().at(-1).entrada, `gere o site do cliente ${pasta} com --refazer`);
    const sites = await esperarAte(async () => {
      const lista = (await listGenerations())[projectId] ?? [];
      return lista.length === 2 ? lista : null;
    });
    assert.deepEqual(sites.map((site) => site.claudeSlug), [pasta, `${pasta}-2`]);
  });
});

describe("motor Claude — a fila", () => {
  let a;
  let b;

  before(async () => {
    a = await novoProjeto("fila-a.com.br", { "sobre.txt": "A" });
    b = await novoProjeto("fila-b.com.br", { "sobre.txt": "B" });
    controle.trava = true;
  });

  it("um pedido por projeto e uma execução por vez; quem espera pode sair, quem roda é cancelado", { timeout: 120_000 }, async () => {
    controle.cenario = "lento";
    const primeiro = await call(`/api/projects/${a}/claude/briefing`, { method: "POST", json: { confirm: true } });
    assert.equal(primeiro.status, 201, JSON.stringify(primeiro.body));
    const repetido = await call(`/api/projects/${a}/claude/briefing`, { method: "POST", json: { confirm: true } });
    assert.equal(repetido.status, 409);
    assert.match(repetido.body.error, /Este projeto (tem uma execução do Claude em andamento|já tem um pedido esperando)/);
    // Corrigir o briefing no meio da execução também não: é o arquivo que o agente está escrevendo.
    assert.equal((await call(`/api/projects/${a}/claude/briefing`, { method: "PUT", json: { briefing: { empresa: {} } } })).status, 409);

    const segundo = await call(`/api/projects/${b}/claude/briefing`, { method: "POST", como: "gera", json: { confirm: true } });
    assert.equal(segundo.status, 201, JSON.stringify(segundo.body));
    const status = await esperarAte(async () => {
      const s = (await call("/api/claude/status")).body;
      return s.queue.running && s.queue.waiting.length === 1 ? s : null;
    });
    assert.deepEqual(
      [status.queue.running.projectId, status.queue.waiting[0].projectId, status.queue.waiting[0].por, status.queue.paused],
      [a, b, "gera", false],
    );
    const resumoDeB = (await detalhe(b)).project.queue;
    assert.deepEqual([resumoDeB.estado, resumoDeB.posicao, resumoDeB.tipo], ["esperando", 1, "analisar"]);
    // Quem pediu sem poder publicar: o site dele não segue sozinho para o GitHub.
    assert.deepEqual((await registro.loadClaudeQueue()).map((item) => [item.extra.projectId, item.extra.publicar]), [[a, true], [b, false]]);

    assert.equal((await call(`/api/claude/queue/${status.queue.waiting[0].id}`, { method: "DELETE", como: "organiza" })).status, 403);
    const removido = await call(`/api/claude/queue/${status.queue.waiting[0].id}`, { method: "DELETE" });
    assert.deepEqual([removido.status, removido.body.removed.projectId], [200, b]);
    assert.equal((await call(`/api/claude/queue/${status.queue.waiting[0].id}`, { method: "DELETE" })).status, 404);
    assert.equal((await detalhe(b)).project.queue, null);

    assert.equal((await call("/api/claude/queue/cancel", { method: "POST", como: "organiza", json: {} })).status, 403);
    const anterior = (await detalhe(a)).project.lastRun?.id ?? null;
    const cancelado = await call("/api/claude/queue/cancel", { method: "POST", json: {} });
    assert.deepEqual(cancelado.body, { cancelled: true });
    const d = await esperarFim(a, anterior);
    assert.deepEqual([d.project.lastRun.status, d.project.lastRun.message], ["cancelada", "Execução cancelada."]);
    assert.deepEqual((await call("/api/claude/queue/cancel", { method: "POST", json: {} })).body, { cancelled: false });
    assert.equal(chamadas().filter((chamada) => chamada.entrada.includes("fila-b")).length, 0, "o removido nunca rodou");
  });

  it("depois de um reinício a fila volta pausada e o que rodava aparece como interrompido", { timeout: 120_000 }, async () => {
    // O painel cai com o site de A rodando e o briefing de B esperando.
    const pastaA = await pastaDe(a);
    const pastaB = await pastaDe(b);
    fs.mkdirSync(noTrabalho("projects", pastaA, ".session"), { recursive: true });
    fs.writeFileSync(noTrabalho("projects", pastaA, ".session", "session.json"), "{}");
    doMotor.briefings[pastaA] = { dados: { empresa: { nome: "A", ramo: "a" } }, erros: [], avisos: [] };
    await registro.patchClaudeProject(a, { slug: pastaA });
    await registro.recordClaudeRun({ id: "exec-que-rodava", data: new Date().toISOString(), tipo: "cliente", pedido: `gere o site do cliente ${pastaA}`, status: "rodando", pid: 999_999, projectId: a, slug: pastaA });
    await registro.saveClaudeQueue([
      { id: "item-a", pedido: { tipo: "cliente", pasta: pastaA }, frase: `gere o site do cliente ${pastaA}`, criadoEm: "2026-01-01T10:00:00.000Z", estado: "rodando", slug: pastaA, sessionId: "sessao-falsa-1", execucaoId: "exec-que-rodava", extra: { projectId: a, por: "Ana" } },
      { id: "item-b", pedido: { tipo: "analisar", pasta: pastaB }, frase: `gere o briefing do cliente ${pastaB}`, criadoEm: "2026-01-01T10:01:00.000Z", estado: "esperando", extra: { projectId: b, por: "Bia" } },
    ]);
    const antes = chamadas().length;
    servico = novoServico();
    usarServicoClaude(servico);

    const status = (await call("/api/claude/status")).body;
    assert.deepEqual(
      [status.queue.paused, status.queue.running, status.queue.waiting.map((item) => item.projectId), status.queue.interrupted.map((item) => [item.projectId, item.estado, item.slug])],
      [true, null, [b], [[a, "interrompida", pastaA]]],
    );
    assert.equal((await registro.getClaudeRun("exec-que-rodava")).status, "interrompida", "a execução que rodava fica registrada como interrompida");
    assert.deepEqual([(await detalhe(a)).project.queue.estado, (await detalhe(b)).project.queue.estado], ["interrompida", "esperando"]);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(chamadas().length, antes, "reabrir o painel não roda nada sozinho");

    // Projeto com execução interrompida não aceita outro pedido antes de ela ser resolvida.
    const bloqueado = await call(`/api/projects/${a}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "x" } });
    assert.equal(bloqueado.status, 409);
    assert.match(bloqueado.body.error, /execução interrompida/);

    // A interrompida já tinha criado o site: retomar vira "continue o site" — que o motor recusa se não há o que continuar.
    const semOQueContinuar = await call("/api/claude/queue/interrupted/item-a/resume", { method: "POST", json: { confirm: true } });
    assert.equal(semOQueContinuar.status, 409);
    assert.match(semOQueContinuar.body.error, /já foi entregue/);
    assert.equal((await call("/api/claude/status")).body.queue.interrupted.length, 1, "recusada, ela continua na lista");
    doMotor.projetos[pastaA] = { etapaAberta: "geracao", entregue: false };

    // Retomar gasta: pede confirmação e a trava ligada — a fila e a execução interrompida.
    assert.equal((await call("/api/claude/queue/resume", { method: "POST", json: {} })).status, 428);
    controle.trava = false;
    assert.equal((await call("/api/claude/queue/resume", { method: "POST", json: { confirm: true } })).status, 423);
    assert.equal((await call("/api/claude/queue/interrupted/item-a/resume", { method: "POST", json: { confirm: true } })).status, 423);
    const aindaParada = (await call("/api/claude/status")).body.queue;
    assert.deepEqual([aindaParada.paused, aindaParada.interrupted.length, chamadas().length], [true, 1, antes]);
    controle.trava = true;

    controle.cenario = "briefing-simples";
    const retomada = await call("/api/claude/queue/resume", { method: "POST", json: { confirm: true } });
    assert.deepEqual([retomada.status, retomada.body], [200, { paused: false }]);
    const dB = await esperarFim(b);
    assert.deepEqual([dB.project.lastRun.type, dB.project.lastRun.status], ["analisar", "sucesso"]);

    controle.cenario = "ok";
    const anteriorDeA = (await registro.getClaudeProject(a)).lastRun?.id ?? null;
    const continuar = await call("/api/claude/queue/interrupted/item-a/resume", { method: "POST", json: { confirm: true } });
    assert.deepEqual([continuar.status, continuar.body.item.frase, continuar.body.item.tipo], [200, `continue o site ${pastaA}`, "continuar"]);
    const dA = await esperarFim(a, anteriorDeA);
    // O claude saiu com código 0, mas a etapa continuou aberta: não é sucesso.
    assert.deepEqual([dA.project.lastRun.type, dA.project.lastRun.status, dA.project.site.openStage], ["continuar", "falha", "geracao"]);
    assert.equal(chamadas().at(-1).entrada, `continue o site ${pastaA}`);
    assert.deepEqual((await call("/api/claude/status")).body.queue.interrupted, []);
    assert.equal((await call("/api/claude/queue/interrupted/item-a/resume", { method: "POST", json: { confirm: true } })).status, 404);
  });

  it("descartar uma interrompida a tira da lista sem rodar nada", async () => {
    const pastaB = await pastaDe(b);
    await registro.saveClaudeQueue([
      { id: "item-velho", pedido: { tipo: "analisar", pasta: pastaB }, frase: `gere o briefing do cliente ${pastaB}`, criadoEm: "2026-01-01T10:00:00.000Z", estado: "rodando", extra: { projectId: b } },
    ]);
    const antes = chamadas().length;
    servico = novoServico();
    usarServicoClaude(servico);
    const status = (await call("/api/claude/status")).body;
    assert.deepEqual([status.queue.paused, status.queue.interrupted.length], [false, 1], "sem ninguém esperando, não há o que pausar");
    assert.equal((await call("/api/claude/queue/interrupted/item-velho", { method: "DELETE", como: "organiza" })).status, 403);
    const descartada = await call("/api/claude/queue/interrupted/item-velho", { method: "DELETE" });
    assert.deepEqual([descartada.status, descartada.body.discarded.id], [200, "item-velho"]);
    assert.equal((await call("/api/claude/queue/interrupted/item-velho", { method: "DELETE" })).status, 404);
    assert.deepEqual([(await call("/api/claude/status")).body.queue.interrupted, chamadas().length], [[], antes]);
  });
});

describe("motor Claude — site feito na ferramenta antiga, trazido para o motor", () => {
  let projectId;
  const sessao = { slug: "nome-antigo", criadoEm: "2026-09-01T10:00:00.000Z", aprovado: true, registrado: true, buildOk: true, seqRequisicao: 9, travados: { "src/lib/utils.ts": "abc" }, etapas: [{ n: 1, etapa: "revisao", status: "concluida" }] };

  before(async () => {
    Object.assign(controle, { trava: true, cenario: "ok" });
    projectId = await novoProjeto("site-antigo.com.br", {
      "site/.session/session.json": JSON.stringify(sessao),
      // As conversas da ferramenta antiga: outra pasta, outro modo de permissão.
      "site/.session/headless.json": JSON.stringify({ execucoes: [{ id: "antiga-1", tipo: "cliente", status: "sucesso", session_id: "sessao-da-ferramenta-antiga", total_cost_usd: 1.5 }] }),
      "site/.session/telas/desktop-1.png": FOTO,
      "site/content.json": '{"site":{"titulo":"Antigo"}}',
      "site/package.json": '{"name":"site","scripts":{"build":"vite build"}}',
      "site/briefing.json": "{}",
      "site/src/App.tsx": "export default function App() { return null }",
      "site/dist/index.html": "<html></html>",
      "site/node_modules/x/.session/session.json": "{}",
      "site/.env": "SEGREDO=1",
      "leia-me.txt": "fora do site",
    });
  });

  it("o plano acha a pasta do site pela sessão dele; projeto do Drive não tem o que trazer", async () => {
    const plano = await call(`/api/projects/${projectId}/claude/adopt`);
    assert.deepEqual([plano.status, plano.body.possible, plano.body.sources.map((s) => [s.path, s.files])], [200, true, [["site", 7]]]);
    const fontes = await call(`/api/projects/${projectId}/site-sources`);
    assert.equal(fontes.body.engineSite, true);
    const semSite = await novoProjeto("so-material.com.br", { "sobre.txt": "x" });
    assert.deepEqual([(await call(`/api/projects/${semSite}/claude/adopt`)).body.possible, (await call(`/api/projects/${semSite}/site-sources`)).body.engineSite], [false, false]);
    assert.equal((await call(`/api/projects/${semSite}/claude/adopt`, { method: "POST", json: {} })).status, 422);
  });

  it("trazer: copia o site com o nome que o painel escolhe, sem build, dependências nem .env — e sem disparar o Claude", async () => {
    const antes = chamadas().length;
    assert.equal((await call(`/api/projects/${projectId}/claude/adopt`, { method: "POST", como: "organiza", json: {} })).status, 403);
    assert.equal((await call(`/api/projects/${projectId}/claude/adopt`, { method: "POST", json: { sourcePath: "outra" } })).status, 400);
    // O projeto já tinha o site registrado como "de fora", com repositório: é esse registro que muda.
    const vinculado = await linkGeneration(projectId, { id: "ext-0123456789ab", repoFullName: "org/site-antigo-com-br", by: "Administrador" });

    const r = await call(`/api/projects/${projectId}/claude/adopt`, { method: "POST", json: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const pasta = await pastaDe(projectId);
    assert.deepEqual([r.body.slug, r.body.files, r.body.stages], [pasta, 7, 1]);
    assert.match(pasta, /^site-antigo-com-br-[0-9a-f]{4}$/);
    const doSite = (...p) => noTrabalho("projects", pasta, ...p);
    assert.equal(JSON.parse(fs.readFileSync(doSite(".session", "session.json"), "utf8")).slug, pasta, "a sessão passa a apontar para a pasta nova");
    assert.deepEqual(
      ["content.json", "briefing.json", "src/App.tsx", ".session/telas/desktop-1.png", "dist", "node_modules", ".env"].map((p) => fs.existsSync(doSite(...p.split("/")))),
      [true, true, true, true, false, false, false],
    );
    assert.equal(chamadas().length, antes, "trazer não gasta nada");

    const site = (await listGenerations())[projectId].at(-1);
    assert.deepEqual([site.id, site.engine, site.claudeSlug, site.repoFullName, site.claudePushedAt], [vinculado.id, "claude", pasta, "org/site-antigo-com-br", null]);
    const d = await detalhe(projectId);
    assert.deepEqual([d.project.slug, d.project.site.delivered, d.site.slug], [pasta, true, pasta]);
    assert.equal((await call(`/api/projects/${projectId}/claude/adopt`, { method: "POST", json: {} })).status, 409);
    assert.equal((await call(`/api/projects/${projectId}/claude/adopt`)).body.possible, false);
  });

  it("trazido, o site aceita pedido de ajuste pelo painel", { timeout: 90_000 }, async () => {
    const pasta = await pastaDe(projectId);
    const pedido = await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "troque o telefone do rodapé" } });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.body));
    const d = await esperarFim(projectId);
    assert.deepEqual([d.project.lastRun.type, d.project.lastRun.status], ["ajuste", "sucesso"]);
    const chamada = chamadas().at(-1);
    assert.equal(chamada.entrada, `ajuste o site ${pasta}: troque o telefone do rodapé`);
    // A conversa da ferramenta antiga não é retomada: o primeiro ajuste abre uma nova, com o runbook e as permissões de hoje.
    assert.equal(chamada.args.includes("--resume"), false);
    const historico = JSON.parse(fs.readFileSync(noTrabalho("projects", pasta, ".session", "headless.json"), "utf8")).execucoes;
    assert.deepEqual([historico[0].session_id, historico[0].sessao_da_ferramenta_antiga, historico[0].total_cost_usd], [undefined, "sessao-da-ferramenta-antiga", 1.5]);
  });

  it("sessão que não é a da ferramenta é recusada, e nada fica na pasta de trabalho", async () => {
    const ruim = await novoProjeto("sessao-ruim.com.br", { ".session/session.json": '{"slug":"x"}', "content.json": "{}", "package.json": "{}" });
    const r = await call(`/api/projects/${ruim}/claude/adopt`, { method: "POST", json: {} });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /não tem o formato da ferramenta/);
    assert.equal(fs.existsSync(noTrabalho("projects", await pastaDe(ruim))), false);
  });
});

describe("o que o agente não lê", () => {
  const painel = path.resolve(os.tmpdir(), "um-painel-qualquer");
  const dados = path.join(painel, "server", "data");
  const doMotorAqui = caminhosDoMotor({ dataDir: dados, dirMotor: path.join(painel, "joinvixable") });
  const listar = (dir) =>
    ({
      [dados]: ["painel.json", "sessions.json", "lovable-auth.json", "backups", "projetos", "joinvixable"],
      [doMotorAqui.dados]: ["trabalho", "execucoes", "runbook.md", "configuracoes-do-agente.json", "rodando.lock", "entrada"],
    })[dir] ?? [];

  it("o .env, a chave da service account e a pasta de dados fora da pasta de trabalho", () => {
    const lista = caminhosProtegidos({
      segredos: [path.join(painel, ".env"), path.join(painel, "chave.json"), null, ""],
      dataDir: dados,
      caminhos: doMotorAqui,
      listar,
    });
    assert.deepEqual(lista, [
      path.join(painel, ".env"),
      path.join(painel, "chave.json"),
      ...["painel.json", "sessions.json", "lovable-auth.json", "backups", "projetos"].map((nome) => path.join(dados, nome)),
      ...["execucoes", "runbook.md", "configuracoes-do-agente.json", "rodando.lock", "entrada"].map((nome) => path.join(doMotorAqui.dados, nome)),
    ]);
  });

  it("nada que contenha a pasta de trabalho entra: a negação venceria a permissão e cegaria o agente", () => {
    const lista = caminhosProtegidos({
      // A chave da service account sem caminho configurado resolve para a raiz do painel.
      segredos: [painel, dados, doMotorAqui.trabalho],
      dataDir: dados,
      caminhos: doMotorAqui,
      listar: () => {
        throw new Error("pasta ainda não existe");
      },
    });
    assert.deepEqual(lista, []);
  });
});

describe("motor Claude — o site validado vai ao GitHub", () => {
  /** Um GitHub de mentira: guarda os repositórios criados e o que cada commit levou. */
  const gh = { repos: new Map(), criados: [], commits: [] };
  const github = {
    conta: () => ({ githubToken: "github_pat_teste_nao_usado", organization: "org-de-teste" }),
    config: () => ({}),
    getRepository: async (_config, { owner, repo }) => gh.repos.get(`${owner}/${repo}`) ?? null,
    createOrgRepository: async (_config, { organization, name, isPrivate }) => {
      const repo = { full_name: `${organization}/${name}`, name, default_branch: "main", html_url: `https://github.com/${organization}/${name}`, private: isPrivate };
      gh.repos.set(repo.full_name, repo);
      gh.criados.push(repo);
      return repo;
    },
    commitSite: async ({ owner, repo, branch, message, files }) => {
      const lidos = {};
      for (const file of files) lidos[file.path] = (await file.read()).toString("utf8");
      const anterior = gh.commits.findLast((commit) => commit.repo === `${owner}/${repo}`);
      const changed = JSON.stringify(anterior?.files) !== JSON.stringify(lidos);
      gh.commits.push({ repo: `${owner}/${repo}`, branch, message, files: lidos });
      return { sha: `sha-${gh.commits.length}`, changed, uploaded: changed ? files.length : 0, total: files.length };
    },
  };
  const publicadas = [];
  const areaDeAprovacao = {
    configurada: () => controle.area,
    publicar: async (projectId, siteId, by) => {
      publicadas.push([projectId, siteId, by]);
      return setGenerationDevArea(projectId, siteId, { state: "publishing", slug: "conta-simples", url: "https://aprovacao.exemplo.com.br/conta-simples/", repoFullName: "org-de-teste/conta-simples" });
    },
    acompanhar: () => undefined,
  };

  const TEMPLATE = {
    "package.json": JSON.stringify({ name: "site", scripts: { build: "vite build" }, dependencies: { react: "18.3.1" }, devDependencies: { vite: "6.4.4" } }),
    "package-lock.json": '{"lockfileVersion":3}',
    "vite.config.ts": "export default { base: './' }",
    "index.html": '<div id="root"></div>',
    "content.json": '{"site":{"titulo":"Site em construção"}}',
  };
  const escrever = (base, arquivos) => {
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      fs.mkdirSync(path.dirname(path.join(base, caminho)), { recursive: true });
      fs.writeFileSync(path.join(base, caminho), conteudo);
    }
  };

  let projectId;
  let pasta;
  let doSite;
  const site = async () => ((await listGenerations())[projectId] ?? []).at(-1);
  const enviarComo = (como, json = {}) => call(`/api/projects/${projectId}/claude/repository`, { method: "POST", como, json });

  before(async () => {
    await servico.parar().catch(() => undefined);
    servico = novoServico({ github, areaDeAprovacao });
    usarServicoClaude(servico);
    controle.trava = true;
    controle.area = false;
    controle.validacao = { ok: true, texto: "BUILD OK. VALIDAÇÃO OK." };
    escrever(path.join(engineDir, "template"), TEMPLATE);
    projectId = await novoProjeto("conta-simples.com.br", { "sobre.txt": "Conta Simples MEI — contabilidade para MEI." });
  });

  it("gerado por quem não pode publicar: o site fica esperando o envio, e nada vai ao GitHub sozinho", { timeout: 120_000 }, async () => {
    controle.cenario = "briefing-simples";
    assert.equal((await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", como: "gera", json: { confirm: true } })).status, 201);
    let d = await esperarFim(projectId);
    pasta = await pastaDe(projectId);
    doSite = noTrabalho("projects", pasta);

    controle.cenario = "site";
    assert.equal((await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", como: "gera", json: { confirm: true } })).status, 201);
    d = await esperarFim(projectId, d.project.lastRun.id);
    assert.equal(d.project.lastRun.status, "sucesso");
    const gerado = await site();
    assert.deepEqual([gerado.engine, gerado.repoFullName, gerado.claudePushedAt, gh.commits.length, gh.criados.length], ["claude", null, null, 0, 0]);

    // O site como o motor o deixa: a cópia do template, o que o modelo escreveu e o que nunca sai daqui.
    escrever(doSite, {
      ...TEMPLATE,
      "content.json": '{"site":{"titulo":"Conta Simples MEI"}}',
      "imagens.json": "[]",
      "src/main.tsx": "import App from './App'",
      "src/App.tsx": "import { useState } from 'react'\nexport default function App() { return null }",
      "public/img/logo.png": "png",
      "briefing.json": '{"contato":{"whatsapp":"5527999990000"}}',
      "design-brief.json": "{}",
      ".session/rascunho.txt": "rascunho",
      "dist/index.html": "<html>build</html>",
    });

    const plano = await call(`/api/projects/${projectId}/claude/repository`);
    assert.equal(plano.status, 200, JSON.stringify(plano.body));
    assert.deepEqual(
      [plano.body.configured, plano.body.organization, plano.body.repoFullName, plano.body.suggestedRepoName, plano.body.files, plano.body.problems, plano.body.approvalArea],
      [true, "org-de-teste", null, "conta-simples-com-br", 9, [], false],
    );

    const semPermissao = await enviarComo("gera");
    assert.equal(semPermissao.status, 403);
    assert.match(semPermissao.body.error, /não tem permissão para publicar sites/);
    assert.equal(gh.criados.length, 0);
  });

  it("o que bloqueia o envio: validação que não passa, pacote fora do template e credencial dentro do site", async () => {
    // Arquivo travado alterado, build quebrado, site sem assinatura: a validação do motor é quem diz.
    controle.validacao = { ok: false, texto: `travado: src/main.tsx foi modificado e não pode ser. (${doSite})` };
    const invalido = await enviarComo("admin");
    assert.equal(invalido.status, 422);
    assert.match(invalido.body.error, /não passa na validação e não foi enviado:\ntravado: src\/main\.tsx foi modificado/);
    assert.ok(!invalido.body.error.includes(raiz), "o caminho da máquina não vai na mensagem");
    controle.validacao = { ok: true, texto: "BUILD OK. VALIDAÇÃO OK." };

    escrever(doSite, { "src/sections/Form.tsx": "import { z } from 'zod'" });
    const comPacote = await enviarComo("admin");
    assert.equal(comPacote.status, 422);
    assert.match(comPacote.body.error, /um pacote que o template não tem: zod \(em src\/sections\/Form\.tsx\)/);
    fs.rmSync(path.join(doSite, "src", "sections"), { recursive: true });

    escrever(doSite, { "content.json": JSON.stringify({ site: { titulo: "Conta Simples MEI" }, nota: SEGREDOS_DO_PAINEL.DEV_AREA_FTP_PASSWORD }) });
    const comSegredo = await enviarComo("admin");
    assert.equal(comSegredo.status, 422);
    assert.match(comSegredo.body.error, /content\.json contém o valor de DEV_AREA_FTP_PASSWORD/);
    assert.ok(!JSON.stringify(comSegredo.body).includes(SEGREDOS_DO_PAINEL.DEV_AREA_FTP_PASSWORD));
    assert.equal((await call(`/api/projects/${projectId}/claude/repository`)).body.problems.length, 1, "o plano já avisa, antes do clique");
    escrever(doSite, { "content.json": '{"site":{"titulo":"Conta Simples MEI"}}' });

    // Nada saiu, e o card guarda o motivo da última tentativa.
    assert.deepEqual([gh.criados.length, gh.commits.length], [0, 0]);
    const d = await detalhe(projectId);
    assert.deepEqual([d.project.push.state, /DEV_AREA_FTP_PASSWORD/.test(d.project.push.message)], ["failed", true]);
    assert.equal((await enviarComo("admin", { repoName: "nome invalido!" })).status, 400);
  });

  it("o envio: repositório novo na organização, configuração do template e só o código do site", async () => {
    const enviado = await enviarComo("admin", { repoName: "conta-simples" });
    assert.equal(enviado.status, 201, JSON.stringify(enviado.body));
    assert.deepEqual(
      [enviado.body.repository, enviado.body.commit.changed, enviado.body.commit.files, enviado.body.outdated],
      [{ fullName: "org-de-teste/conta-simples", url: "https://github.com/org-de-teste/conta-simples", created: true }, true, 9, []],
    );
    assert.match(enviado.body.warning, /área de aprovação não está configurada/);
    assert.deepEqual([gh.criados.map((repo) => [repo.name, repo.private]), publicadas], [[["conta-simples", true]], []]);

    const commit = gh.commits.at(-1);
    assert.deepEqual(Object.keys(commit.files).sort(), [
      "content.json",
      "imagens.json",
      "index.html",
      "package-lock.json",
      "package.json",
      "public/img/logo.png",
      "src/App.tsx",
      "src/main.tsx",
      "vite.config.ts",
    ]);
    assert.equal(commit.files["package.json"], TEMPLATE["package.json"], "a configuração é a do template");
    assert.match(commit.files["content.json"], /Conta Simples MEI/);
    for (const fora of ["briefing.json", "design-brief.json", ".session/rascunho.txt", "dist/index.html"]) {
      assert.ok(!(fora in commit.files), `${fora} não vai ao GitHub`);
    }

    const gerado = await site();
    assert.deepEqual([gerado.repoFullName, typeof gerado.claudePushedAt, gerado.claudePushedSha], ["org-de-teste/conta-simples", "string", "sha-1"]);
    assert.ok(gerado.claudePushedAt >= gerado.claudeValidatedAt);
    const d = await detalhe(projectId);
    assert.deepEqual([d.project.push.state, d.project.push.repoFullName, d.project.push.automatic], ["sent", "org-de-teste/conta-simples", false]);

    // De novo, sem mudança: o mesmo repositório, nenhum commit novo no site.
    const repetido = await enviarComo("admin");
    assert.deepEqual([repetido.status, repetido.body.repository.created, repetido.body.commit.changed, gh.criados.length], [200, false, false, 1]);
  });

  it("ajuste pedido por quem pode publicar: validado, o commit novo sai sozinho e a prévia é publicada", { timeout: 120_000 }, async () => {
    controle.area = true;
    controle.cenario = "ok";
    const antes = { commits: gh.commits.length, site: await site() };
    let d = await detalhe(projectId);

    // Por quem não pode publicar: a versão nova fica validada e esperando.
    assert.equal((await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", como: "gera", json: { confirm: true, pedido: "troque o título" } })).status, 201);
    d = await esperarFim(projectId, d.project.lastRun.id);
    let agora = await site();
    assert.deepEqual([d.project.lastRun.status, gh.commits.length], ["sucesso", antes.commits]);
    assert.ok(agora.claudeValidatedAt > agora.claudePushedAt, "há uma versão validada depois do último envio");

    // Por quem pode: o painel envia sozinho, sem validar de novo o que acabou de ser validado.
    escrever(doSite, { "content.json": '{"site":{"titulo":"Conta Simples — contabilidade para MEI"}}' });
    assert.equal((await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", como: "admin", json: { confirm: true, pedido: "troque o título" } })).status, 201);
    d = await esperarFim(projectId, d.project.lastRun.id);
    agora = await site();
    assert.deepEqual([d.project.lastRun.status, gh.commits.length, gh.criados.length], ["sucesso", antes.commits + 1, 1]);
    assert.match(gh.commits.at(-1).files["content.json"], /contabilidade para MEI/);
    assert.equal(gh.commits.at(-1).message, "Atualizar o site pelo painel Sites Express");
    assert.ok(agora.claudePushedAt >= agora.claudeValidatedAt);
    assert.deepEqual([d.project.push.state, d.project.push.automatic], ["sent", true]);
    // A prévia: o workflow da área é instalado no repositório, e o push publica.
    assert.deepEqual(publicadas.map(([p, s]) => [p, s]), [[projectId, agora.id]]);
    assert.equal(agora.devArea.state, "publishing");
  });

  it("envio automático que falha não derruba a execução: o card guarda o motivo e o site continua esperando", { timeout: 120_000 }, async () => {
    controle.cenario = "ok";
    escrever(doSite, { "src/sections/Form.tsx": "import { motion } from 'framer-motion'" });
    const commits = gh.commits.length;
    let d = await detalhe(projectId);
    assert.equal((await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", como: "admin", json: { confirm: true, pedido: "anime o topo" } })).status, 201);
    d = await esperarFim(projectId, d.project.lastRun.id);
    assert.deepEqual([d.project.lastRun.status, gh.commits.length, d.project.push.state, d.project.push.automatic], ["sucesso", commits, "failed", true]);
    assert.match(d.project.push.message, /framer-motion/);
    fs.rmSync(path.join(doSite, "src", "sections"), { recursive: true });
  });
});
