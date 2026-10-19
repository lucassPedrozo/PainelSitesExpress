import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSerialQueue, writeFileAtomic } from "../../atomic-write.js";
import { HttpError } from "../../http.js";
import {
  comandoTexto,
  configuracoesDoAgente,
  ESFORCOS,
  esforcoDoContrato,
  executavel,
  montarComando,
  montarComandoTeste,
} from "./command.js";
import { ambienteDoFilho } from "./environment.js";
import { criarFiltro, criarFormatador, filtrarLegiveis, leitorDeLinhas } from "./stream.js";
import { gravarNoHistorico, prepararRaiz, projetosDoCliente, temSessao, ultimaSessao } from "./workspace.js";

/**
 * O executor do motor Claude: dispara o Claude Code em modo não interativo
 * (`claude -p`) com o login da assinatura, digita o pedido no lugar de uma
 * pessoa, lê o stream e guarda o que aconteceu.
 *
 * Nada do pipeline é refeito aqui. O agente continua sendo o Claude Code
 * seguindo o runbook do motor; etapas, ferramentas, limites e validação são os
 * comandos de sempre, rodados por ele. Este arquivo cuida do que fica em volta:
 *
 * - o claude usa a assinatura, nunca uma chave de API — o ambiente dele é uma
 *   lista de permissão, e a execução é interrompida se o próprio claude disser
 *   que achou uma chave;
 * - ferramentas e comandos em lista fechada, sem MCP, sem skills e sem rede;
 * - o pedido vai pelo stdin, com a frase do runbook;
 * - uma execução por vez nesta máquina, a não ser as que a fila põe lado a
 *   lado (os ajustes), cada uma com o seu projeto atual;
 * - sucesso é código de saída 0 **e** a validação do motor passando;
 * - ajuste, continuação e refino retomam a sessão de quem escreveu o site, e
 *   recuam para uma sessão nova quando ela sumiu; a crítica abre sempre uma
 *   sessão nova, que nunca é retomada;
 * - o modelo e o esforço são os que o projeto escolheu, senão os das
 *   Configurações, senão os que o motor espera;
 * - cancelamento em dois tempos, encerrando a árvore de processos;
 * - cada execução fica registrada, com o stream bruto em disco.
 */

/**
 * @typedef {{ tipo: "cliente", pasta: string, refazer?: boolean }
 *   | { tipo: "analisar", pasta: string, observacoes?: string }
 *   | { tipo: "ajuste", slug: string, pedido: string }
 *   | { tipo: "continuar", slug: string }
 *   | { tipo: "criticar", slug: string }
 *   | { tipo: "refinar", slug: string }
 *   | import("./edicao/executar.js").PedidoDeEdicao} Pedido
 * @typedef {"rodando" | "sucesso" | "falha" | "cancelada" | "aguardando_aprovacao" | "interrompida"} StatusExecucao
 * @typedef {import("./stream.js").Legivel} Legivel
 * @typedef {{ ts: string, legiveis: Legivel[], bruto?: unknown, slug?: string,
 *   sessionId?: string, etapa?: string | null }} EventoDaExecucao
 * @typedef {{
 *   id: string, status: Exclude<StatusExecucao, "rodando" | "interrompida">, pedido: string,
 *   slug?: string, pasta?: string, sessionId?: string, retomou?: string,
 *   codigoSaida: number | null, duracaoMs: number, custoEstimadoUsd: number | null,
 *   mensagem: string, etapaAberta?: string | null, projeto?: Record<string, any> | null,
 *   validacao?: { ok: boolean, texto: string }, sinais: string[], log: string,
 * }} ResultadoDaExecucao `projeto`: o que o motor respondeu em `estado` quando
 *   a execução terminou — é dele que o painel tira se o site foi entregue e
 *   qual é o passo seguinte.
 * @typedef {{ id: string, promessa: Promise<ResultadoDaExecucao>, cancelar(): void,
 *   readonly slug: string | undefined, readonly sessionId: string | undefined }} Execucao
 * @typedef {{ modelo?: string | null, esforco?: string | null }} Escolhas o
 *   modelo e o esforço que um projeto escolheu; vazio é "o das Configurações"
 * @typedef {{
 *   bin?: string, modelo?: string, esforco?: string, base?: NodeJS.ProcessEnv,
 *   ambiente?: Record<string, string | null | undefined>,
 *   protegidos?: string[], segredos?: Array<string | null | undefined>,
 * }} OpcoesDoExecutor
 */

const GUARDIAO = fileURLToPath(new URL("./guardian.js", import.meta.url));

/**
 * Quanto o claude tem para sair depois de escrever o resultado. Ele espera os
 * comandos que deixou em segundo plano; um que nunca termina seguraria a fila.
 */
const ESPERA_DEPOIS_DO_RESULTADO_MS = 20_000;

const FALHA_AUTH =
  /invalid api key|please run \/login|not logged in|oauth token (has )?expired|authentication[_ ]error|unauthorized|\b401\b/i;
const SEM_SESSAO = /no conversation found|session (id )?.*(not found|does not exist)/i;
/** `apiKeySource` do `system/init` quando o claude está no login da assinatura. Qualquer outro valor é uma chave de API. */
const SEM_CHAVE = new Set(["none", "oauth"]);
/** Ferramentas que o contrato nunca pede: rede, execução fora do Bash, delegação e MCP. */
const FERRAMENTA_FORA_DO_CONTRATO = /^(WebFetch|WebSearch|PowerShell|REPL|Agent|Task|Skill|NotebookEdit|Workflow)$|^mcp__/;

export const MSG_LOGIN = "Falha de autenticação do Claude Code: rode `claude` no terminal e faça login.";

const cortar = (texto, n) => (texto.length > n ? `${texto.slice(0, n)}…` : texto);

const novoId = () =>
  `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${Math.random().toString(36).slice(2, 6)}`;

/** @param {number | null | undefined} pid */
export function pidVivo(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ erro) {
    return erro?.code === "EPERM";
  }
}

const mesmoCaminho = (a, b) =>
  path.resolve(String(a)).replace(/\\/g, "/").toLowerCase() === path.resolve(String(b)).replace(/\\/g, "/").toLowerCase();

