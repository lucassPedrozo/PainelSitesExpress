import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  caminhoDeRegra,
  comandoTexto,
  configuracoesDoAgente,
  ESFORCOS,
  esforcoDoContrato,
  executavel,
  MODELO_VALIDO,
  MODELOS,
  montarComando,
  montarComandoTeste,
} from "./command.js";
import { ambienteDoFilho, VARIAVEIS_PERMITIDAS } from "./environment.js";
import { criarFiltro, criarFormatador, leitorDeLinhas } from "./stream.js";
import { CONTRATO, SEGREDOS_DO_PAINEL } from "./fixtures/apoio.mjs";

const depois = (args, flag) => args[args.indexOf(flag) + 1];

describe("linha de comando do claude -p", () => {
  it("flags fixas, sem --bare, e a sessão só entra quando há o que retomar", () => {
    const cmd = montarComando({ contrato: CONTRATO, modelo: "claude-sonnet-5-5", resume: "abc", runbook: "C:/dados/runbook.md", configuracoes: "C:/dados/config.json" });
    assert.deepEqual(
      [depois(cmd.args, "--output-format"), depois(cmd.args, "--model"), depois(cmd.args, "--permission-mode"), depois(cmd.args, "--permission-prompts"), depois(cmd.args, "--resume")],
      ["stream-json", "claude-sonnet-5-5", "dontAsk", "none", "abc"],
    );
    assert.deepEqual(
      [depois(cmd.args, "--setting-sources"), depois(cmd.args, "--settings"), depois(cmd.args, "--append-system-prompt-file")],
      ["user", "C:/dados/config.json", "C:/dados/runbook.md"],
    );
    for (const flag of ["-p", "--verbose", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(cmd.args.includes(flag), flag);
    assert.ok(!cmd.args.includes("--bare") && !cmd.args.includes("--dangerously-skip-permissions"));
    assert.ok(cmd.args.includes("Bash(npm run -s tool *)") && cmd.args.includes("Bash(git *)"));
    assert.ok(cmd.args.indexOf("Bash(git *)") > cmd.args.indexOf("--disallowedTools"), "git fica na lista de negados");
    assert.ok(cmd.args.indexOf("Bash(npm run -s tool *)") < cmd.args.indexOf("--disallowedTools"), "e os comandos do runbook, na de permitidos");
    assert.ok(!montarComando({ contrato: CONTRATO, modelo: "m" }).args.includes("--resume"));
    assert.match(comandoTexto(cmd), /^claude -p .*"Bash\(npm run -s step \*\)"/);
  });

  it("o esforço de raciocínio acompanha o tipo do pedido, e o que foi escolhido vale no lugar dele", () => {
    // Um esforço por chave do contrato, para o teste ver qual delas cada tipo usa.
    const contrato = { ...CONTRATO, esforco: { criacao: "xhigh", ajuste: "medium", briefing: "low" } };
    const esforco = (tipo, escolhido) => depois(montarComando({ contrato, modelo: "m", tipo, esforco: escolhido }).args, "--effort");
    assert.deepEqual(
      ["cliente", "continuar", "criticar", "refinar", "ajuste", "analisar", undefined].map((tipo) => esforco(tipo)),
      ["xhigh", "xhigh", "xhigh", "xhigh", "medium", "low", "xhigh"],
      "criticar e refinar pensam como quem cria o site",
    );
    assert.equal(esforcoDoContrato(contrato, "refinar"), "xhigh");
    // O que o projeto ou as Configurações escolheram vale para qualquer tipo; vazio volta ao do contrato.
    for (const tipo of ["cliente", "ajuste", "analisar", "criticar"]) assert.equal(esforco(tipo, "max"), "max", tipo);
    assert.deepEqual([esforco("ajuste", ""), esforco("ajuste", null)], ["medium", "medium"]);
    assert.deepEqual(ESFORCOS, ["low", "medium", "high", "xhigh", "max"]);
  });

  it("o modelo é só um id ou um apelido: nada que pareça outra opção do claude", () => {
    for (const valor of ["claude-opus-5-5", "sonnet", "opus[1m]"]) assert.ok(MODELO_VALIDO.test(valor), valor);
    for (const valor of ["--dangerously-skip-permissions", "opus --resume x", "modelo;rm", ""]) assert.ok(!MODELO_VALIDO.test(valor), valor);
    assert.deepEqual(
      MODELOS.map((modelo) => [modelo.id, modelo.rotulo]),
      [["claude-opus-5-5", "Opus 5.5"], ["claude-fable-5-1", "Fable 5.1"], ["claude-sonnet-5-5", "Sonnet 5.5"]],
    );
    assert.ok(MODELOS.every((modelo) => MODELO_VALIDO.test(modelo.id)));
  });

  it("a leitura de páginas só entra para os domínios citados, e a escrita na pasta do cliente só no pedido de briefing", () => {
    const comSite = montarComando({ contrato: CONTRATO, modelo: "m", tipo: "analisar", pasta: "padaria", sites: ["padaria-exemplo.com.br"] }).args;
    assert.equal(depois(comSite, "--tools"), "Bash,Read,Edit,Write,Glob,Grep,WebFetch");
    assert.ok(comSite.includes("WebFetch(domain:padaria-exemplo.com.br)") && comSite.includes("WebFetch(domain:www.padaria-exemplo.com.br)"));
    assert.ok(comSite.includes("Edit(./clientes/padaria/**)"));

    const semSite = montarComando({ contrato: CONTRATO, modelo: "m", tipo: "analisar", pasta: "padaria" }).args;
    assert.ok(!semSite.some((arg) => /WebFetch/.test(arg)), "sem site citado, nenhum acesso à rede");
    const geracao = montarComando({ contrato: CONTRATO, modelo: "m", tipo: "cliente", pasta: "padaria" }).args;
    assert.ok(!geracao.some((arg) => arg.startsWith("Edit(./clientes/")), "fora do briefing, a pasta do cliente não é gravável");
    assert.ok(geracao.includes("Edit(./projects/*/.session/rascunho.txt)"), "a escrita direta fica no rascunho da sessão");
  });

  it("o teste de login não tem ferramenta nenhuma nem grava sessão", () => {
    const cmd = montarComandoTeste({ contrato: CONTRATO, modelo: "claude-sonnet-5-5" });
    assert.equal(depois(cmd.args, "--tools"), "");
    assert.ok(cmd.args.includes("--no-session-persistence") && cmd.args.includes("--strict-mcp-config") && !cmd.args.includes("--bare"));
    assert.deepEqual([depois(cmd.args, "--permission-mode"), depois(cmd.args, "--setting-sources")], ["dontAsk", "user"]);
  });

  it("um executável .mjs roda pelo Node (o claude falso); os demais, direto", () => {
    assert.deepEqual(executavel("C:/x/claude-falso.mjs"), { bin: process.execPath, prefixo: ["C:/x/claude-falso.mjs"] });
    assert.deepEqual(executavel("C:/Users/x/.local/bin/claude.exe"), { bin: "C:/Users/x/.local/bin/claude.exe", prefixo: [] });
    assert.deepEqual(executavel(""), { bin: "claude", prefixo: [] });
  });

  it("o que o painel protege vira regra de leitura negada, por caminho absoluto", () => {
    // A letra da unidade só existe no Windows; fora dele, o caminho absoluto já parte da raiz.
    if (process.platform === "win32") {
      assert.equal(caminhoDeRegra("C:\\Users\\Ana\\Painel - Sites\\.env").toLowerCase(), "//c/users/ana/painel - sites/.env");
    } else {
      assert.equal(caminhoDeRegra("/home/ana/Painel - Sites/.env"), "//home/ana/Painel - Sites/.env");
    }
    const config = configuracoesDoAgente({ contrato: CONTRATO, protegidos: [path.resolve("/dados/painel/.env"), path.resolve("/dados/painel/server/data/painel.json")] });
    assert.equal(config.permissions.blockReadsOutsideWorkingDirectories, true, "a cerca de leitura do contrato continua");
    const env = caminhoDeRegra(path.resolve("/dados/painel/.env"));
    assert.deepEqual(config.permissions.deny.slice(0, 2), [`Read(${env})`, `Read(${env}/**)`]);
    assert.equal(config.permissions.deny.length, 4);
    assert.deepEqual(CONTRATO.configuracoes, { permissions: { blockReadsOutsideWorkingDirectories: true } }, "o contrato não é alterado");
  });
});

describe("ambiente dos processos do motor", () => {
  it("lista de permissão: nada do painel passa, e as chaves de API saem mesmo que alguém as peça", () => {
    const noDoNode = path.dirname(process.execPath);
    const base = { PATH: "p", Path: "p2", USERPROFILE: "C:/Users/x", SystemRoot: "C:/Windows", TEMP: "t", QUALQUER_OUTRA: "x", CLAUDE_CODE_OAUTH_TOKEN: "o", ...SEGREDOS_DO_PAINEL };
    const env = ambienteDoFilho({
      base,
      // O que as Configurações deixam vazio (aqui, a direção de arte e o movimento) não entra: vale o padrão do motor.
      definidas: { JOINVIXABLE_HEADLESS: "1", JOINVIXABLE_RODADAS: "3", JOINVIXABLE_DIRECAO_DE_ARTE: "", JOINVIXABLE_MOVIMENTO: null, PIXABAY_API_KEY: "chave-do-pixabay", BROWSER_PATH: "", CLI_MODEL: null, ANTHROPIC_API_KEY: "sk-ant-pedida-por-engano" },
      removidas: CONTRATO.variaveis_removidas,
    });
    assert.deepEqual(env, {
      // O Node que roda o painel vai na frente do PATH: os comandos do runbook chamam `node` pelo nome.
      PATH: `${noDoNode}${path.delimiter}p`,
      Path: `${noDoNode}${path.delimiter}p2`,
      USERPROFILE: "C:/Users/x",
      SystemRoot: "C:/Windows",
      TEMP: "t",
      JOINVIXABLE_HEADLESS: "1",
      JOINVIXABLE_RODADAS: "3",
      PIXABAY_API_KEY: "chave-do-pixabay",
    });
    // Do ambiente do painel nada do pipeline é herdado: só chega ao motor o que as Configurações dizem.
    assert.equal(ambienteDoFilho({ base: { JOINVIXABLE_RODADAS: "4", JOINVIXABLE_MOVIMENTO: "cinematografico" } }).JOINVIXABLE_RODADAS, undefined);
    for (const nome of ["GITHUB_TOKEN", "DEV_AREA_FTP_PASSWORD", "PANEL_ACCESS_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) {
      assert.ok(!VARIAVEIS_PERMITIDAS.includes(nome), `${nome} não está na lista de permissão`);
    }
  });
});

describe("stream do claude", () => {
  it("linhas partidas entre pedaços, com um acento cortado ao meio", () => {
    const linhas = [];
    const leitor = leitorDeLinhas((linha) => linhas.push(linha));
    const bytes = Buffer.from('{"a":"ação"}\r\n{"b":2}\n\n{"c":"fim sem quebra"}', "utf8");
    const meio = bytes.indexOf(Buffer.from("ç", "utf8")) + 1;
    for (const [de, ate] of [[0, 3], [3, meio], [meio, meio + 9], [meio + 9, bytes.length]]) leitor.escrever(bytes.subarray(de, ate));
    assert.deepEqual(linhas, ['{"a":"ação"}', '{"b":2}'], "a última linha ainda não terminou");
    leitor.fim();
    assert.deepEqual(linhas.map((linha) => JSON.parse(linha)), [{ a: "ação" }, { b: 2 }, { c: "fim sem quebra" }]);
  });

  it("progresso legível: etapa, ferramenta e comando, sem o corpo dos heredocs nem o conteúdo dos arquivos lidos", () => {
    const raiz = path.resolve("/dados/joinvixable/trabalho");
    const formatar = criarFormatador({ raiz });
    const uso = (id, name, input) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
    const volta = (id, content, is_error = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
    const cmd = "npm run -s step -- start geracao padaria --modelo=x\nnpm run -s tool -- write_file path=content.json <<'EOF'\n{ \"segredo\": 1 }\nEOF\nnpm run -s cliente -- padaria";
    assert.deepEqual(formatar(uso("a", "Bash", { command: cmd })), [
      { tipo: "etapa", texto: "Etapa geracao (padaria)" },
      { tipo: "ferramenta", texto: "write_file path=content.json" },
      { tipo: "comando", texto: "npm run -s cliente -- padaria" },
    ]);
    // As etapas das rodadas de crítica e refino aparecem como as outras.
    assert.deepEqual(formatar(uso("a2", "Bash", { command: "npm run -s step -- start critica padaria --modelo=x" })), [{ tipo: "etapa", texto: "Etapa critica (padaria)" }]);
    assert.deepEqual(formatar(volta("a", "BUILD OK. VALIDAÇÃO OK.\nsegunda linha")), [{ tipo: "saida", texto: "BUILD OK. VALIDAÇÃO OK." }]);
    assert.deepEqual(
      formatar(uso("b", "Read", { file_path: path.join(raiz, "projects", "p", ".session", "telas", "desktop-1.png") })),
      [{ tipo: "imagem", texto: "projects/p/.session/telas/desktop-1.png" }],
      "os caminhos aparecem relativos à pasta de trabalho",
    );
    assert.deepEqual(formatar(volta("b", [{ type: "image", source: { data: "AAAA" } }])), [], "o que o agente lê não vira linha de progresso");
    assert.deepEqual(formatar(uso("c", "Read", { file_path: path.join(raiz, "clientes", "p", "site.md") })), [{ tipo: "ferramenta", texto: "Read clientes/p/site.md" }]);
    assert.deepEqual(formatar(volta("c", "# Conteúdo inteiro do arquivo do cliente\ncom várias linhas")), [], "de uma leitura sai só o caminho");
    assert.deepEqual(formatar(volta("d", "Limite de 20 chamadas atingido.", true)), [{ tipo: "erro", texto: "Limite de 20 chamadas atingido." }]);
    assert.match(
      formatar({ type: "result", subtype: "success", is_error: false, duration_ms: 61000, num_turns: 9, total_cost_usd: 1.5 })[0].texto,
      /1m01s · 9 turnos · estimativa do Claude Code: US\$ 1\.5000 \(o consumo sai da assinatura\)/,
    );
    assert.deepEqual(formatar({ type: "joinvixable", subtype: "aviso", texto: "sessão nova" }), [{ tipo: "aviso", texto: "sessão nova" }]);
    assert.deepEqual(formatar({ type: "joinvixable", subtype: "inicio" }), []);
  });

  it("o filtro da tela cobre segredos e troca as pastas da máquina por rótulos, em qualquer grafia", () => {
    const filtro = criarFiltro({
      pastas: [["<painel>", "C:\\Users\\Ana\\Painel"], ["<pasta do motor>", "C:\\Users\\Ana\\Painel\\server\\data\\joinvixable\\trabalho"], ["~", "C:\\Users\\Ana"]],
      segredos: ["github_pat_segredo_do_teste", "curto", null],
    });
    assert.equal(filtro("li C:\\Users\\Ana\\Painel\\server\\data\\joinvixable\\trabalho\\projects\\h"), "li <pasta do motor>\\projects\\h", "a pasta mais funda vence");
    assert.equal(filtro("li c:/users/ana/painel/.env"), "li <painel>/.env", "barra normal e outra caixa");
    assert.equal(filtro('{"p":"C:\\\\Users\\\\Ana\\\\Documents"}'), '{"p":"~\\\\Documents"}', "barras dobradas, como dentro de um JSON");
    assert.equal(filtro("token github_pat_segredo_do_teste aqui"), "token ••• aqui");
    assert.equal(filtro("um valor curto demais não é tratado como segredo"), "um valor curto demais não é tratado como segredo");
  });
});
