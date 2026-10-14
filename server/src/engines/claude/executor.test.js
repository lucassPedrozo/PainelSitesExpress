import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { pidVivo, foraDoContrato } from "./executor.js";
import { bancada, esperar, SEGREDOS_DO_PAINEL } from "./fixtures/apoio.mjs";

/**
 * As garantias do executor do motor Claude, uma por teste. Nenhum teste chama
 * o claude de verdade: `CLAUDE_BIN` aponta para o claude falso, que emite
 * eventos de exemplo, e o pacote do motor é substituído por um de mentira.
 */

const b = bancada();
after(() => b.limpar());

const depois = (args, flag) => args[args.indexOf(flag) + 1];
const entre = (args, de, ate) => args.slice(args.indexOf(de) + 1, args.indexOf(ate));
const rodar = (pedido, deps) => b.executor.iniciarExecucao(pedido, deps).promessa;

describe("o claude roda com a assinatura, o pedido vai pelo stdin e tudo fica registrado", () => {
  it("ajuste: frase do runbook no stdin, ambiente por lista de permissão, sessão gravada e depois retomada", async () => {
    b.projeto("h");
    b.estado.cenario = "ok";
    const eventos = [];
    const r = await rodar(
      { tipo: "ajuste", slug: "h", pedido: "troque a descrição" },
      { onEvento: (evento) => eventos.push(evento), extra: { projectId: "painel-0123456789abcdef", por: "Lucas" } },
    );

    assert.deepEqual(
      [r.status, r.slug, r.sessionId, r.codigoSaida, r.custoEstimadoUsd, r.etapaAberta],
      ["sucesso", "h", "sessao-falsa-1", 0, 0.4242, null],
    );
    assert.match(r.mensagem, /Ajuste feito/);
    // O claude falso manda o stream em pedaços que cortam as linhas: os 7 eventos chegam inteiros.
    const brutos = eventos.filter((evento) => evento.bruto !== undefined).map((evento) => evento.bruto.type);
    assert.deepEqual(brutos, ["system", "assistant", "user", "assistant", "user", "assistant", "result"]);
    const legiveis = eventos.flatMap((evento) => evento.legiveis);
    assert.ok(legiveis.some((l) => l.tipo === "etapa" && l.texto === "Etapa ajuste (h)"));
    assert.ok(legiveis.some((l) => l.tipo === "ferramenta" && l.texto === "edit_file"));
    assert.ok(legiveis.some((l) => l.tipo === "texto" && /Descrição trocada/.test(l.texto)));
    assert.ok(!legiveis.some((l) => /new_string/.test(l.texto)), "o corpo do heredoc não vira linha de progresso");
    assert.equal(eventos.at(-1).etapa, "ajuste", "a etapa atual acompanha os eventos");

    const [c1] = b.chamadas();
    assert.equal(c1.entrada, "ajuste o site h: troque a descrição", "o pedido vai pelo stdin, com a frase do runbook");
    assert.ok(!c1.args.some((arg) => arg.includes("troque a descrição")), "e nunca pela linha de comando");
    assert.equal(c1.cwd.toLowerCase(), b.caminhos.trabalho.toLowerCase(), "o claude roda da pasta de trabalho do motor");

    // O ambiente do claude é uma lista de permissão: nenhum segredo do painel chega a ele.
    for (const nome of Object.keys(SEGREDOS_DO_PAINEL)) {
      assert.ok(!c1.variaveis.some((v) => v.toUpperCase() === nome.toUpperCase()), `${nome} não chega ao claude`);
    }
    assert.deepEqual([c1.chave, c1.token], [null, null], "as chaves de API saem do ambiente: o claude usa a assinatura");
    assert.ok(c1.variaveis.some((v) => v.toUpperCase() === "PATH"));
    assert.deepEqual(
      [c1.marca, c1.modelo, c1.painel, c1.memoria],
      ["1", "claude-opus-5-5", "1", "1"],
      "marca do executor, modelo lançado, origem no painel e memória automática desligada",
    );
    assert.equal(c1.trabalho.toLowerCase(), b.caminhos.trabalho.toLowerCase());

    // Lista fechada: modo que nega o que não foi permitido, sem MCP, sem skills, sem nada herdado da árvore de pastas.
    assert.deepEqual(
      [
        depois(c1.args, "--output-format"),
        depois(c1.args, "--model"),
        depois(c1.args, "--effort"),
        depois(c1.args, "--permission-mode"),
        depois(c1.args, "--permission-prompts"),
        depois(c1.args, "--setting-sources"),
        depois(c1.args, "--tools"),
      ],
      // Sem nada escolhido no projeto nem nas Configurações: o modelo e o esforço que o motor espera.
      ["stream-json", "claude-opus-5-5", "high", "dontAsk", "none", "user", "Bash,Read,Edit,Write,Glob,Grep"],
    );
    for (const flag of ["-p", "--verbose", "--strict-mcp-config", "--disable-slash-commands"]) {
      assert.ok(c1.args.includes(flag), `${flag} sempre presente`);
    }
    for (const flag of ["--bare", "--dangerously-skip-permissions", "--resume", "--mcp-config", "--add-dir"]) {
      assert.ok(!c1.args.includes(flag), `${flag} nunca é usado numa primeira execução`);
    }
    const permitidas = entre(c1.args, "--allowedTools", "--disallowedTools");
    assert.deepEqual(permitidas, [
      "Read(./**)",
      "Edit(./projects/*/.session/rascunho.txt)",
      "Bash(npm run -s cliente *)",
      "Bash(npm run -s new-project *)",
      "Bash(npm run -s step *)",
      "Bash(npm run -s tool *)",
    ]);
    assert.ok(!c1.args.some((arg) => /WebFetch/.test(arg)), "sem site citado, nenhum acesso à rede");
    const negadas = entre(c1.args, "--disallowedTools", "--strict-mcp-config");
    assert.ok(negadas.includes("Bash(git *)") && negadas.includes("Bash(cat *)") && negadas.includes("Read(//**/.env)"));

    // O runbook chega anexado ao prompt de sistema, gerado pelo motor; as regras do painel vão no arquivo de configurações.
    assert.match(c1.runbook, /^# Runbook do modo CLI/);
    assert.equal(c1.configuracoes.permissions.blockReadsOutsideWorkingDirectories, true);
    const env = path.join(b.raiz, ".env").replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `//${d.toLowerCase()}`);
    assert.ok(
      c1.configuracoes.permissions.deny.some((regra) => regra.toLowerCase() === `Read(${env})`.toLowerCase()),
      "o .env do painel está entre o que o agente não lê",
    );

    // O registro: nasce rodando, com o pid do painel, e termina com sessão, duração, status e custo estimado.
    const primeiro = b.estado.registros[0];
    const ultimo = b.estado.registros.at(-1);
    assert.deepEqual([primeiro.status, primeiro.pid, primeiro.tipo, primeiro.projectId, primeiro.por], ["rodando", process.pid, "ajuste", "painel-0123456789abcdef", "Lucas"]);
    assert.deepEqual(
      [ultimo.id, ultimo.pedido, ultimo.session_id, ultimo.status, ultimo.total_cost_usd, ultimo.codigo_saida, ultimo.turnos, ultimo.retomou, ultimo.pid, ultimo.slug, ultimo.etapa],
      [r.id, "ajuste o site h: troque a descrição", "sessao-falsa-1", "sucesso", 0.4242, 0, 3, undefined, undefined, "h", "ajuste"],
    );
    assert.deepEqual([ultimo.modelo, ultimo.esforco], ["claude-opus-5-5", "high"], "o modelo e o esforço com que a execução rodou");
    // O estado do site no motor acompanha o resultado: é dele que o painel tira se há um passo seguinte.
    assert.deepEqual([r.projeto.entregue, r.projeto.proximo], [true, null]);
    assert.ok(ultimo.duracao_ms >= 0 && /^\d{4}-\d\d-\d\dT/.test(ultimo.data));

    // O stream bruto fica em disco, fora da pasta que o agente enxerga.
    const arquivo = path.join(b.caminhos.execucoes, ultimo.log);
    assert.equal(arquivo, r.log);
    assert.ok(!arquivo.toLowerCase().startsWith(b.caminhos.trabalho.toLowerCase()), "o agente não alcança o próprio stream");
    const bruto = fs.readFileSync(arquivo, "utf8").trim().split("\n").map((linha) => JSON.parse(linha));
    assert.equal(bruto.filter((linha) => linha.type !== "joinvixable").length, 7);
    assert.ok(bruto.some((linha) => linha.type === "joinvixable" && linha.subtype === "inicio" && /claude-falso|node/.test(linha.comando)));
    assert.ok(bruto.some((linha) => linha.type === "joinvixable" && linha.subtype === "fim" && linha.status === "sucesso"));
    assert.ok(b.executor.lerLog(r.id).some((linha) => linha.tipo === "resultado" && /estimativa do Claude Code: US\$ 0\.4242/.test(linha.texto)));

    // O motor lê as execuções do projeto para o relatório dele: a estimativa do Claude Code sai daqui.
    const [h1] = b.historico("h");
    assert.deepEqual(
      [h1.id, h1.pedido, h1.status, h1.session_id, h1.total_cost_usd, h1.codigo_saida, h1.turnos],
      [r.id, "ajuste o site h: troque a descrição", "sucesso", "sessao-falsa-1", 0.4242, 0, 3],
    );
    assert.ok(!("pid" in h1) && !("projectId" in h1), "o que é do painel fica no banco do painel");

    // Segundo ajuste: retoma a sessão do primeiro.
    const r2 = await rodar({ tipo: "ajuste", slug: "h", pedido: "outro pedido" });
    const c2 = b.chamadas()[1];
    assert.equal(depois(c2.args, "--resume"), "sessao-falsa-1");
    assert.deepEqual([r2.retomou, b.historico("h")[1].retomou, b.historico("h").length], ["sessao-falsa-1", "sessao-falsa-1", 2]);
  });

  it("sucesso é código 0 e validação passando: build quebrado vira falha, mesmo com o claude saindo com 0", async () => {
    const outra = bancada({ validar: async () => ({ ok: false, texto: "tipos: src/App.tsx(3,1): error TS2304" }) });
    try {
      outra.projeto("h");
      const r = await outra.executor.iniciarExecucao({ tipo: "ajuste", slug: "h", pedido: "quebre o build" }).promessa;
      assert.deepEqual([r.status, r.codigoSaida, outra.estado.validacoes], ["falha", 0, 1]);
      assert.match(r.mensagem, /a validação não passou:\ntipos: src\/App\.tsx/);
      assert.equal(outra.estado.registros.at(-1).status, "falha");
    } finally {
      outra.limpar();
    }
  });

  it("sessão que não existe mais: o mesmo pedido vai para uma sessão nova, com aviso no log", async () => {
    b.estado.cenario = "sem-sessao";
    const antes = b.chamadas().length;
    const avisos = [];
    const r = await rodar(
      { tipo: "ajuste", slug: "h", pedido: "mais um" },
      { onEvento: (evento) => avisos.push(...evento.legiveis.filter((l) => l.tipo === "aviso").map((l) => l.texto)) },
    );
    const [tentativa, nova] = b.chamadas().slice(antes);
    assert.ok(tentativa.args.includes("--resume") && !nova.args.includes("--resume"));
    assert.equal(nova.entrada, "ajuste o site h: mais um");
    assert.deepEqual([r.status, r.sessionId, r.retomou], ["sucesso", "sessao-nova-depois-da-falha", undefined]);
    assert.match(avisos.join("\n"), /A sessão sessao-falsa-1 não existe mais: abrindo uma sessão nova com o mesmo pedido/);
    const ultimo = b.estado.registros.at(-1);
    assert.deepEqual([ultimo.session_id, ultimo.sessao_nova_por_falha], ["sessao-nova-depois-da-falha", true]);
    assert.match(fs.readFileSync(r.log, "utf8"), /"subtype":"aviso".*não existe mais/);
    b.estado.cenario = "ok";
  });

  it("continuar também retoma a sessão do projeto; sem sessão anterior, abre uma nova e avisa", async () => {
    b.estado.cenario = "ok";
    b.estado.projetos.h = { etapaAberta: null, entregue: false };
    // Um esforço por chave do contrato, para ver qual delas o pedido usa.
    b.estado.contrato.esforco = { criacao: "xhigh", ajuste: "medium", briefing: "low" };
    const antes = b.chamadas().length;
    await rodar({ tipo: "continuar", slug: "h" });
    const chamada = b.chamadas()[antes];
    assert.equal(chamada.entrada, "continue o site h");
    assert.equal(depois(chamada.args, "--resume"), "sessao-nova-depois-da-falha", "a última sessão que o projeto usou");
    assert.equal(depois(chamada.args, "--effort"), "xhigh", "continuar é criação: o mesmo esforço da geração");

    b.projeto("novo");
    const avisos = [];
    await rodar({ tipo: "continuar", slug: "novo" }, { onEvento: (evento) => avisos.push(...evento.legiveis.map((l) => l.texto)) });
    assert.ok(!b.chamadas().at(-1).args.includes("--resume"));
    assert.match(avisos.join("\n"), /"novo" não tem sessão anterior do Claude: abrindo uma sessão nova/);
    b.estado.projetos.h = {};
    b.estado.contrato.esforco = { criacao: "high", ajuste: "high", briefing: "high" };
  });
});

