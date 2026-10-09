import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { montarComando } from "./command.js";
import { ambienteDoFilho } from "./environment.js";
import { criarExecutor } from "./executor.js";
import { criarMotor, estadoDoPacote } from "./motor.js";
import { caminhosDoMotor, COMANDOS_DO_RUNBOOK, prepararRaiz, projetosDoCliente } from "./workspace.js";

/**
 * O executor do painel com o pacote do motor de verdade (`joinvixable/`) e o
 * claude falso no lugar do executável: os comandos do runbook, digitados da
 * pasta de trabalho, rodam os scripts do pacote; o projeto nasce na pasta de
 * dados; e o build acha as dependências pela junção.
 *
 * O pacote do motor vive num repositório privado. Onde ele não está — um clone
 * público, o CI sem a chave de leitura — estes testes são pulados; os do
 * executor (`executor.test.js`) valem em qualquer lugar.
 */

const dirMotor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "joinvixable");
const pacote = estadoDoPacote(dirMotor);
const pular = pacote.instalado ? false : `pacote do motor ausente: ${pacote.motivo}`;

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-motor-"));
const caminhos = caminhosDoMotor({ dataDir: path.join(raiz, "dados"), dirMotor });
const CLAUDE_FALSO = fileURLToPath(new URL("./fixtures/claude-falso.mjs", import.meta.url));
const BRIEFING = path.join(dirMotor, "tests", "fixtures", "briefing.json");
const chamadasEm = path.join(raiz, "chamadas.jsonl");

/** O que o painel passa aos processos do motor, e nada mais. `SEM_REDE`: nenhum teste fala com serviço real. */
const doPainel = { JOINVIXABLE_PAINEL: "1", JOINVIXABLE_TRABALHO: caminhos.trabalho, JOINVIXABLE_SEM_REDE: "1" };
const motor = criarMotor({ dirMotor, ambiente: () => ambienteDoFilho({ definidas: doPainel }), log: () => undefined });

const estado = { cenario: "ok", pasta: "" };
const registros = [];
const executor = criarExecutor({
  motor,
  caminhos,
  registrar: (execucao) => registros.push(execucao),
  // O build de verdade tem o teste dele, mais abaixo; aqui a validação é uma resposta pronta.
  validar: async () => ({ ok: true, texto: "BUILD OK. VALIDAÇÃO OK." }),
  opcoes: () => ({
    bin: CLAUDE_FALSO,
    modelo: "claude-sonnet-5-5",
    ambiente: {
      JOINVIXABLE_SEM_REDE: "1",
      CLAUDE_FALSO_CENARIO: estado.cenario,
      CLAUDE_FALSO_PASTA: estado.pasta,
      CLAUDE_FALSO_BRIEFING: BRIEFING,
      CLAUDE_FALSO_REGISTRO: chamadasEm,
    },
  }),
});

const chamadas = () => fs.readFileSync(chamadasEm, "utf8").trim().split("\n").map((linha) => JSON.parse(linha));
const clienteEm = (pasta, ...resto) => path.join(caminhos.trabalho, "clientes", pasta, ...resto);