/**
 * Confere o `system/init` — o que o próprio claude diz ter aberto — contra o
 * contrato. Devolve o motivo quando algo não bate.
 *
 * @param {any} ev
 * @param {{ contrato: import("./command.js").Contrato, sites: string[], trabalho: string }} esperado
 * @returns {string | null}
 */
export function foraDoContrato(ev, { contrato, sites, trabalho }) {
  const mcp = (Array.isArray(ev.mcp_servers) ? ev.mcp_servers : []).filter(
    (servidor) => !servidor?.status || servidor.status === "connected" || servidor.status === "pending",
  );
  if (mcp.length) return `servidores MCP ligados: ${mcp.map((servidor) => servidor.name).join(", ")}`;

  // Os plugins embutidos vêm com o próprio Claude Code (`path: "builtin"`) e
  // aparecem em toda execução; o que não pode entrar é plugin do perfil.
  const plugins = (Array.isArray(ev.plugins) ? ev.plugins : []).filter(
    (plugin) => !(plugin?.path === "builtin" && String(plugin?.source ?? "").endsWith("@builtin")),
  );
  if (plugins.length) return `plugins carregados: ${plugins.map((plugin) => plugin?.name ?? "?").join(", ")}`;

  const pedidas = new Set([...contrato.ferramentas, ...(sites.length ? ["WebFetch"] : [])]);
  const sobrando = (Array.isArray(ev.tools) ? ev.tools : []).filter(
    (nome) => typeof nome === "string" && FERRAMENTA_FORA_DO_CONTRATO.test(nome) && !pedidas.has(nome),
  );
  if (sobrando.length) return `ferramentas além das permitidas: ${sobrando.join(", ")}`;

  if (typeof ev.permissionMode === "string" && ev.permissionMode !== contrato.modo_de_permissao) {
    return `modo de permissão "${ev.permissionMode}" no lugar de "${contrato.modo_de_permissao}"`;
  }
  if (typeof ev.cwd === "string" && ev.cwd && !mesmoCaminho(ev.cwd, trabalho)) {
    return "pasta de trabalho diferente da pasta do motor";
  }
  return null;
}

/**
 * @param {{
 *   motor: import("./motor.js").Motor,
 *   caminhos: import("./workspace.js").Caminhos,
 *   opcoes?: () => OpcoesDoExecutor,
 *   registrar?: (execucao: Record<string, any>) => unknown,
 *   validar?: (slug: string) => Promise<{ ok: boolean, texto: string }>,
 * }} dependencias
 *   `opcoes`: lidas a cada execução — o executável, o modelo e o esforço das
 *   Configurações, o que o painel passa ao ambiente do motor e o que o agente
 *   não pode ler nem ver.
 *   `registrar`: chamado a cada mudança da execução (o banco do painel).
 *   `validar`: os testes trocam o build de verdade por uma resposta pronta.
 */