describe("crítica e refino: uma execução para cada, em sessões diferentes", () => {
  it("a crítica abre sempre uma sessão nova, que nunca vira a do site; o refino retoma a de quem escreveu", async () => {
    b.estado.cenario = "ok";
    b.estado.contrato.esforco = { criacao: "xhigh", ajuste: "medium", briefing: "low" };
    // O site foi escrito numa sessão: é ela que os refinos e os ajustes retomam.
    b.projeto("s", { entregue: false, proximo: "criticar" });
    await rodar({ tipo: "ajuste", slug: "s", pedido: "primeira versão" });
    const antes = b.chamadas().length;

    const critica = await rodar({ tipo: "criticar", slug: "s" });
    const refino = await rodar({ tipo: "refinar", slug: "s" });
    const outraCritica = await rodar({ tipo: "criticar", slug: "s" });
    const outroRefino = await rodar({ tipo: "refinar", slug: "s" });
    const [c1, c2, c3, c4] = b.chamadas().slice(antes);

    assert.deepEqual([c1.entrada, c2.entrada], ["critique o site s", "refine o site s"], "as frases do runbook");
    // Quem critica não escreveu o site: sem `--resume`, mesmo havendo a sessão do autor e a de uma crítica anterior.
    assert.ok(!c1.args.includes("--resume") && !c3.args.includes("--resume"));
    assert.deepEqual([critica.sessionId, critica.retomou, outraCritica.retomou], ["sessao-do-critico", undefined, undefined]);
    // O refino volta à conversa do autor — e não à do crítico, que foi a última a rodar.
    assert.deepEqual([depois(c2.args, "--resume"), depois(c4.args, "--resume")], ["sessao-falsa-1", "sessao-falsa-1"]);
    assert.deepEqual([refino.retomou, outroRefino.retomou], ["sessao-falsa-1", "sessao-falsa-1"]);
    // O histórico guarda as quatro, com a sessão de cada uma.
    assert.deepEqual(
      b.historico("s").slice(-4).map((execucao) => [execucao.tipo, execucao.session_id, execucao.retomou]),
      [["criticar", "sessao-do-critico", undefined], ["refinar", "sessao-falsa-1", "sessao-falsa-1"], ["criticar", "sessao-do-critico", undefined], ["refinar", "sessao-falsa-1", "sessao-falsa-1"]],
    );
    // Um ajuste pedido depois da última crítica também retoma a sessão do autor.
    await rodar({ tipo: "criticar", slug: "s" });
    await rodar({ tipo: "ajuste", slug: "s", pedido: "troque o telefone" });
    assert.equal(depois(b.chamadas().at(-1).args, "--resume"), "sessao-falsa-1");

    // Criticar e refinar pensam como quem cria o site; sucesso continua sendo código 0 e validação passando.
    assert.deepEqual([depois(c1.args, "--effort"), depois(c2.args, "--effort")], ["xhigh", "xhigh"]);
    assert.deepEqual([critica.status, refino.status, b.estado.registros.at(-1).tipo], ["sucesso", "sucesso", "ajuste"]);
    assert.deepEqual([critica.projeto.entregue, critica.projeto.proximo], [false, "criticar"], "o estado que o motor informou vai no resultado");
    b.estado.contrato.esforco = { criacao: "high", ajuste: "high", briefing: "high" };
  });

  it("site que só tem sessão de crítica: o refino abre uma sessão nova e avisa, em vez de retomar a do crítico", async () => {
    b.projeto("so-critica", { entregue: false });
    await rodar({ tipo: "criticar", slug: "so-critica" });
    const avisos = [];
    await rodar({ tipo: "refinar", slug: "so-critica" }, { onEvento: (evento) => avisos.push(...evento.legiveis.map((l) => l.texto)) });
    assert.ok(!b.chamadas().at(-1).args.includes("--resume"));
    assert.match(avisos.join("\n"), /"so-critica" não tem sessão anterior do Claude: abrindo uma sessão nova/);
  });
});