after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe("pasta de trabalho do motor", { skip: pular }, () => {
  it("encaminha os cinco comandos do runbook e põe as dependências do motor ao alcance dos projetos", async () => {
    await prepararRaiz(caminhos);
    const pacoteDaRaiz = JSON.parse(fs.readFileSync(path.join(caminhos.trabalho, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(pacoteDaRaiz.scripts), COMANDOS_DO_RUNBOOK);
    assert.deepEqual(COMANDOS_DO_RUNBOOK, ["cliente", "new-project", "step", "tool", "report"]);
    for (const nome of COMANDOS_DO_RUNBOOK) {
      assert.ok(fs.existsSync(path.join(dirMotor, "scripts", `${nome}.ts`)), `scripts/${nome}.ts existe no pacote`);
      assert.ok(pacoteDaRaiz.scripts[nome].includes(`scripts/${nome}.ts`));
    }
    assert.equal(pacoteDaRaiz.dependencies, undefined, "a pasta de trabalho não instala nada");

    // O comando como o agente o digita, pelo npm de verdade e com o ambiente que o claude recebe. No Windows o
    // npm passa o script ao cmd, e uma linha que começa com aspas (o Node em "C:/Program Files") não rodava:
    // foi por isso que o primeiro ajuste real parou em "'C:/Program' não é reconhecido".
    for (const nome of COMANDOS_DO_RUNBOOK) assert.match(pacoteDaRaiz.scripts[nome], /^node "/, nome);
    const modo = spawnSync("npm run -s step -- modo", {
      cwd: caminhos.trabalho,
      shell: true,
      encoding: "utf8",
      env: ambienteDoFilho({ base: process.env, definidas: { JOINVIXABLE_PAINEL: "1", JOINVIXABLE_HEADLESS: "1", JOINVIXABLE_TRABALHO: caminhos.trabalho } }),
    });
    assert.equal(modo.status, 0, `${modo.stdout}${modo.stderr}`);
    assert.match(modo.stdout, /^MODO=/);
    assert.equal(
      fs.realpathSync(path.join(caminhos.trabalho, "node_modules")).toLowerCase(),
      fs.realpathSync(path.join(dirMotor, "node_modules")).toLowerCase(),
      "a junção leva às dependências do pacote",
    );
    // Preparar de novo não refaz nem quebra nada.
    const antes = fs.statSync(path.join(caminhos.trabalho, "package.json")).mtimeMs;
    await prepararRaiz(caminhos);
    assert.equal(fs.statSync(path.join(caminhos.trabalho, "package.json")).mtimeMs, antes);

    // O que o agente enxerga é a pasta de trabalho: o código do motor, as seções e os prompts ficam fora dela.
    for (const nome of ["sections", "template", "prompts", "agent", "tools"]) {
      assert.equal(fs.existsSync(path.join(caminhos.trabalho, nome)), false, `${nome}/ não está na pasta de trabalho`);
    }
  });

  it("o runbook que vai ao claude é gerado das fontes do motor, e o contrato de permissões monta o comando", async () => {
    await motor.gravarRunbook(caminhos.runbook);
    const runbook = fs.readFileSync(caminhos.runbook, "utf8");
    assert.match(runbook, /# Runbook do modo CLI/);
    assert.equal(runbook, fs.readFileSync(path.join(dirMotor, "AGENTS.md"), "utf8"), "o mesmo texto do AGENTS.md");
    assert.ok(!caminhos.runbook.toLowerCase().startsWith(caminhos.trabalho.toLowerCase()), "fora da pasta que o agente lê");

    const { headless: contrato, modeloEsperado } = await motor.ambiente();
    assert.equal(modeloEsperado, "claude-sonnet-5-5");
    const { args } = montarComando({ contrato, modelo: modeloEsperado, tipo: "analisar", pasta: "padaria", runbook: caminhos.runbook, configuracoes: caminhos.configuracoes });
    const depois = (flag) => args[args.indexOf(flag) + 1];
    assert.deepEqual(
      [depois("--permission-mode"), depois("--permission-prompts"), depois("--setting-sources"), depois("--tools"), depois("--effort")],
      ["dontAsk", "none", "user", "Bash,Read,Edit,Write,Glob,Grep", "high"],
    );
    assert.ok(args.includes("Edit(./clientes/padaria/**)") && args.includes("Edit(./projects/*/.session/rascunho.txt)"));
    assert.ok(!args.includes("Edit(./**)"), "a escrita direta em qualquer lugar da pasta deixou de existir");
    assert.ok(args.includes("--strict-mcp-config") && args.includes("--disable-slash-commands") && !args.includes("--bare"));
  });
});

describe("executor com o pacote do motor de verdade", { skip: pular }, () => {
  it("gerar pelo cliente: os comandos do agente rodam o motor, o projeto nasce na pasta de dados e a etapa aberta vira falha", { timeout: 180_000 }, async () => {
    fs.mkdirSync(clienteEm("padaria-teste", "briefing"), { recursive: true });
    fs.copyFileSync(BRIEFING, clienteEm("padaria-teste", "briefing", "briefing.json"));
    estado.cenario = "cliente";
    estado.pasta = "padaria-teste";
    const saidas = [];
    const r = await executor.iniciarExecucao({ tipo: "cliente", pasta: "padaria-teste" }, { onEvento: (evento) => saidas.push(JSON.stringify(evento.bruto ?? "")) }).promessa;

    assert.equal(chamadas().at(-1).entrada, "gere o site do cliente padaria-teste", "a frase vem do motor");
    assert.match(saidas.join("\n"), /MODO=headless \(esta conversa foi aberta pelo executor\): você é o agente/);
    assert.match(saidas.join("\n"), /PROJETO_CRIADO=padaria-teste/, "dentro do claude, npm run cliente só cria o projeto");
    // O claude saiu com código 0, mas deixou a direção aberta: não é sucesso.
    assert.deepEqual([r.slug, r.status, r.etapaAberta, r.codigoSaida], ["padaria-teste", "falha", "direcao", 0]);
    assert.match(r.mensagem, /etapa "direcao" aberta/);

    const projeto = path.join(caminhos.trabalho, "projects", "padaria-teste");
    assert.ok(fs.existsSync(path.join(projeto, "src", "App.tsx")), "o projeto está na pasta de dados, não no pacote");
    assert.equal(fs.existsSync(path.join(dirMotor, "projects", "padaria-teste")), false);
    assert.deepEqual(projetosDoCliente(caminhos.trabalho, "padaria-teste"), ["padaria-teste"]);
    const etapa = JSON.parse(fs.readFileSync(path.join(projeto, ".session", "session.json"), "utf8")).etapas[0];
    assert.deepEqual([etapa.modo, etapa.modelo, etapa.status], ["headless", "claude-sonnet-5-5", "aberta"], "vale o modelo que o executor lançou");

    const historico = JSON.parse(fs.readFileSync(path.join(projeto, ".session", "headless.json"), "utf8")).execucoes;
    assert.deepEqual(historico.map((e) => [e.tipo, e.status, e.session_id]), [["cliente", "falha", "sessao-falsa-1"]]);
    assert.deepEqual([registros.at(-1).slug, registros.at(-1).etapa, registros.at(-1).etapa_aberta], ["padaria-teste", "direcao", "direcao"]);

    // Cliente que já tem projeto: recusado antes de gastar; continuar é aceito porque há etapa aberta.
    const antes = chamadas().length;
    await assert.rejects(executor.iniciarExecucao({ tipo: "cliente", pasta: "padaria-teste" }).promessa, /Este cliente já tem projeto: padaria-teste/);
    assert.equal(chamadas().length, antes);
    assert.deepEqual(await motor.conferirPedido({ tipo: "continuar", slug: "padaria-teste" }), { frase: "continue o site padaria-teste", sites: [] });
    await assert.rejects(motor.conferirPedido({ tipo: "ajuste", slug: "padaria-teste", pedido: "x" }), /A etapa "direcao" de "padaria-teste" ainda está aberta/);
  });

  it("gerar o briefing: instrução com os arquivos do cliente, e o resultado só vale se passar na conferência", { timeout: 180_000 }, async () => {
    fs.mkdirSync(clienteEm("loja-material", "site"), { recursive: true });
    fs.writeFileSync(clienteEm("loja-material", "site", "site-antigo.md"), "# Brasa Viva\nHamburgueria artesanal em Vila Velha.");
    estado.pasta = "loja-material";

    // O claude escreve um briefing que não passa na conferência: falha, com os problemas.
    estado.cenario = "briefing-ruim";
    const ruim = await executor.iniciarExecucao({ tipo: "analisar", pasta: "loja-material" }).promessa;
    assert.equal(ruim.status, "falha");
    assert.match(ruim.mensagem, /o briefing não passa na conferência:\n1\. /);

    estado.cenario = "briefing";
    const saidas = [];
    const r = await executor.iniciarExecucao(
      { tipo: "analisar", pasta: "loja-material", observacoes: "Use também o site www.brasa-exemplo.com.br." },
      { onEvento: (evento) => saidas.push(JSON.stringify(evento.bruto ?? "")) },
    ).promessa;
    assert.deepEqual([r.status, r.slug, r.pasta, r.codigoSaida], ["sucesso", undefined, "loja-material", 0]);
    const chamada = chamadas().at(-1);
    assert.equal(chamada.entrada, "gere o briefing do cliente loja-material\nObservações: Use também o site www.brasa-exemplo.com.br.");
    assert.ok(chamada.args.includes("WebFetch(domain:brasa-exemplo.com.br)"), "o site citado nas observações, reconhecido pelo motor");
    assert.ok(chamada.args.includes("Edit(./clientes/loja-material/**)"));

    const instrucao = saidas.join("\n");
    assert.match(instrucao, /Briefing a partir dos arquivos do cliente/, "dentro do claude, --briefing imprime a instrução");
    assert.match(instrucao, /clientes\/loja-material\/briefing\/briefing\.json/, "com os caminhos relativos à pasta de trabalho");
    assert.match(instrucao, /site\/site-antigo\.md/);
    assert.deepEqual((await motor.conferirBriefing("loja-material")).erros, []);
    // O briefing ruim da primeira tentativa já estava preenchido: ficou guardado antes de ser trocado.
    assert.equal(fs.readdirSync(clienteEm("loja-material", "briefing", "anteriores")).length, 1);
    assert.deepEqual(registros.slice(-1).map((e) => [e.tipo, e.status, e.total_cost_usd, e.slug]), [["analisar", "sucesso", 0.4242, undefined]]);
  });

  it("o build de um projeto na pasta de dados acha React, Vite e Tailwind pela junção", { timeout: 300_000 }, async () => {
    const r = await motor.validar("padaria-teste");
    // O projeto está recém-criado, sem conteúdo: a validação reclama, mas o build tem de compilar.
    assert.match(r.texto, /BUILD OK\./, r.texto);
    assert.doesNotMatch(r.texto, /Cannot find module|Failed to resolve|tipos: /, "nenhuma dependência ficou fora do alcance");
    assert.ok(fs.existsSync(path.join(caminhos.trabalho, "projects", "padaria-teste", "dist", "index.html")));
  });
});