export function criarExecutor({ motor, caminhos, opcoes = () => ({}), registrar = () => undefined, validar }) {
  const validarSite = validar ?? ((slug) => motor.validar(slug));

  const arquivoDoLog = (id) => path.join(caminhos.execucoes, `${id}.jsonl`);

  /**
   * Uma execução é regravada várias vezes (a sessão aparece, a etapa muda, ela
   * termina). Em fila, para a gravação mais velha nunca chegar por último.
   */
  const emOrdem = createSerialQueue();

  /** O filtro do que vai para a tela: pastas desta máquina viram rótulos, segredos somem. */
  const filtroDaTela = () => {
    const { segredos = [], base = process.env } = opcoes();
    return criarFiltro({
      pastas: [
        ["<pasta do motor>", caminhos.trabalho],
        ["<dados do motor>", caminhos.dados],
        ["<pacote do motor>", caminhos.motor],
        ["<painel>", path.resolve(caminhos.motor, "..")],
        ["~", base.USERPROFILE ?? base.HOME ?? null],
      ],
      segredos,
    });
  };

  /**
   * O modelo e o esforço de uma execução. Vale primeiro o que o projeto
   * escolheu, depois o das Configurações e, por fim, o que o motor espera — o
   * esforço esperado depende do tipo do pedido.
   *
   * @param {{ contrato: import("./command.js").Contrato, modeloEsperado: string,
   *   tipo?: import("./command.js").TipoDePedido, doProjeto?: Escolhas | null }} params
   */
  function resolver({ contrato, modeloEsperado, tipo, doProjeto = null }) {
    const configurado = opcoes();
    const esforcoEsperado = esforcoDoContrato(contrato, tipo);
    // Um nível que o claude não conhece (um `.env` editado à mão) não vira argumento dele.
    const nivel = (valor) => (ESFORCOS.includes(String(valor ?? "").trim()) ? String(valor).trim() : "");
    return {
      modelo: (doProjeto?.modelo ?? "").trim() || (configurado.modelo ?? "").trim() || modeloEsperado,
      modeloEsperado,
      esforco: nivel(doProjeto?.esforco) || nivel(configurado.esforco) || esforcoEsperado,
      esforcoEsperado,
    };
  }

  /* ---------------------------------------------------------------- *
   * Uma execução por vez
   * ---------------------------------------------------------------- */

  /** A execução em andamento nesta máquina — deste processo ou de outro painel na mesma pasta de dados. */
  function execucaoEmAndamento() {
    if (!existsSync(caminhos.trava)) return undefined;
    try {
      const trava = JSON.parse(readFileSync(caminhos.trava, "utf8"));
      return pidVivo(trava.pid) ? /** @type {{ pid: number, pedido: string, desde: string }} */ (trava) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Na subida do painel: a trava que sobrou de um processo que morreu sai. A
   * que leva o pid deste processo também é velha — ele acabou de nascer, e o
   * sistema só reaproveitou o número; sem isto ela bloquearia tudo para sempre.
   */
  function soltarTravaVelha() {
    if (!existsSync(caminhos.trava)) return false;
    let pid = null;
    try {
      pid = JSON.parse(readFileSync(caminhos.trava, "utf8")).pid;
    } catch {
      // trava ilegível: velha
    }
    if (pid !== process.pid && pidVivo(pid)) return false;
    rmSync(caminhos.trava, { force: true });
    return true;
  }

  /**
   * As execuções deste processo em andamento. A trava em disco diz a outro
   * painel na mesma pasta de dados que há alguma; esta lista diz quais.
   * @type {Map<string, { pedido: string, desde: string, slug?: string }>}
   */
  const emCurso = new Map();

  const gravarTrava = () => {
    const primeira = [...emCurso.values()][0];
    if (!primeira) return rmSync(caminhos.trava, { force: true });
    mkdirSync(caminhos.dados, { recursive: true });
    writeFileSync(
      caminhos.trava,
      JSON.stringify({ pid: process.pid, pedido: primeira.pedido, desde: primeira.desde, execucoes: emCurso.size }),
    );
  };

  /**
   * A assinatura é uma só: por padrão, uma execução de cada vez. A fila pode
   * pôr uma ao lado de outra (`aoLado`) — sites em criação e ajustes, cada um
   * na sua cota — porque cada execução tem o seu projeto "atual"
   * (`JOINVIXABLE_ATUAL`), e uma não escreve no projeto da outra. Nunca duas
   * no mesmo site, nem ao lado da execução de outro painel.
   *
   * @param {string} id
   * @param {string} pedido
   * @param {{ aoLado?: boolean, slug?: string }} [opcoes]
   */
  function travar(id, pedido, { aoLado = false, slug } = {}) {
    const outra = execucaoEmAndamento();
    const deOutroPainel = Boolean(outra && outra.pid !== process.pid);
    const noMesmoSite = Boolean(slug && [...emCurso.values()].some((execucao) => execucao.slug === slug));
    if (outra && (!aoLado || deOutroPainel || noMesmoSite)) {
      throw new HttpError(
        409,
        `Já há uma execução do Claude em andamento desde ${outra.desde.slice(11, 16)} (${outra.pedido}). Espere terminar ou cancele-a.`,
      );
    }
    emCurso.set(id, { pedido, desde: new Date().toISOString(), ...(slug ? { slug } : {}) });
    gravarTrava();
    return () => {
      emCurso.delete(id);
      gravarTrava();
    };
  }

  /** Onde a execução anota o projeto em que as ferramentas dela agem. */
  const arquivoDoAtual = (id) => path.join(caminhos.atual, `${id}.txt`);

  /* ---------------------------------------------------------------- *
   * O processo
   * ---------------------------------------------------------------- */

  /**
   * Roda o comando com o pedido no stdin e entrega cada linha do stdout. O
   * claude não é filho direto: quem o lança é o guardião, que o encerra se o
   * painel sumir.
   *
   * @param {{ comando: import("./command.js").Comando, entrada: string, env: Record<string, string>,
   *   onLinha: (linha: string) => void, aoIniciar?: (controle: { encerrar(sinal: string): void, vivo(): boolean }) => void,
   *   cwd?: string }} params `cwd`: a pasta de trabalho do claude — a do motor, a não
   *   ser na edição livre, em que é o clone do repositório do site
   * @returns {Promise<{ codigo: number | null, erroInicio?: string, stderr: string }>}
   */
  function rodarClaude({ comando, entrada, env, onLinha, aoIniciar, cwd = caminhos.trabalho }) {
    return new Promise((resolve) => {
      let stderr = "";
      let erroInicio;
      let filho;
      try {
        filho = spawn(process.execPath, [GUARDIAO, comando.bin, ...comando.args], {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          windowsHide: true,
        });
      } catch (/** @type {any} */ erro) {
        resolve({ codigo: null, erroInicio: erro?.message ?? String(erro), stderr });
        return;
      }

      const vivo = () => filho.exitCode === null && filho.signalCode === null;
      aoIniciar?.({
        encerrar: (sinal) => {
          if (!vivo()) return;
          if (filho.connected) filho.send({ tipo: "encerrar", sinal }, () => undefined);
          else filho.kill();
        },
        vivo,
      });

      filho.on("message", (/** @type {any} */ mensagem) => {
        if (mensagem?.tipo !== "erro") return;
        erroInicio =
          mensagem.codigo === "ENOENT"
            ? `Não encontrei o executável do Claude Code ("${comando.bin}"). Instale-o ou aponte o caminho em Configurações → Motor Claude.`
            : String(mensagem.mensagem ?? "o claude não iniciou");
      });

      const linhas = leitorDeLinhas(onLinha);
      filho.stdout.on("data", (pedaco) => linhas.escrever(pedaco));
      filho.stderr.on("data", (pedaco) => (stderr = (stderr + pedaco.toString("utf8")).slice(-20_000)));

      let terminou = false;
      /** @type {NodeJS.Timeout | undefined} */
      let folga;
      const terminar = (codigo) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(folga);
        linhas.fim();
        resolve({ codigo, erroInicio, stderr });
      };
      filho.on("error", (erro) => {
        erroInicio ??= erro.message;
        terminar(null);
      });
      // Um neto que herdou o stdout (um navegador que ficou para trás) seguraria
      // o `close` para sempre: depois da saída, o resto do stream tem 2 s.
      filho.on("exit", (codigo) => {
        folga = setTimeout(() => terminar(codigo), 2000);
      });
      filho.on("close", (codigo) => terminar(codigo));

      filho.stdin.on("error", () => undefined);
      filho.stdin.end(entrada, "utf8");
    });
  }

  /**
   * O que o painel põe no ambiente do claude e dos comandos que ele roda.
   * `id`: a execução, para o projeto atual ser só dela.
   */
  function ambienteDoClaude(contrato, modelo, id) {
    const { base = process.env, ambiente = {} } = opcoes();
    return ambienteDoFilho({
      base,
      definidas: {
        ...contrato.variaveis_definidas,
        ...ambiente,
        // Lançado pelo painel: o motor não lê o .env do pacote.
        JOINVIXABLE_PAINEL: "1",
        // Dentro do claude os comandos valem como no modo cli, e a etapa fica marcada como headless.
        JOINVIXABLE_HEADLESS: "1",
        JOINVIXABLE_HEADLESS_MODELO: modelo,
        JOINVIXABLE_TRABALHO: caminhos.trabalho,
        ...(id ? { JOINVIXABLE_ATUAL: arquivoDoAtual(id) } : {}),
        CLI_MODEL: modelo,
      },
      removidas: contrato.variaveis_removidas,
    });
  }

  /**
   * Deixa tudo pronto para lançar o claude: a pasta de trabalho, o runbook
   * gerado das fontes e o arquivo de configurações com o que o agente não lê.
   */
  async function preparar(contrato) {
    await prepararRaiz(caminhos);
    await fs.mkdir(caminhos.atual, { recursive: true });
    // Outra execução pode estar lendo estes dois arquivos agora: só são
    // regravados quando o conteúdo muda, e nunca pela metade.
    const rascunho = `${caminhos.runbook}.${process.pid}.${Date.now()}.novo`;
    try {
      await motor.gravarRunbook(rascunho);
      await trocarSeMudou(caminhos.runbook, await fs.readFile(rascunho, "utf8"));
    } finally {
      await fs.rm(rascunho, { force: true });
    }
    const { protegidos = [] } = opcoes();
    await trocarSeMudou(
      caminhos.configuracoes,
      `${JSON.stringify(configuracoesDoAgente({ contrato, protegidos }), null, 2)}\n`,
    );
  }

  /** A preparação de uma execução não se mistura com a de outra. */
  const umaPreparacaoPorVez = createSerialQueue();

  async function trocarSeMudou(arquivo, conteudo) {
    const atual = await fs.readFile(arquivo, "utf8").catch(() => null);
    if (atual !== conteudo) await writeFileAtomic(arquivo, conteudo);
  }

  /* ---------------------------------------------------------------- *
   * A execução
   * ---------------------------------------------------------------- */

  /**
   * Dispara o pedido e devolve o controle da execução. A promessa rejeita só
   * quando o pedido é recusado antes de rodar.
   *
   * @param {Pedido} pedido
   * @param {{ onEvento?: (evento: EventoDaExecucao) => void, esperaCancelamentoMs?: number,
   *   esperaDepoisDoResultadoMs?: number, extra?: Record<string, any>, aoLado?: boolean,
   *   doProjeto?: () => Escolhas | null | Promise<Escolhas | null> }} [deps] `extra`: campos
   *   do painel gravados junto da execução (o projeto, quem pediu).
   *   `doProjeto`: o modelo e o esforço que o projeto escolheu, lidos quando a
   *   execução começa — o que mudou enquanto o pedido esperava na fila já vale.
   *   `aoLado`: a fila decidiu que esta execução pode rodar junto de outra.
   * @returns {Execucao}
   */
  function iniciarExecucao(pedido, deps = {}) {
    const id = novoId();
    /** @type {string[]} */
    const sinais = [];
    let slug = "slug" in pedido ? pedido.slug : undefined;
    /** @type {string | undefined} */
    let sessionId;
    /** @type {{ encerrar(sinal: string): void, vivo(): boolean } | undefined} */
    let controle;
    let cancelada = false;
    let esperaMs = deps.esperaCancelamentoMs;
    const log = arquivoDoLog(id);

    const cancelar = () => {
      if (cancelada) return;
      cancelada = true;
      const alvo = controle;
      if (!alvo?.vivo()) return;
      // SIGINT primeiro, para o Claude Code fechar o turno; SIGTERM se ele não sair.
      // (No Windows não há sinais: o guardião encerra a árvore já no primeiro.)
      sinais.push("SIGINT");
      alvo.encerrar("SIGINT");
      const relogio = setTimeout(() => {
        if (!alvo.vivo()) return;
        sinais.push("SIGTERM");
        alvo.encerrar("SIGTERM");
      }, esperaMs ?? 8000);
      relogio.unref();
    };

    const rodar = async () => {
      // 1. Recusa, antes de gastar qualquer coisa, o pedido que o agente só
      //    poderia responder com uma pergunta ou um erro — e pega a frase.
      const { frase: texto, sites } = await motor.conferirPedido(pedido);
      const soltar = travar(id, texto, { aoLado: deps.aoLado === true, slug });
      const inicio = Date.now();
      try {
        const { headless: contrato, modeloEsperado } = await motor.ambiente();
        esperaMs ??= contrato.cancelamento_espera_ms;
        const configurado = opcoes();
        const doProjeto = await Promise.resolve(deps.doProjeto?.()).catch(() => null);
        const { modelo, esforco } = resolver({ contrato, modeloEsperado, tipo: pedido.tipo, doProjeto });
        const pasta = "pasta" in pedido ? pedido.pasta : undefined;
        const filtro = filtroDaTela();

        /** @type {Record<string, any>} */
        const registro = {
          ...(deps.extra ?? {}),
          id,
          data: new Date(inicio).toISOString(),
          tipo: pedido.tipo,
          pedido: texto,
          status: "rodando",
          modelo,
          esforco,
          pid: process.pid,
          log: path.basename(log),
          ...(pasta ? { pasta } : {}),
        };
        let etapa = null;
        /** Devolve a promessa da gravação, para o fim da execução esperar a última. */
        const gravar = () => {
          if (slug) registro.slug = slug;
          registro.etapa = etapa;
          const fotografia = { ...registro };
          return emOrdem(async () => {
            // Nem o banco do painel nem o histórico do projeto podem derrubar a execução.
            await Promise.resolve()
              .then(() => registrar(fotografia))
              .catch(() => undefined);
            if (fotografia.slug) {
              await gravarNoHistorico(caminhos.trabalho, fotografia.slug, fotografia).catch(() => undefined);
            }
          });
        };
        const emitir = (legiveis, bruto) => {
          const daEtapa = legiveis.map((linha) => /^Etapa (\w+) \(/.exec(linha.tipo === "etapa" ? linha.texto : "")?.[1]).find(Boolean);
          if (daEtapa && daEtapa !== etapa) {
            etapa = daEtapa;
            void gravar();
          }
          if (legiveis.length || bruto !== undefined) {
            deps.onEvento?.({
              ts: new Date().toISOString(),
              legiveis: filtrarLegiveis(legiveis, filtro),
              bruto,
              slug,
              sessionId,
              etapa,
            });
          }
        };
        const anotar = (subtype, dados) =>
          appendFileSync(log, `${JSON.stringify({ type: "joinvixable", subtype, ts: new Date().toISOString(), ...dados })}\n`);
        const aviso = (mensagem) => {
          anotar("aviso", { texto: mensagem });
          emitir([{ tipo: "aviso", texto: mensagem }]);
        };

        await umaPreparacaoPorVez(() => preparar(contrato));
        mkdirSync(caminhos.execucoes, { recursive: true });
        void gravar();

        // O slug de uma geração só nasce durante ela: sai do registro do cliente.
        const projetosAgora = () => (pedido.tipo === "cliente" ? projetosDoCliente(caminhos.trabalho, pedido.pasta) : []);
        const conhecidos = new Set(projetosAgora());
        const procurarSlug = () => {
          if (slug) return;
          const novo = projetosAgora().find(
            (nome) => !conhecidos.has(nome) && !nome.startsWith("_") && !nome.startsWith(".") && temSessao(caminhos.trabalho, nome),
          );
          if (novo) {
            slug = novo;
            void gravar();
          }
        };

        const tentar = async (resume) => {
          const comando = montarComando({
            contrato,
            bin: configurado.bin,
            modelo,
            esforco,
            tipo: pedido.tipo,
            resume,
            sites,
            pasta,
            runbook: caminhos.runbook,
            configuracoes: caminhos.configuracoes,
          });
          const formatar = criarFormatador({ raiz: caminhos.trabalho });
          const t = {
            /** @type {any} */ init: undefined,
            /** @type {any} */ resultado: undefined,
            ultimoTexto: "",
            /** @type {string | undefined} */ chaveApi: undefined,
            /** @type {string | null} */ fora: null,
            /** O claude entregou o resultado e não saiu: o painel o encerrou. */
            encerradoDepoisDoResultado: false,
          };
          /** @type {NodeJS.Timeout | undefined} */
          let depoisDoResultado;
          anotar("inicio", { pedido: texto, comando: comandoTexto(comando), retomando: resume ?? null });
          if (cancelada) return { ...t, codigo: null, stderr: "", erroInicio: undefined };

          const saida = await rodarClaude({
            comando,
            entrada: texto,
            env: ambienteDoClaude(contrato, modelo, id),
            aoIniciar: (novoControle) => (controle = novoControle),
            onLinha: (linha) => {
              appendFileSync(log, `${linha}\n`);
              /** @type {any} */
              let ev;
              try {
                ev = JSON.parse(linha);
              } catch {
                emitir([{ tipo: "saida", texto: cortar(linha, 300) }], linha);
                return;
              }
              if (typeof ev.session_id === "string" && ev.session_id !== sessionId) {
                sessionId = ev.session_id;
                registro.session_id = sessionId;
                void gravar();
              }
              if (ev.type === "system" && ev.subtype === "init") {
                t.init = ev;
                registro.mcp = (ev.mcp_servers ?? []).map((servidor) => String(servidor.name));
                if (ev.model && ev.model !== modelo) {
                  anotar("aviso", { texto: `O claude informou o modelo "${ev.model}"; o executor pediu "${modelo}".` });
                }
                if (ev.apiKeySource && !SEM_CHAVE.has(String(ev.apiKeySource))) {
                  t.chaveApi = String(ev.apiKeySource);
                  controle?.encerrar("SIGTERM");
                } else {
                  t.fora = foraDoContrato(ev, { contrato, sites, trabalho: caminhos.trabalho });
                  if (t.fora) controle?.encerrar("SIGTERM");
                }
              }
              if (ev.type === "assistant") {
                for (const bloco of ev.message?.content ?? []) {
                  if (bloco.type === "text" && String(bloco.text).trim()) t.ultimoTexto = String(bloco.text).trim();
                }
              }
              if (ev.type === "result") {
                t.resultado = ev;
                // O resultado é a última coisa que o claude escreve. Se ele não
                // sai em seguida, ficou preso em um comando que largou rodando
                // em segundo plano: o trabalho acabou, e a fila não espera por isso.
                clearTimeout(depoisDoResultado);
                depoisDoResultado = setTimeout(() => {
                  if (!controle?.vivo()) return;
                  t.encerradoDepoisDoResultado = true;
                  aviso("O claude entregou o resultado e não saiu (um comando ficou rodando em segundo plano). O painel encerrou o processo.");
                  controle.encerrar("SIGTERM");
                }, deps.esperaDepoisDoResultadoMs ?? ESPERA_DEPOIS_DO_RESULTADO_MS);
              }
              if (ev.type === "user") procurarSlug();
              emitir(formatar(ev), ev);
            },
          });
          clearTimeout(depoisDoResultado);
          if (saida.stderr.trim()) anotar("stderr", { texto: saida.stderr.trim() });
          // Encerrado pelo painel depois de entregar o resultado: a saída vale como a de quem terminou sozinho.
          return { ...t, ...saida, ...(t.encerradoDepoisDoResultado && !cancelada ? { codigo: 0 } : {}) };
        };

        // Ajuste, continuação e refino seguem na conversa de quem escreveu o
        // site. A crítica nunca: é de uma sessão nova, que não viu o site nascer.
        const retoma = pedido.tipo === "ajuste" || pedido.tipo === "continuar" || pedido.tipo === "refinar";
        const anterior = retoma ? ultimaSessao(caminhos.trabalho, /** @type {string} */ (slug)) : null;
        if (retoma && !anterior) aviso(`"${slug}" não tem sessão anterior do Claude: abrindo uma sessão nova.`);
        let t = await tentar(anterior);
        // A sessão a retomar não existe mais: o claude sai antes de abrir qualquer sessão.
        if (anterior && !cancelada && !t.init && !t.erroInicio && (SEM_SESSAO.test(t.stderr) || !FALHA_AUTH.test(t.stderr))) {
          aviso(`A sessão ${anterior} não existe mais: abrindo uma sessão nova com o mesmo pedido.`);
          registro.sessao_nova_por_falha = true;
          t = await tentar(null);
        } else if (anterior) registro.retomou = anterior;
        procurarSlug();

        const duracaoMs = Date.now() - inicio;
        const final = String(t.resultado?.result ?? "").trim() || t.ultimoTexto;
        const erroNoResultado = t.resultado ? t.resultado.is_error === true || t.resultado.subtype !== "success" : false;
        const proj = slug && temSessao(caminhos.trabalho, slug) ? await motor.estadoDoProjeto(slug).catch(() => null) : null;

        /** @type {ResultadoDaExecucao["status"]} */
        let status = "falha";
        let mensagem;
        /** @type {{ ok: boolean, texto: string } | undefined} */
        let validacao;
        if (cancelada) {
          status = "cancelada";
          mensagem = "Execução cancelada.";
        } else if (t.chaveApi) {
          mensagem = `O Claude Code informou apiKeySource="${t.chaveApi}": ele usaria uma chave de API, não o login da assinatura. A execução foi interrompida antes de gastar.`;
        } else if (t.fora) {
          mensagem = `O Claude Code abriu fora do contrato do painel (${t.fora}). A execução foi interrompida antes de gastar.`;
        } else if (t.erroInicio) {
          mensagem = t.erroInicio;
        } else if ((erroNoResultado || t.codigo !== 0) && FALHA_AUTH.test(`${final}\n${t.stderr}`)) {
          mensagem = `${MSG_LOGIN}${final ? ` (${cortar(final, 200)})` : ""}`;
        } else if (t.codigo !== 0 || erroNoResultado) {
          mensagem = final || t.stderr.trim().split("\n").pop() || `O claude saiu com o código ${t.codigo}.`;
        } else if (pedido.tipo === "analisar") {
          // Sucesso = código 0 e o briefing aceito pela conferência do motor.
          let erros;
          try {
            const conferido = await motor.conferirBriefing(pedido.pasta);
            erros = conferido.erros ?? [];
          } catch (/** @type {any} */ erro) {
            erros = [erro?.message ?? String(erro)];
          }
          status = erros.length ? "falha" : "sucesso";
          mensagem = erros.length
            ? // Quando o claude para sem escrever o briefing, é a explicação dele que diz o que faltou.
              `O claude terminou, mas o briefing não passa na conferência:\n${erros.map((erro, i) => `${i + 1}. ${erro}`).join("\n")}${final ? `\nO que o claude disse: ${final}` : ""}`
            : final || "Briefing aceito.";
        } else if (!slug || !proj) {
          mensagem = final || "O claude terminou sem criar nenhum projeto.";
        } else if (proj.etapaAberta) {
          mensagem = `O claude terminou com a etapa "${proj.etapaAberta}" aberta.${final ? ` Última mensagem: ${final}` : ""}`;
        } else if (proj.aguardandoAprovacao) {
          status = "aguardando_aprovacao";
          mensagem = "Direção criativa pronta, esperando a aprovação de uma pessoa.";
        } else if (pedido.tipo === "ajuste" && !registro.etapa) {
          // O claude saiu sem erro, mas nunca abriu a etapa de ajuste: não
          // seguiu o runbook, e o site está como estava. Não é sucesso — e o
          // que ele respondeu costuma dizer por quê.
          mensagem = `O claude terminou sem abrir a etapa de ajuste: nada foi alterado no site.${final ? ` Última mensagem: ${final}` : ""}`;
        } else {
          // Sucesso = código 0 e a validação do motor passando.
          validacao = await validarSite(slug);
          status = validacao.ok ? "sucesso" : "falha";
          mensagem = validacao.ok ? final || "Site validado." : `O claude terminou, mas a validação não passou:\n${validacao.texto}`;
        }

        const custo = typeof t.resultado?.total_cost_usd === "number" ? t.resultado.total_cost_usd : null;
        Object.assign(registro, {
          status,
          duracao_ms: duracaoMs,
          // Estimativa do Claude Code a preço de API: o consumo real sai da assinatura.
          total_cost_usd: custo,
          codigo_saida: t.codigo,
          turnos: t.resultado?.num_turns,
          mensagem: cortar(filtro(mensagem), 2000),
          etapa_aberta: proj?.etapaAberta ?? null,
          sinais,
        });
        delete registro.pid;
        anotar("fim", { status, mensagem: registro.mensagem });
        await gravar();

        return {
          id,
          status,
          pedido: texto,
          slug,
          pasta,
          sessionId,
          retomou: registro.retomou,
          codigoSaida: t.codigo,
          duracaoMs,
          custoEstimadoUsd: custo,
          mensagem: filtro(mensagem),
          etapaAberta: proj?.etapaAberta ?? null,
          projeto: proj,
          validacao,
          sinais,
          log,
        };
      } finally {
        rmSync(arquivoDoAtual(id), { force: true });
        soltar();
      }
    };

    return {
      id,
      promessa: rodar(),
      cancelar,
      get slug() {
        return slug;
      },
      get sessionId() {
        return sessionId;
      },
    };
  }

  /**
   * O log de uma execução, em linhas legíveis e já filtradas. É a mesma
   * tradução do acompanhamento ao vivo, refeita a partir do stream guardado.
   *
   * @param {string} id
   * @param {{ raiz?: string }} [opcoesDoLog] `raiz`: a pasta de trabalho da execução, quando não é a do motor
   * @returns {Legivel[]}
   */
  function lerLog(id, { raiz = caminhos.trabalho } = {}) {
    if (!/^[\w-]+$/.test(id)) return [];
    const arquivo = arquivoDoLog(id);
    if (!existsSync(arquivo)) return [];
    const formatar = criarFormatador({ raiz });
    const filtro = filtroDaTela();
    /** @type {Legivel[]} */
    const linhas = [];
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      if (!linha.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(linha);
      } catch {
        linhas.push({ tipo: "saida", texto: filtro(cortar(linha, 300)) });
        continue;
      }
      linhas.push(...filtrarLegiveis(formatar(ev), filtro));
    }
    return linhas;
  }

  /* ---------------------------------------------------------------- *
   * Conferências do Claude Code
   * ---------------------------------------------------------------- */

  /** `claude --version`, ou o motivo de não ter rodado. Não gasta nada. */
  function versaoClaude() {
    return new Promise((resolve) => {
      const { bin: caminho, prefixo } = executavel(opcoes().bin);
      let saida = "";
      let filho;
      try {
        filho = spawn(caminho, [...prefixo, "--version"], {
          windowsHide: true,
          env: ambienteDoFilho({ base: opcoes().base ?? process.env }),
        });
      } catch {
        resolve({ encontrado: false, versao: null });
        return;
      }
      const relogio = setTimeout(() => filho.kill(), 15_000);
      filho.stdout.on("data", (pedaco) => (saida += pedaco));
      filho.on("error", () => {
        clearTimeout(relogio);
        resolve({ encontrado: false, versao: null });
      });
      filho.on("close", () => {
        clearTimeout(relogio);
        resolve({ encontrado: Boolean(saida.trim()), versao: saida.trim() || null });
      });
    });
  }

  /**
   * O comando que uma geração dispararia, para mostrar à pessoa. Não roda nada.
   *
   * @param {{ tipo?: import("./command.js").TipoDePedido, sites?: string[], pasta?: string | null,
   *   doProjeto?: Escolhas | null }} [params] `doProjeto`: o que o projeto
   *   escolheu; sem ele, o comando é o das Configurações
   */
  async function comandoPrevisto({ tipo = "cliente", sites = [], pasta = null, doProjeto = null } = {}) {
    const { headless: contrato, modeloEsperado } = await motor.ambiente();
    const configurado = opcoes();
    const escolhido = resolver({ contrato, modeloEsperado, tipo, doProjeto });
    const comando = montarComando({
      contrato,
      bin: configurado.bin,
      modelo: escolhido.modelo,
      esforco: escolhido.esforco,
      tipo,
      sites,
      pasta,
      runbook: caminhos.runbook,
      configuracoes: caminhos.configuracoes,
    });
    return { texto: filtroDaTela()(comandoTexto(comando)), ...escolhido };
  }

  /**
   * Um `claude -p` mínimo, que só responde "ok": diz se o login da assinatura
   * está funcionando. GASTA UM POUCO da assinatura — só roda a pedido. O
   * modelo é o das Configurações: o teste não é de nenhum projeto.
   */
  async function testarClaude() {
    const { headless: contrato, modeloEsperado } = await motor.ambiente();
    const configurado = opcoes();
    const { modelo } = resolver({ contrato, modeloEsperado });
    const soltar = travar(`teste-${Date.now().toString(36)}`, "teste do login do Claude");
    try {
      await prepararRaiz(caminhos);
      /** @type {any} */
      let init;
      /** @type {any} */
      let resultado;
      let texto = "";
      /** @type {{ encerrar(sinal: string): void } | undefined} */
      let alvo;
      const relogio = setTimeout(() => alvo?.encerrar("SIGTERM"), 120_000);
      const saida = await rodarClaude({
        comando: montarComandoTeste({ contrato, bin: configurado.bin, modelo }),
        entrada: "Responda apenas com a palavra: ok",
        env: ambienteDoClaude(contrato, modelo),
        aoIniciar: (controle) => (alvo = controle),
        onLinha: (linha) => {
          try {
            const ev = JSON.parse(linha);
            if (ev.type === "system" && ev.subtype === "init") {
              init = ev;
              if (ev.apiKeySource && !SEM_CHAVE.has(String(ev.apiKeySource))) alvo?.encerrar("SIGTERM");
            }
            if (ev.type === "assistant") {
              for (const bloco of ev.message?.content ?? []) if (bloco.type === "text") texto = String(bloco.text).trim();
            }
            if (ev.type === "result") resultado = ev;
          } catch {
            // linha que não é JSON: não interessa ao teste
          }
        },
      });
      clearTimeout(relogio);

      const base = {
        modelo: init?.model ?? null,
        apiKeySource: init?.apiKeySource ?? null,
        resposta: cortar(String(resultado?.result ?? texto), 200),
        // Estimativa do Claude Code; o consumo sai da assinatura.
        custoEstimadoUsd: typeof resultado?.total_cost_usd === "number" ? resultado.total_cost_usd : null,
      };
      if (saida.erroInicio) return { ...base, ok: false, mensagem: saida.erroInicio };
      if (base.apiKeySource && !SEM_CHAVE.has(base.apiKeySource)) {
        return {
          ...base,
          ok: false,
          mensagem: `O Claude Code está usando uma chave de API (apiKeySource="${base.apiKeySource}"), não o login da assinatura.`,
        };
      }
      const erro = saida.codigo !== 0 || !resultado || resultado.is_error === true || resultado.subtype !== "success";
      if (erro && FALHA_AUTH.test(`${base.resposta}\n${saida.stderr}`)) return { ...base, ok: false, mensagem: MSG_LOGIN };
      if (erro) {
        return {
          ...base,
          ok: false,
          mensagem: base.resposta || saida.stderr.trim().split("\n").pop() || `O claude saiu com o código ${saida.codigo}.`,
        };
      }
      return { ...base, ok: true, mensagem: `O Claude Code respondeu "${cortar(base.resposta, 80)}" pelo login da assinatura.` };
    } finally {
      soltar();
    }
  }

  /* ---------------------------------------------------------------- *
   * Uma rodada do claude fora do motor (a edição livre)
   * ---------------------------------------------------------------- */

  /**
   * Roda um `claude -p` numa pasta que não é a do motor, com outro contrato,
   * e devolve o que ele fez. As mesmas guardas da execução do motor valem
   * aqui: o login da assinatura (nunca chave de API), nada de MCP, de plugin
   * do perfil, de ferramenta fora do contrato nem de outra pasta de trabalho,
   * e o processo que entrega o resultado e não sai é encerrado.
   *
   * Não decide sucesso: quem chama confere o que mudou na pasta.
   *
   * @param {{
   *   contrato: import("./command.js").Contrato, comando: import("./command.js").Comando,
   *   entrada: string, cwd: string, env: Record<string, string>, log: string,
   *   emitir: (legiveis: Legivel[], bruto?: unknown) => void,
   *   aoIniciar: (controle: { encerrar(sinal: string): void, vivo(): boolean }) => void,
   *   aoSessao?: (sessionId: string) => void,
   *   cancelada: () => boolean,
   *   esperaDepoisDoResultadoMs?: number,
   * }} params `log`: o arquivo do stream bruto da execução
   */
  async function rodarSessao({ contrato, comando, entrada, cwd, env, log, emitir, aoIniciar, aoSessao, cancelada, esperaDepoisDoResultadoMs }) {
    const formatar = criarFormatador({ raiz: cwd });
    const t = {
      /** @type {any} */ init: undefined,
      /** @type {any} */ resultado: undefined,
      ultimoTexto: "",
      /** @type {string | undefined} */ chaveApi: undefined,
      /** @type {string | null} */ fora: null,
      /** @type {string | undefined} */ sessionId: undefined,
    };
    /** @type {{ encerrar(sinal: string): void, vivo(): boolean } | undefined} */
    let controle;
    /** @type {NodeJS.Timeout | undefined} */
    let depoisDoResultado;
    let encerradoDepoisDoResultado = false;
    appendFileSync(log, `${JSON.stringify({ type: "joinvixable", subtype: "inicio", ts: new Date().toISOString(), comando: comandoTexto(comando) })}\n`);
    const saida = await rodarClaude({
      comando,
      entrada,
      env,
      cwd,
      aoIniciar: (novo) => {
        controle = novo;
        aoIniciar(novo);
      },
      onLinha: (linha) => {
        appendFileSync(log, `${linha}\n`);
        /** @type {any} */
        let ev;
        try {
          ev = JSON.parse(linha);
        } catch {
          emitir([{ tipo: "saida", texto: cortar(linha, 300) }], linha);
          return;
        }
        if (typeof ev.session_id === "string" && ev.session_id !== t.sessionId) {
          t.sessionId = ev.session_id;
          aoSessao?.(ev.session_id);
        }
        if (ev.type === "system" && ev.subtype === "init") {
          t.init = ev;
          if (ev.apiKeySource && !SEM_CHAVE.has(String(ev.apiKeySource))) {
            t.chaveApi = String(ev.apiKeySource);
            controle?.encerrar("SIGTERM");
          } else {
            t.fora = foraDoContrato(ev, { contrato, sites: [], trabalho: cwd });
            if (t.fora) controle?.encerrar("SIGTERM");
          }
        }
        if (ev.type === "assistant") {
          for (const bloco of ev.message?.content ?? []) {
            if (bloco.type === "text" && String(bloco.text).trim()) t.ultimoTexto = String(bloco.text).trim();
          }
        }
        if (ev.type === "result") {
          t.resultado = ev;
          clearTimeout(depoisDoResultado);
          depoisDoResultado = setTimeout(() => {
            if (!controle?.vivo()) return;
            encerradoDepoisDoResultado = true;
            controle.encerrar("SIGTERM");
          }, esperaDepoisDoResultadoMs ?? ESPERA_DEPOIS_DO_RESULTADO_MS);
        }
        emitir(formatar(ev), ev);
      },
    });
    clearTimeout(depoisDoResultado);
    if (saida.stderr.trim()) {
      appendFileSync(log, `${JSON.stringify({ type: "joinvixable", subtype: "stderr", ts: new Date().toISOString(), texto: saida.stderr.trim() })}\n`);
    }
    const codigo = encerradoDepoisDoResultado && !cancelada() ? 0 : saida.codigo;
    const final = String(t.resultado?.result ?? "").trim() || t.ultimoTexto;
    const erroNoResultado = t.resultado ? t.resultado.is_error === true || t.resultado.subtype !== "success" : false;

    /** Por que a rodada não serve, ou `null` quando o claude terminou bem. */
    let falha = null;
    if (t.chaveApi) {
      falha = `O Claude Code informou apiKeySource="${t.chaveApi}": ele usaria uma chave de API, não o login da assinatura. A execução foi interrompida antes de gastar.`;
    } else if (t.fora) {
      falha = `O Claude Code abriu fora do contrato do painel (${t.fora}). A execução foi interrompida antes de gastar.`;
    } else if (saida.erroInicio) {
      falha = saida.erroInicio;
    } else if ((erroNoResultado || codigo !== 0) && FALHA_AUTH.test(`${final}\n${saida.stderr}`)) {
      falha = `${MSG_LOGIN}${final ? ` (${cortar(final, 200)})` : ""}`;
    } else if (codigo !== 0 || erroNoResultado) {
      falha = final || saida.stderr.trim().split("\n").pop() || `O claude saiu com o código ${codigo}.`;
    }
    return {
      codigo,
      falha,
      final,
      sessionId: t.sessionId,
      custoEstimadoUsd: typeof t.resultado?.total_cost_usd === "number" ? t.resultado.total_cost_usd : null,
      turnos: t.resultado?.num_turns ?? null,
    };
  }

  return {
    iniciarExecucao,
    rodarSessao,
    /** As peças que a edição livre usa do executor: a trava, o filtro da tela, o registro e o arquivo do stream. */
    travar,
    filtroDaTela,
    arquivoDoLog,
    novoId,
    emOrdem,
    registrar: (/** @type {Record<string, any>} */ execucao) =>
      emOrdem(() =>
        Promise.resolve()
          .then(() => registrar(execucao))
          .catch(() => undefined),
      ),
    opcoes,
    execucaoEmAndamento,
    soltarTravaVelha,
    /** Tira de um texto os caminhos desta máquina e os segredos, antes de ele ir à tela. */
    filtrar: (/** @type {string} */ texto) => filtroDaTela()(String(texto ?? "")),
    lerLog,
    versaoClaude,
    resolver,
    comandoPrevisto,
    testarClaude,
  };
}

/** @typedef {ReturnType<typeof criarExecutor>} Executor */