describe("o modelo e o esforço de cada execução", () => {
  it("vale o que o projeto escolheu, senão o das Configurações, senão o que o motor espera", async () => {
    b.estado.cenario = "ok";
    b.estado.contrato.esforco = { criacao: "xhigh", ajuste: "medium", briefing: "low" };
    const escolhido = async (pedido, doProjeto) => {
      await rodar(pedido, doProjeto === undefined ? {} : { doProjeto: async () => doProjeto });
      const chamada = b.chamadas().at(-1);
      return [depois(chamada.args, "--model"), depois(chamada.args, "--effort"), chamada.modelo];
    };
    const ajuste = { tipo: "ajuste", slug: "h", pedido: "x" };

    // 1. Nada escolhido: o modelo esperado e o esforço do contrato para o tipo do pedido.
    assert.deepEqual(await escolhido(ajuste), ["claude-opus-5-5", "medium", "claude-opus-5-5"]);
    assert.deepEqual(await escolhido({ tipo: "analisar", pasta: "loja-material" }, { modelo: null, esforco: null }), ["claude-opus-5-5", "low", "claude-opus-5-5"]);

    // 2. As Configurações valem para todo pedido, de qualquer tipo.
    b.estado.configurado = { modelo: "claude-sonnet-5-5", esforco: "high" };
    assert.deepEqual(await escolhido(ajuste), ["claude-sonnet-5-5", "high", "claude-sonnet-5-5"]);
    assert.deepEqual(await escolhido({ tipo: "criticar", slug: "h" }, { modelo: null, esforco: "" }), ["claude-sonnet-5-5", "high", "claude-sonnet-5-5"]);

    // 3. O projeto vale mais — campo a campo: o que ele não escolheu continua vindo das Configurações.
    assert.deepEqual(await escolhido(ajuste, { modelo: "claude-fable-5-1", esforco: "max" }), ["claude-fable-5-1", "max", "claude-fable-5-1"]);
    assert.deepEqual(await escolhido(ajuste, { modelo: "claude-fable-5-1", esforco: null }), ["claude-fable-5-1", "high", "claude-fable-5-1"]);
    assert.deepEqual(await escolhido({ tipo: "refinar", slug: "h" }, { modelo: null, esforco: "low" }), ["claude-sonnet-5-5", "low", "claude-sonnet-5-5"]);
    const registro = b.estado.registros.at(-1);
    assert.deepEqual([registro.tipo, registro.modelo, registro.esforco], ["refinar", "claude-sonnet-5-5", "low"]);

    // Um nível que o claude não conhece não vira argumento dele: vale o seguinte da fila.
    b.estado.configurado = { modelo: "", esforco: "ultra" };
    assert.deepEqual(await escolhido(ajuste, { modelo: null, esforco: "--resume" }), ["claude-opus-5-5", "medium", "claude-opus-5-5"]);
    // O que o projeto escolheu não pôde ser lido: a execução roda com o das Configurações.
    b.estado.configurado = { modelo: "claude-sonnet-5-5", esforco: "" };
    await rodar(ajuste, { doProjeto: async () => { throw new Error("banco fora do ar"); } });
    assert.equal(depois(b.chamadas().at(-1).args, "--model"), "claude-sonnet-5-5");

    b.estado.configurado = { modelo: "", esforco: "" };
    b.estado.contrato.esforco = { criacao: "high", ajuste: "high", briefing: "high" };
  });

  it("o comando previsto segue a mesma ordem, e o teste do login fica com o modelo das Configurações", async () => {
    b.estado.configurado = { modelo: "claude-sonnet-5-5", esforco: "medium" };
    const doProjeto = { modelo: "claude-fable-5-1", esforco: "max" };
    const global = await b.executor.comandoPrevisto();
    assert.deepEqual([global.modelo, global.modeloEsperado, global.esforco, global.esforcoEsperado], ["claude-sonnet-5-5", "claude-opus-5-5", "medium", "high"]);
    const doSite = await b.executor.comandoPrevisto({ tipo: "refinar", doProjeto });
    assert.match(doSite.texto, /--model claude-fable-5-1 --effort max /);
    assert.deepEqual([doSite.modelo, doSite.esforco], ["claude-fable-5-1", "max"]);

    await b.executor.testarClaude();
    assert.equal(depois(b.chamadas().at(-1).args, "--model"), "claude-sonnet-5-5", "o teste não é de nenhum projeto");
    b.estado.configurado = { modelo: "", esforco: "" };
  });
});

