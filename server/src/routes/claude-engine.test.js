import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

/**
 * As rotas do painel com o pacote do motor de verdade (`joinvixable/`): as
 * conferências, a revisão, a frase e o contrato de permissões são os do motor,
 * e os comandos que o claude falso digita rodam os scripts dele.
 *
 * O pacote vive num repositório privado. Onde ele não está — um clone público,
 * o CI sem a chave de leitura — este arquivo é pulado; `routes.test.js` prova
 * as mesmas rotas com um motor de mentira, em qualquer lugar.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-claude-motor-"));
const dataDir = path.join(raiz, "dados");
process.env.PANEL_DATA_DIR = dataDir;
process.env.PANEL_ACCESS_TOKEN = "";
process.env.PREVIEW_WATCH_INTERVAL_MS = "0";

const { createApp } = await import("../app.js");
const { resetRuntimeConfig } = await import("../config.js");
const { writeFile: gravarNoProjeto } = await import("../local/storage.js");
const registro = await import("../store/claude.js");
const { CLAUDE_FALSO } = await import("../engines/claude/fixtures/apoio.mjs");
const { estadoDoPacote } = await import("../engines/claude/motor.js");
const { criarServicoClaude, usarServicoClaude } = await import("../engines/claude/service.js");

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "joinvixable");
const pacote = estadoDoPacote(engineDir);
const pular = pacote.instalado ? false : `pacote do motor ausente: ${pacote.motivo}`;

const BRIEFING = path.join(engineDir, "tests", "fixtures", "briefing.json");
const chamadasEm = path.join(raiz, "chamadas.jsonl");
const controle = { cenario: "ok", pasta: "" };

const servico = criarServicoClaude({
  dataDir,
  lerConfig: () => ({ enableGeneration: true, bin: CLAUDE_FALSO, model: "", browserPath: "", humanApproval: null, engineDir }),
  ambienteExtra: () => ({
    // Nenhum teste fala com serviço real: nem Google Fonts, nem banco de imagens.
    JOINVIXABLE_SEM_REDE: "1",
    CLAUDE_FALSO_CENARIO: controle.cenario,
    CLAUDE_FALSO_PASTA: controle.pasta,
    CLAUDE_FALSO_BRIEFING: BRIEFING,
    CLAUDE_FALSO_REGISTRO: chamadasEm,
  }),
  // O build de verdade tem o teste dele (integration.test.js); aqui a validação é uma resposta pronta.
  validar: async () => ({ ok: true, texto: "BUILD OK. VALIDAÇÃO OK." }),
  log: () => undefined,
});

let base;
let parar;

const call = async (pathname, { method = "GET", json } = {}) => {
  const { error, log, warn } = console;
  console.error = () => {};
  console.log = () => {};
  console.warn = () => {};
  try {
    const response = await fetch(base + pathname, {
      method,
      headers: json !== undefined ? { "Content-Type": "application/json" } : {},
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    Object.assign(console, { error, log, warn });
  }
};

const esperarAte = async (condicao, ms = 120_000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await condicao();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error("a condição não chegou a tempo");
    await new Promise((ok) => setTimeout(ok, 250));
  }
};

const chamadas = () => fs.readFileSync(chamadasEm, "utf8").trim().split("\n").map((linha) => JSON.parse(linha));

describe("rotas do motor Claude com o pacote do motor de verdade", { skip: pular }, () => {
  let projectId;
  let pasta;
  const detalhe = async () => (await call(`/api/projects/${projectId}/claude`)).body;
  const esperarFim = (anterior = null) =>
    esperarAte(async () => {
      const d = await detalhe();
      return !d.project?.queue && d.project?.lastRun && d.project.lastRun.id !== anterior ? d : null;
    });

  before(async () => {
    resetRuntimeConfig();
    usarServicoClaude(servico);
    const app = createApp();
    const server = await new Promise((resolve) => {
      const ouvindo = app.listen(0, "127.0.0.1", () => resolve(ouvindo));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    parar = () => new Promise((resolve) => server.close(resolve));

    const criado = await call("/api/projects", { method: "POST", json: { name: "Brasa Viva", kind: "site" } });
    projectId = criado.body.project.id;
    await gravarNoProjeto(projectId, "site/site-antigo.md", Readable.from([Buffer.from("# Brasa Viva\nHamburgueria artesanal em Vila Velha.")]));
  });

  after(async () => {
    await servico.parar().catch(() => undefined);
    usarServicoClaude(undefined);
    await parar?.();
    fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("o ensaio mostra a frase do runbook e o comando com o contrato de permissões do motor", { timeout: 120_000 }, async () => {
    const status = await call("/api/claude/status");
    assert.deepEqual([status.body.installed, status.body.reason, status.body.generation.enabled], [true, null, true]);

    const ensaio = await call(`/api/projects/${projectId}/claude/briefing/preview`, {
      method: "POST",
      json: { observacoes: "Use também o site www.brasa-exemplo.com.br." },
    });
    assert.equal(ensaio.status, 200, JSON.stringify(ensaio.body));
    pasta = ensaio.body.plan.folder;
    controle.pasta = pasta;
    assert.match(pasta, /^brasa-viva-[0-9a-f]{4}$/);
    assert.equal(ensaio.body.plan.phrase, `gere o briefing do cliente ${pasta}\nObservações: Use também o site www.brasa-exemplo.com.br.`);
    // Só os domínios citados nas observações ganham leitura de páginas — quem os reconhece é o motor.
    assert.deepEqual(ensaio.body.plan.sites, ["brasa-exemplo.com.br"]);

    const comando = ensaio.body.command;
    assert.match(comando, /--permission-mode dontAsk --permission-prompts none --setting-sources user/);
    assert.match(comando, /--tools Bash,Read,Edit,Write,Glob,Grep,WebFetch /);
    for (const trecho of [
      `"Edit(./clientes/${pasta}/**)"`,
      '"Bash(npm run -s step *)"',
      '"WebFetch(domain:brasa-exemplo.com.br)"',
      '"Bash(cat *)"',
      '"Bash(git *)"',
      '"Read(//**/.env)"',
      "--strict-mcp-config --disable-slash-commands",
    ]) {
      assert.ok(comando.includes(trecho), `${trecho} está no comando`);
    }
    assert.ok(!comando.includes("Edit(./**)") && !comando.includes("--bare") && !comando.includes(raiz));
    assert.equal(fs.existsSync(chamadasEm), false, "o ensaio não dispara nada");
  });

  it("briefing: o material chega à pasta do cliente, a instrução é a do motor e o resultado passa pela conferência dele", { timeout: 240_000 }, async () => {
    controle.cenario = "briefing";
    const pedido = await call(`/api/projects/${projectId}/claude/briefing`, { method: "POST", json: { confirm: true, texto: "Brasa Viva, hamburgueria." } });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.body));
    const d = await esperarFim();
    assert.deepEqual([d.project.lastRun.type, d.project.lastRun.status, d.project.briefing.state], ["analisar", "sucesso", "ok"]);

    // A revisão vem inteira do motor: o briefing, a conferência e o que a tela deixa mudar.
    assert.deepEqual([d.review.existe, d.review.erros, d.review.briefing.empresa.nome], [true, [], "Brasa Viva"]);
    assert.ok(Array.isArray(d.review.avisos) && Array.isArray(d.review.skillsDisponiveis) && typeof d.review.maxSkills === "number");
    // As opções do site, com as do pipeline (`null` é "o padrão") e os padrões que valem no lugar delas.
    assert.deepEqual(Object.keys(d.review.opcoes).sort(), ["banco_de_imagens", "direcao_de_arte", "escolher_rota", "movimento", "multiplas_paginas", "observacoes", "referencias", "rodadas", "skills"]);
    assert.deepEqual(
      [typeof d.review.padroes.rodadas, typeof d.review.padroes.direcao_de_arte, typeof d.review.padroes.movimento, typeof d.review.padroes.escolher_rota],
      ["number", "string", "string", "boolean"],
    );
    assert.equal(d.review.arquivo, `clientes/${pasta}/briefing/briefing.json`, "caminho relativo à pasta de trabalho, nunca o da máquina");

    const chamada = chamadas().at(-1);
    assert.equal(chamada.entrada, `gere o briefing do cliente ${pasta}`);
    const stream = fs.readFileSync(path.join(servico.caminhos.execucoes, `${d.runs[0].id}.jsonl`), "utf8");
    assert.match(stream, /Briefing a partir dos arquivos do cliente/, "dentro do claude, --briefing imprime a instrução do motor");
    assert.match(stream, /material\/site\/site-antigo\.md/);
    assert.match(stream, /material\/informacoes-do-site\.txt/);

    // Corrigir na tela: gravado pelo motor, com a conferência dele na resposta.
    const quebrado = await call(`/api/projects/${projectId}/claude/briefing`, { method: "PUT", json: { briefing: { empresa: { nome: "Sem ramo" } } } });
    assert.equal(quebrado.status, 200);
    assert.ok(quebrado.body.review.erros.length > 0);
    assert.equal((await detalhe()).project.briefing.state, "refused");
    const semBriefingBom = await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", json: { confirm: true } });
    assert.equal(semBriefingBom.status, 409);
    assert.match(semBriefingBom.body.error, /O briefing tem \d+ pendência/);

    const bom = JSON.parse(fs.readFileSync(BRIEFING, "utf8"));
    const corrigido = await call(`/api/projects/${projectId}/claude/briefing`, { method: "PUT", json: { briefing: bom } });
    assert.deepEqual([corrigido.status, corrigido.body.review.erros], [200, []]);

    // As opções do site vão para o briefing pelo motor, que as devolve como gravou; as da execução ficam no painel.
    const doSite = {
      multiplas_paginas: true,
      banco_de_imagens: false,
      skills: [],
      observacoes: "destaque o delivery",
      rodadas: 3,
      direcao_de_arte: "ousada",
      movimento: null,
      escolher_rota: null,
      // O motor guarda cada link como um endereço completo (com a barra final).
      referencias: { links: ["https://www.brasa-exemplo.com.br/"], notas: "o topo deles, com a foto da chapa" },
    };
    const opcoes = await call(`/api/projects/${projectId}/claude/options`, { method: "PUT", json: { modelo: "claude-fable-5-1", esforco: "max", site: doSite } });
    assert.equal(opcoes.status, 200, JSON.stringify(opcoes.body));
    assert.deepEqual(opcoes.body.site, doSite);
    assert.deepEqual(opcoes.body.options, { modelo: "claude-fable-5-1", esforco: "max" });
    // Os padrões são os do motor: nada está escolhido nas Configurações deste teste.
    assert.deepEqual([opcoes.body.defaults.modelo, opcoes.body.defaults.esforco], ["claude-opus-5-5", "high"]);
    assert.deepEqual(
      [typeof opcoes.body.defaults.rodadas, typeof opcoes.body.defaults.direcao_de_arte, typeof opcoes.body.defaults.movimento, typeof opcoes.body.defaults.escolher_rota],
      ["number", "string", "string", "boolean"],
    );
    assert.deepEqual((await call(`/api/projects/${projectId}/claude/options`)).body.site, doSite);
    const skillRuim = await call(`/api/projects/${projectId}/claude/options`, { method: "PUT", json: { site: { skills: ["skill-que-nao-existe"] } } });
    assert.deepEqual([skillRuim.status, /Skill não encontrada/.test(skillRuim.body.error)], [409, true]);
    // De volta ao que o motor espera, para o comando do teste seguinte.
    assert.equal((await call(`/api/projects/${projectId}/claude/options`, { method: "PUT", json: { modelo: null, esforco: null } })).status, 200);
  });

  it("gerar: o projeto nasce na pasta de dados; etapa aberta é falha, com continuar e abortar", { timeout: 300_000 }, async () => {
    const ensaio = await call(`/api/projects/${projectId}/claude/generate/preview`, { method: "POST", json: {} });
    assert.deepEqual([ensaio.status, ensaio.body.plan.phrase, ensaio.body.plan.errors], [200, `gere o site do cliente ${pasta}`, []]);
    assert.match(ensaio.body.command, /--model claude-opus-5-5 --effort high /);

    controle.cenario = "cliente";
    const anterior = (await detalhe()).project.lastRun.id;
    const pedido = await call(`/api/projects/${projectId}/claude/generate`, { method: "POST", json: { confirm: true } });
    assert.equal(pedido.status, 201, JSON.stringify(pedido.body));
    let d = await esperarFim(anterior);
    // O claude falso para no meio da direção criativa: código 0, mas etapa aberta.
    assert.deepEqual([d.project.lastRun.type, d.project.lastRun.status, d.project.slug, d.project.site.openStage], ["cliente", "falha", pasta, "direcao"]);
    assert.match(d.project.lastRun.message, /etapa "direcao" aberta/);
    assert.deepEqual([d.site.slug, d.site.etapaAberta, d.site.etapas.map((etapa) => [etapa.etapa, etapa.modo, etapa.status])], [pasta, "direcao", [["direcao", "headless", "aberta"]]]);
    // O ponto do pipeline e o passo seguinte vêm do motor: com a etapa aberta, o que há a fazer é continuar.
    assert.deepEqual([d.site.entregue, d.site.proximo, d.site.pipeline.fase], [false, "continuar", "direcao"]);
    assert.deepEqual([typeof d.site.pipeline.rodadas, typeof d.site.pipeline.rodada], ["number", "number"]);
    // O resumo do card repete o que o motor disse, sem interpretar.
    assert.deepEqual(
      [d.project.site.delivered, d.project.site.next, d.project.site.phase, d.project.site.round, d.project.site.rounds],
      [false, "continuar", "direcao", d.site.pipeline.rodada, d.site.pipeline.rodadas],
    );
    assert.deepEqual([d.site.critica, Array.isArray(d.site.rotas), "filme" in d.site, Array.isArray(d.site.telas)], [null, true, false, true]);
    assert.ok(fs.existsSync(path.join(servico.caminhos.trabalho, "projects", pasta, "src", "App.tsx")), "o site está na pasta de dados do painel");
    assert.equal(fs.existsSync(path.join(engineDir, "projects", pasta)), false, "e não na pasta do pacote");
    // Falhou: não vira site do projeto.
    const { listGenerations } = await import("../store/generations.js");
    assert.deepEqual((await listGenerations())[projectId] ?? [], []);

    // Com a etapa aberta, o ajuste é recusado pelo motor antes de gastar; continuar é aceito.
    const ajuste = await call(`/api/projects/${projectId}/claude/adjust`, { method: "POST", json: { confirm: true, pedido: "troque a cor" } });
    assert.equal(ajuste.status, 409);
    assert.match(ajuste.body.error, /A etapa "direcao" de ".*" ainda está aberta/);

    const abortado = await call(`/api/projects/${projectId}/claude/abort`, { method: "POST", json: { motivo: "desistência pela tela" } });
    assert.deepEqual([abortado.status, abortado.body.site.etapaAberta, abortado.body.site.etapas[0].status, abortado.body.site.etapas[0].motivoFalha], [200, null, "falhou", "desistência pela tela"]);
    d = await detalhe();
    assert.equal(d.project.site.openStage, null);

    // As métricas por rótulo saíram do painel; de cada execução fica a estimativa do Claude Code.
    assert.equal((await call(`/api/projects/${projectId}/claude/metrics`)).status, 404);
    const execucoes = await registro.listClaudeRuns({ projectId });
    assert.deepEqual(execucoes.map((run) => [run.tipo, run.modelo, run.esforco, run.total_cost_usd]), [["cliente", "claude-opus-5-5", "high", 0.4242], ["analisar", "claude-opus-5-5", "high", 0.4242]]);
  });
});