describe("o que interrompe ou reprova uma execução", () => {
  it("falha de autenticação: mensagem dizendo para fazer login", async () => {
    b.estado.cenario = "auth";
    const antes = b.estado.validacoes;
    const r = await rodar({ tipo: "ajuste", slug: "h", pedido: "qualquer" });
    assert.equal(r.status, "falha");
    assert.match(r.mensagem, /Falha de autenticação do Claude Code: rode `claude` no terminal e faça login\./);
    assert.equal(b.estado.registros.at(-1).status, "falha");
    assert.equal(b.estado.validacoes, antes, "sem login não há o que validar");
    b.estado.cenario = "ok";
  });

  it("claude usando chave de API em vez da assinatura: a execução é interrompida na hora, antes de gastar", async () => {
    b.estado.cenario = "chave";
    const t0 = Date.now();
    const r = await rodar({ tipo: "ajuste", slug: "h", pedido: "qualquer" });
    assert.equal(r.status, "falha");
    assert.match(r.mensagem, /apiKeySource="ANTHROPIC_API_KEY".*não o login da assinatura.*interrompida antes de gastar/);
    // O claude falso ficaria 30 s trabalhando: terminar antes prova que ele foi morto, e não esperado.
    assert.ok(Date.now() - t0 < 20_000, "o processo é encerrado assim que o system/init chega");
    await esperar(300);
    assert.equal(pidVivo(b.pidDoClaude()), false, "nenhum claude fica para trás");
    b.estado.cenario = "ok";
  });

  it("os plugins embutidos do Claude Code não contam como desvio; um plugin do perfil conta", () => {
    const init = { tools: ["Bash", "Read"], mcp_servers: [], permissionMode: "dontAsk" };
    const esperado = { contrato: { ferramentas: ["Bash", "Read"], modo_de_permissao: "dontAsk" }, sites: [], trabalho: "x" };
    // O que o Claude Code 2.1.292 informou na primeira execução de verdade.
    const embutidos = ["cc-plugin-agents-md", "cc-plugin-telemetry", "cc-plugin-plugin-authoring"].map((name) => ({ name, path: "builtin", source: `${name}@builtin` }));
    assert.equal(foraDoContrato({ ...init, plugins: embutidos }, esperado), null);
    assert.match(foraDoContrato({ ...init, plugins: [...embutidos, { name: "do-perfil", path: "/algum/lugar", source: "do-perfil@loja" }] }, esperado), /plugins carregados: do-perfil$/);
    // Dizer-se embutido só no nome não basta.
    assert.match(foraDoContrato({ ...init, plugins: [{ name: "x", path: "/algum/lugar", source: "x@builtin" }] }, esperado), /plugins carregados: x/);
  });

  for (const [cenario, motivo] of [
    ["mcp", /servidores MCP ligados: servidor-do-perfil/],
    ["plugin", /plugins carregados: plugin-do-perfil/],
    ["ferramenta", /ferramentas além das permitidas: WebSearch/],
    ["modo", /modo de permissão "acceptEdits" no lugar de "dontAsk"/],
  ]) {
    it(`claude que abre fora do contrato (${cenario}) é interrompido na hora`, async () => {
      b.estado.cenario = cenario;
      const t0 = Date.now();
      const r = await rodar({ tipo: "ajuste", slug: "h", pedido: "qualquer" });
      assert.equal(r.status, "falha");
      assert.match(r.mensagem, /abriu fora do contrato do painel/);
      assert.match(r.mensagem, motivo);
      assert.ok(Date.now() - t0 < 20_000);
      b.estado.cenario = "ok";
    });
  }

  it("etapa que ficou aberta vira falha, com a etapa informada para continuar ou abortar", async () => {
    b.estado.projetos.h = { etapaAberta: "geracao", entregue: false };
    const antes = b.estado.validacoes;
    const r = await rodar({ tipo: "ajuste", slug: "h", pedido: "pare no meio" });
    assert.deepEqual([r.status, r.etapaAberta, r.codigoSaida], ["falha", "geracao", 0]);
    assert.match(r.mensagem, /O claude terminou com a etapa "geracao" aberta/);
    assert.equal(b.estado.registros.at(-1).etapa_aberta, "geracao");
    assert.equal(b.estado.validacoes, antes, "site com etapa aberta não é validado");
    b.estado.projetos.h = {};
  });

  it("aguardando aprovação é um status próprio: nem sucesso, nem falha, e sem rodar a validação", async () => {
    b.projeto("ag", { aguardandoAprovacao: true, entregue: false });
    const antes = b.estado.validacoes;
    const r = await rodar({ tipo: "continuar", slug: "ag" });
    assert.deepEqual([r.status, r.slug, b.estado.validacoes], ["aguardando_aprovacao", "ag", antes]);
    assert.match(r.mensagem, /esperando a aprovação de uma pessoa/);
    assert.equal(b.estado.registros.at(-1).status, "aguardando_aprovacao");
    assert.equal(b.historico("ag").at(-1).status, "aguardando_aprovacao");
  });

  it("pedido recusado pelo motor não dispara o claude nem segura a trava", async () => {
    b.estado.recusa = "BRIEFING RECUSADO (1):\n1. empresa.ramo: obrigatório";
    const antes = b.chamadas().length;
    await assert.rejects(rodar({ tipo: "cliente", pasta: "padaria" }), (erro) => {
      assert.equal(erro.status, 409);
      assert.match(erro.message, /BRIEFING RECUSADO/);
      return true;
    });
    assert.equal(b.chamadas().length, antes, "nada foi gasto");
    assert.equal(b.executor.execucaoEmAndamento(), undefined);
    b.estado.recusa = null;
  });
});

describe("pedido de briefing", () => {
  it("o briefing só conta como pronto quando passa na conferência do motor; não há build para validar", async () => {
    b.estado.cenario = "ok";
    const antes = b.estado.validacoes;
    b.estado.briefings["loja-material"] = ["empresa.ramo: obrigatório", "servicos: precisa de ao menos 1"];
    const ruim = await rodar({ tipo: "analisar", pasta: "loja-material" });
    assert.deepEqual([ruim.status, ruim.slug, ruim.pasta, ruim.codigoSaida], ["falha", undefined, "loja-material", 0]);
    assert.match(ruim.mensagem, /o briefing não passa na conferência:\n1\. empresa\.ramo: obrigatório\n2\. servicos/);

    b.estado.briefings["loja-material"] = [];
    const bom = await rodar({ tipo: "analisar", pasta: "loja-material" });
    assert.deepEqual([bom.status, b.estado.validacoes], ["sucesso", antes]);
    const registro = b.estado.registros.at(-1);
    assert.deepEqual([registro.tipo, registro.pasta, registro.slug, registro.total_cost_usd], ["analisar", "loja-material", undefined, 0.4242]);
  });

  it("só no briefing o agente escreve na pasta do cliente, e só os sites citados ganham leitura de páginas", async () => {
    b.estado.sites = ["padaria-exemplo.com.br"];
    await rodar({ tipo: "analisar", pasta: "loja-material", observacoes: "Use o site padaria-exemplo.com.br." });
    const chamada = b.chamadas().at(-1);
    assert.equal(chamada.entrada, "gere o briefing do cliente loja-material\nObservações: Use o site padaria-exemplo.com.br.");
    assert.equal(depois(chamada.args, "--tools"), "Bash,Read,Edit,Write,Glob,Grep,WebFetch");
    assert.equal(depois(chamada.args, "--effort"), "high");
    const permitidas = entre(chamada.args, "--allowedTools", "--disallowedTools");
    assert.ok(permitidas.includes("Edit(./clientes/loja-material/**)"), "a pasta deste cliente, e só ela");
    assert.deepEqual(
      permitidas.filter((regra) => regra.startsWith("WebFetch")),
      ["WebFetch(domain:padaria-exemplo.com.br)", "WebFetch(domain:www.padaria-exemplo.com.br)"],
    );
    b.estado.sites = [];

    await rodar({ tipo: "analisar", pasta: "loja-material" });
    const semSite = b.chamadas().at(-1);
    assert.ok(!semSite.args.some((arg) => /WebFetch/.test(arg)), "sem site citado, o claude continua sem rede");
    // Fora do briefing, a pasta do cliente não é gravável.
    await rodar({ tipo: "ajuste", slug: "h", pedido: "x" });
    assert.ok(!b.chamadas().at(-1).args.some((arg) => arg.startsWith("Edit(./clientes/")));
  });
});

describe("o claude que entrega o resultado e não sai", () => {
  it("é encerrado pelo painel, e o ajuste vale como concluído", async () => {
    b.estado.cenario = "preso";
    const eventos = [];
    const t0 = Date.now();
    const r = await rodar(
      { tipo: "ajuste", slug: "h", pedido: "troque a descrição" },
      { esperaDepoisDoResultadoMs: 300, onEvento: (evento) => eventos.push(evento) },
    );
    assert.ok(Date.now() - t0 < 30_000, "não espera o claude sair sozinho");
    assert.equal(r.status, "sucesso", r.mensagem);
    assert.equal(b.estado.registros.at(-1).codigo_saida, 0);
    assert.equal(pidVivo(b.pidDoClaude()), false);
    assert.ok(!b.executor.execucaoEmAndamento(), "a trava é solta");
    assert.ok(
      eventos.some((evento) => /entregou o resultado e não saiu/.test(JSON.stringify(evento))),
      "o log da execução diz o que aconteceu",
    );
  });
});

describe("uma execução por vez, e cancelamento em dois tempos", () => {
  it("enquanto uma roda, outra é recusada; cancelar encerra o claude e solta a trava", async () => {
    b.estado.cenario = "lento";
    let comecou;
    const pronto = new Promise((ok) => (comecou = ok));
    const exec = b.executor.iniciarExecucao(
      { tipo: "ajuste", slug: "h", pedido: "demorado" },
      { esperaCancelamentoMs: 300, onEvento: (evento) => evento.bruto !== undefined && comecou() },
    );
    await pronto;
    assert.match(b.executor.execucaoEmAndamento().pedido, /ajuste o site h: demorado/);
    assert.equal(b.executor.execucaoEmAndamento().pid, process.pid);
    assert.equal(b.estado.registros.at(-1).status, "rodando");
    const pid = b.pidDoClaude();
    assert.equal(pidVivo(pid), true);

    await assert.rejects(rodar({ tipo: "ajuste", slug: "h", pedido: "ao mesmo tempo" }), (erro) => {
      assert.equal(erro.status, 409);
      assert.match(erro.message, /Já há uma execução do Claude em andamento/);
      return true;
    });

    const t0 = Date.now();
    exec.cancelar();
    const r = await exec.promessa;
    assert.equal(r.status, "cancelada");
    assert.equal(r.sinais[0], "SIGINT", "primeiro o sinal que deixa o claude fechar o turno");
    assert.ok(Date.now() - t0 < 15_000, "o processo sai logo depois do cancelamento");
    assert.equal(b.estado.registros.at(-1).status, "cancelada");
    assert.equal(b.executor.execucaoEmAndamento(), undefined, "a trava é solta");
    await esperar(300);
    assert.equal(pidVivo(pid), false, "o claude e a árvore dele foram encerrados");
    b.estado.cenario = "ok";
  });

  it("a fila pode pôr uma execução ao lado de outra: cada uma com o seu projeto atual, nunca no mesmo site", async () => {
    b.estado.cenario = "lento";
    const antes = b.chamadas().length;
    const aoComecar = () => {
      let comecou;
      const pronto = new Promise((ok) => (comecou = ok));
      return { pronto, deps: { aoLado: true, esperaCancelamentoMs: 300, onEvento: (evento) => evento.bruto !== undefined && comecou() } };
    };
    const [um, dois] = [aoComecar(), aoComecar()];
    const primeira = b.executor.iniciarExecucao({ tipo: "ajuste", slug: "h", pedido: "demorado" }, um.deps);
    await um.pronto;
    const segunda = b.executor.iniciarExecucao({ tipo: "ajuste", slug: "s", pedido: "ao lado" }, dois.deps);
    await dois.pronto;

    const [c1, c2] = b.chamadas().slice(antes);
    assert.ok(c1.atual && c2.atual && c1.atual !== c2.atual, "cada execução anota o projeto atual em um arquivo só dela");
    assert.ok(c1.atual.startsWith(b.caminhos.atual) && !c1.atual.startsWith(b.caminhos.trabalho), "fora da pasta que o agente enxerga");
    assert.equal(JSON.parse(fs.readFileSync(b.caminhos.trava, "utf8")).execucoes, 2);

    await assert.rejects(b.executor.iniciarExecucao({ tipo: "ajuste", slug: "h", pedido: "no mesmo site" }, { aoLado: true }).promessa, (erro) => erro.status === 409);
    await assert.rejects(rodar({ tipo: "ajuste", slug: "outro", pedido: "sem a fila" }), (erro) => erro.status === 409, "sem a fila decidir, continua uma por vez");

    primeira.cancelar();
    await primeira.promessa;
    assert.equal(b.executor.execucaoEmAndamento()?.pid, process.pid, "a trava continua enquanto a outra roda");
    segunda.cancelar();
    await segunda.promessa;
    assert.equal(b.executor.execucaoEmAndamento(), undefined, "a trava é solta com a última");
    b.estado.cenario = "ok";
  });

  it(
    "claude que não sai no primeiro sinal recebe o segundo",
    { skip: process.platform === "win32" && "no Windows não há sinais: o primeiro tempo já encerra a árvore" },
    async () => {
      b.estado.cenario = "teimoso";
      let comecou;
      const pronto = new Promise((ok) => (comecou = ok));
      const exec = b.executor.iniciarExecucao(
        { tipo: "ajuste", slug: "h", pedido: "teimoso" },
        { esperaCancelamentoMs: 300, onEvento: (evento) => evento.bruto !== undefined && comecou() },
      );
      await pronto;
      exec.cancelar();
      const r = await exec.promessa;
      assert.deepEqual([r.status, r.sinais], ["cancelada", ["SIGINT", "SIGTERM"]]);
      b.estado.cenario = "ok";
    },
  );

  it("cancelar antes de o claude ser lançado não lança nada", async () => {
    b.estado.cenario = "ok";
    const antes = b.chamadas().length;
    const exec = b.executor.iniciarExecucao({ tipo: "ajuste", slug: "h", pedido: "nem começa" });
    exec.cancelar();
    const r = await exec.promessa;
    assert.equal(r.status, "cancelada");
    assert.equal(b.chamadas().length, antes);
  });

  it("trava deixada por um painel que morreu não segura a fila", async () => {
    fs.mkdirSync(b.caminhos.dados, { recursive: true });
    // Um pid que com certeza não existe mais.
    fs.writeFileSync(b.caminhos.trava, JSON.stringify({ pid: 2 ** 22 + 12345, pedido: "antigo", desde: new Date().toISOString() }));
    assert.equal(b.executor.execucaoEmAndamento(), undefined);
    const r = await rodar({ tipo: "ajuste", slug: "h", pedido: "depois do reinício" });
    assert.equal(r.status, "sucesso");
    assert.equal(fs.existsSync(b.caminhos.trava), false);
  });
});

describe("o que vai para a tela", () => {
  it("caminhos desta máquina viram rótulos e segredos do painel somem; o stream bruto em disco fica como veio", async () => {
    b.estado.cenario = "vaza";
    const segredo = SEGREDOS_DO_PAINEL.GITHUB_TOKEN;
    b.estado.extraNoAmbiente = { CLAUDE_FALSO_TEXTO: segredo };
    const eventos = [];
    const r = await rodar({ tipo: "ajuste", slug: "h", pedido: "vaze" }, { onEvento: (evento) => eventos.push(evento) });

    const naTela = [...eventos.flatMap((evento) => evento.legiveis.map((l) => l.texto)), r.mensagem, ...b.executor.lerLog(r.id).map((l) => l.texto)].join("\n");
    assert.ok(!naTela.includes(segredo), "o valor do segredo nunca chega ao navegador");
    assert.ok(!naTela.toLowerCase().includes(b.raiz.toLowerCase().replace(/\\/g, "/")) && !naTela.toLowerCase().includes(b.raiz.toLowerCase()));
    assert.match(naTela, /<pasta do motor>[\\/]projects[\\/]h[\\/]content\.json e achei •••/);
    assert.ok(!b.estado.registros.at(-1).mensagem.includes(segredo), "nem no registro que a tela lê");
    // O agente respondeu e saiu com código 0, mas nunca abriu a etapa de ajuste: o site
    // está como estava, e isso não é sucesso (foi o que aconteceu no primeiro ajuste real).
    assert.equal(r.status, "falha");
    assert.match(r.mensagem, /^O claude terminou sem abrir a etapa de ajuste: nada foi alterado no site\. Última mensagem: Terminei em /);

    // Em disco fica o que o claude escreveu de fato, para auditoria.
    assert.ok(fs.readFileSync(r.log, "utf8").includes(segredo));
    b.estado.cenario = "ok";
    b.estado.extraNoAmbiente = {};
  });
});

describe("conferências do Claude Code", () => {
  it("a versão sai de `claude --version`, sem gastar nada", async () => {
    assert.deepEqual(await b.executor.versaoClaude(), { encontrado: true, versao: "0.0.0 (claude falso)" });
  });

  it("o comando previsto mostra o que seria disparado, sem disparar", async () => {
    const antes = b.chamadas().length;
    const previsto = await b.executor.comandoPrevisto();
    assert.match(previsto.texto, /-p --output-format stream-json --verbose --model claude-opus-5-5 --effort high --permission-mode dontAsk/);
    assert.match(previsto.texto, /"Bash\(npm run -s step \*\)"/);
    assert.ok(!previsto.texto.toLowerCase().includes(b.raiz.toLowerCase()), "sem o caminho desta máquina");
    assert.equal(b.chamadas().length, antes);
  });

  it("testar o login: resposta pela assinatura, falha de login e chave de API", async () => {
    b.estado.cenario = "ok";
    const ok = await b.executor.testarClaude();
    assert.deepEqual([ok.ok, ok.apiKeySource, ok.custoEstimadoUsd], [true, "none", 0.4242]);
    const chamada = b.chamadas().at(-1);
    assert.equal(chamada.entrada, "Responda apenas com a palavra: ok");
    assert.ok(chamada.args.includes("--no-session-persistence") && depois(chamada.args, "--tools") === "");
    assert.deepEqual([chamada.chave, chamada.token], [null, null]);
    assert.equal(b.executor.execucaoEmAndamento(), undefined, "o teste também respeita a trava de uma execução por vez");

    b.estado.cenario = "auth";
    assert.deepEqual(await b.executor.testarClaude().then((t) => [t.ok, t.mensagem]), [
      false,
      "Falha de autenticação do Claude Code: rode `claude` no terminal e faça login.",
    ]);
    b.estado.cenario = "chave";
    const comChave = await b.executor.testarClaude();
    assert.equal(comChave.ok, false);
    assert.match(comChave.mensagem, /está usando uma chave de API \(apiKeySource="ANTHROPIC_API_KEY"\)/);
    b.estado.cenario = "ok";
  });
});
