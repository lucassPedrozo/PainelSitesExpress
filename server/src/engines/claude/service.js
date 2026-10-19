import { existsSync, readdirSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { claudeConfig, config, envPath, isDevAreaConfigured, runtimeConfig } from "../../config.js";
import { commitSite, createOrgRepository, getRepository } from "../../deploy/github/git-data.js";
import { githubConfig } from "../../deploy/operations.js";
import { followDevArea, publishDevAreaNow } from "../../devarea/service.js";
import { httpError, publicMessageOf, statusOf } from "../../http.js";
import { isPixabayConfigured, parseStockSelection, pixabay, pixabayKey } from "../../images/pixabay.js";
import { GenerationGuard } from "../../lovable/generation-guard.js";
import { slugForProject } from "../../preview/service.js";
import * as registro from "../../store/claude.js";
import {
  adoptClaudeSite,
  listGenerations,
  recordClaudeSite,
  setClaudeSitePushed,
  setGenerationDevArea,
  setGenerationRepository,
} from "../../store/generations.js";
import { isValidRepoName, repoNameOf } from "../../../../shared/lovable-repo.js";
import { isLocalProjectId } from "../../store/local-projects.js";
import { copiarSiteAdotado, sitesDoMotorNoProjeto } from "./adopt.js";
import { conferirAnexos, gravarPendente, guardarAnexo, removerAnexo } from "./attachments.js";
import { ESFORCOS, MODELO_INVALIDO, MODELO_VALIDO, MODELOS } from "./command.js";
import { ambienteDoFilho } from "./environment.js";
import { criarExecutor } from "./executor.js";
import { copiarMaterial, pacoteDoMaterial, planoDoMaterial } from "./material.js";
import { criarMotor, estadoDoPacote } from "./motor.js";
import { arquivosDoSite, conferirSaida, dependenciasDoTemplate, EnvioBloqueado } from "./publish.js";
import { Fila } from "./queue.js";
import { caminhosDoMotor } from "./workspace.js";
import { criarEdicaoLivre } from "./edicao/executar.js";
import { criarGit } from "./edicao/git.js";
import * as memoria from "../../store/repo-edits.js";

/**
 * O motor Claude dentro do painel: liga o pacote do motor, o executor do
 * `claude -p` e a fila ao banco e às regras do painel.
 *
 * Quatro coisas moram aqui e em nenhum outro lugar:
 *
 * - **a trava do gasto** (`CLAUDE_ENABLE_GENERATION`): desligada, o painel
 *   confere tudo e mostra o comando, mas nada entra na fila;
 * - **a proteção contra repetição**: um pedido por projeto de cada vez —
 *   esperando, rodando ou interrompido;
 * - **a sequência de um site**: cada execução que termina bem põe na fila o
 *   passo seguinte que o motor indica — a crítica, o refino —, e o site só
 *   entra na lista de sites e vai ao GitHub quando o motor o dá por entregue;
 * - **o que o agente não pode ver**: o ambiente dele é montado aqui, e a lista
 *   do que ele não lê (o `.env`, a chave da service account, a pasta de dados
 *   fora da pasta de trabalho) também.
 *
 * As rotas (`routes.js`) só traduzem HTTP para as funções daqui.
 */

/** Quantos sites nascem ao mesmo tempo quando as Configurações não dizem. */
const SITES_JUNTOS = 3;
/** Quantos ajustes rodam ao mesmo tempo quando as Configurações não dizem. */
const AJUSTES_JUNTOS = 5;
/** De quantas execuções já terminadas o log continua à mão da tela. */
const LOGS_GUARDADOS = 4;

/** Uma tarefa local (build, capturas) não roda junto com outra. */
const TAREFA_OCUPADA = (nome) =>
  httpError(409, `Já há uma tarefa em andamento (${nome}). Espere terminar.`);

const MAX_EVENTOS = 3000;
/** No envio automático, quantos nomes o painel tenta antes de pedir um a alguém. */
const TENTATIVAS_DE_NOME = 5;
const MAX_CARACTERES_DO_AJUSTE = 4000;

/** Variável cujo valor é segredo: some de qualquer texto antes de ele ir à tela. */
const NOME_DE_SEGREDO = /TOKEN|KEY|SECRET|PASSWORD|SENHA|CREDENTIAL/i;

/** Os pedidos que o motor indica como passo seguinte de um site (`proximo`). */
const PROXIMOS = new Set(["continuar", "criticar", "refinar"]);

/**
 * O passo seguinte de um site, ou `null` quando o motor não indica nenhum.
 * @param {any} estado a resposta de `estado`
 * @returns {"continuar" | "criticar" | "refinar" | null}
 */
const proximoDe = (estado) => (PROXIMOS.has(estado?.proximo) ? estado.proximo : null);

/**
 * Um passo da sequência de um site: o pedido e o ponto do pipeline em que ele
 * é dado. A sequência não dá o mesmo passo duas vezes.
 * @param {string} tipo
 * @param {any} estado a resposta de `estado`
 */
const passoDe = (tipo, estado) => `${tipo}@${estado?.pipeline?.fase ?? "?"}:${estado?.pipeline?.rodada ?? "?"}`;

/**
 * O modelo e o esforço que um projeto escolheu para as execuções dele.
 * @param {Record<string, any> | null | undefined} entry
 * @returns {{ modelo: string | null, esforco: string | null }}
 */
const escolhasDe = (entry) => ({ modelo: entry?.options?.modelo ?? null, esforco: entry?.options?.esforco ?? null });

/** As imagens que o painel devolve da pasta de trabalho. SVG fica de fora: pode carregar script. */
const IMAGENS = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const dentroDe = (raiz, alvo) => {
  const a = path.resolve(raiz);
  const b = path.resolve(alvo);
  return b === a || b.startsWith(a + path.sep);
};

/**
 * O que o agente não lê: os arquivos de segredo do painel e tudo o que há na
 * pasta de dados fora da pasta de trabalho dele — o banco, as sessões, os
 * tokens do Lovable, os arquivos dos outros projetos, os streams das outras
 * execuções.
 *
 * Uma regra de negação vale mais que a de permissão. Por isso nada que
 * contenha a pasta de trabalho entra na lista: negar uma pasta de cima
 * deixaria o agente sem ler o próprio projeto.
 *
 * @param {{
 *   segredos: Array<string | null | undefined>, dataDir: string,
 *   caminhos: import("./workspace.js").Caminhos,
 *   listar?: (dir: string) => string[],
 * }} params em `segredos`, o `.env` e a chave da service account
 * @returns {string[]}
 */
export function caminhosProtegidos({ segredos, dataDir, caminhos, listar = readdirSync }) {
  const lista = segredos.filter((alvo) => typeof alvo === "string" && alvo.trim() !== "").map(String);
  for (const [dir, poupada] of [
    [dataDir, path.basename(caminhos.dados)],
    [caminhos.dados, path.basename(caminhos.trabalho)],
  ]) {
    let nomes = [];
    try {
      nomes = listar(dir);
    } catch {
      // a pasta ainda não existe: não há o que proteger nela
    }
    for (const nome of nomes) if (nome !== poupada) lista.push(path.join(dir, nome));
  }
  return lista.filter((alvo) => !dentroDe(alvo, caminhos.trabalho));
}

/**
 * @param {{
 *   dataDir?: string,
 *   lerConfig?: typeof claudeConfig,
 *   base?: () => NodeJS.ProcessEnv,
 *   motor?: any,
 *   validar?: (slug: string) => Promise<{ ok: boolean, texto: string }>,
 *   ambienteExtra?: () => Record<string, string | null | undefined>,
 *   nomeDoProjeto?: (projectId: string) => Promise<string>,
 *   fonte?: (projectId: string) => import("./material.js").Fonte,
 *   github?: { conta: () => { githubToken: string, organization: string }, config: () => any,
 *     getRepository: typeof getRepository, createOrgRepository: typeof createOrgRepository,
 *     commitSite: typeof commitSite },
 *   areaDeAprovacao?: { configurada: () => boolean, publicar: typeof publishDevAreaNow,
 *     acompanhar: typeof followDevArea },
 *   log?: (linha: string) => void,
 *   git?: import("./edicao/git.js").GitDaEdicao,
 * }} [dependencias]
 *   `git`: o Git da edição livre; os testes trocam o GitHub por um repositório local.
 *   Tudo tem padrão de produção; os testes trocam o que precisam — o motor
 *   por um de mentira, o `claude` pelo falso (via `lerConfig().bin`).
 */
export function criarServicoClaude({
  dataDir = config.dataDir,
  lerConfig = claudeConfig,
  base = () => process.env,
  motor: motorDado = null,
  validar,
  ambienteExtra = () => ({}),
  nomeDoProjeto = slugForProject,
  fonte,
  github = { conta: runtimeConfig, config: githubConfig, getRepository, createOrgRepository, commitSite },
  areaDeAprovacao = { configurada: isDevAreaConfigured, publicar: publishDevAreaNow, acompanhar: followDevArea },
  log = (linha) => console.error(linha),
  git: gitDado = null,
} = {}) {
  const dirMotor = lerConfig().engineDir;
  const caminhos = caminhosDoMotor({ dataDir, dirMotor });
  const entrada = path.join(caminhos.dados, "entrada");
  const guarda = new GenerationGuard();

  /* ---------------------------------------------------------------- *
   * O que os processos do motor recebem — e o que não recebem
   * ---------------------------------------------------------------- */

  /** O que o painel passa de forma explícita ao motor e ao claude. */
  const doPainel = () => {
    const cfg = lerConfig();
    return {
      // Lançado pelo painel: o motor não lê o `.env` da pasta dele.
      JOINVIXABLE_PAINEL: "1",
      JOINVIXABLE_TRABALHO: caminhos.trabalho,
      CLI_MODEL: cfg.model,
      BROWSER_PATH: cfg.browserPath,
      // O que as Configurações dizem do pipeline. Vazio não entra no ambiente,
      // e aí vale o padrão do motor.
      JOINVIXABLE_APROVACAO_HUMANA: cfg.humanApproval === true ? "1" : cfg.humanApproval === false ? "0" : "",
      JOINVIXABLE_RODADAS: cfg.reviewRounds ? String(cfg.reviewRounds) : "",
      JOINVIXABLE_DIRECAO_DE_ARTE: cfg.artDirection ?? "",
      JOINVIXABLE_MOVIMENTO: cfg.motion ?? "",
      // A única chave que o agente carrega: a busca de fotos de banco roda como filha dele.
      PIXABAY_API_KEY: pixabayKey(),
      ...ambienteExtra(),
    };
  };

  /** Cada segredo do painel, com o nome da variável dele. */
  const segredosNomeados = () =>
    /** @type {Array<[string, string]>} */ (
      Object.entries(base())
        .filter(([nome, valor]) => NOME_DE_SEGREDO.test(nome) && typeof valor === "string" && valor.trim().length >= 8)
        .map(([nome, valor]) => [nome, /** @type {string} */ (valor).trim()])
    );

  /** Os valores que nunca aparecem na tela, mesmo que o agente os escreva. */
  const segredos = () => segredosNomeados().map(([, valor]) => valor);

  /** Refeito a cada execução, porque a pasta de dados ganha arquivos com o tempo. */
  const protegidos = () => {
    // A chave da service account, pelo mesmo caminho que `config.js` resolve.
    const chave = (base().GOOGLE_CREDENTIALS_PATH ?? "").trim();
    return caminhosProtegidos({
      segredos: [
        envPath,
        path.join(config.projectRoot, "server", ".env"),
        chave ? (path.isAbsolute(chave) ? chave : path.join(config.projectRoot, chave)) : null,
      ],
      dataDir,
      caminhos,
    });
  };

  const motorCru =
    motorDado ??
    criarMotor({
      dirMotor,
      ambiente: () => ambienteDoFilho({ base: base(), definidas: doPainel() }),
      log,
    });

  const executor = criarExecutor({
    motor: motorCru,
    caminhos,
    validar,
    opcoes: () => ({
      bin: lerConfig().bin,
      modelo: lerConfig().model,
      esforco: lerConfig().effort,
      base: base(),
      ambiente: doPainel(),
      protegidos: protegidos(),
      segredos: segredos(),
    }),
    registrar: async (execucao) => {
      const descartados = await registro.recordClaudeRun(execucao);
      for (const arquivo of descartados) {
        // O stream bruto sai junto com o registro que o citava.
        if (/^[\w.-]+$/.test(arquivo)) rmSync(path.join(caminhos.execucoes, arquivo), { force: true });
      }
    },
  });

  /* ---------------------------------------------------------------- *
   * A edição livre: ajustes pelo Claude em sites de repositório
   * ---------------------------------------------------------------- */

  /** Onde ficam os rascunhos de imagem dos pedidos de ajuste de um repositório. */
  const dirDosAnexosDaEdicao = (/** @type {string} */ repo) =>
    path.join(caminhos.dados, "edicao-anexos", repo.replace(/[^A-Za-z0-9._-]+/g, "--"));

  const gitDaEdicao = gitDado ?? criarGit({ token: () => github.conta().githubToken ?? "", base });
  const edicao = criarEdicaoLivre({
    executor,
    caminhos,
    git: gitDaEdicao,
    // Com o clone como pasta de trabalho: o resto da pasta de dados (o banco,
    // o motor, os outros clones) fica de fora, além dos segredos do painel.
    protegidosPara: (dir) => {
      const chave = (base().GOOGLE_CREDENTIALS_PATH ?? "").trim();
      return caminhosProtegidos({
        segredos: [
          envPath,
          path.join(config.projectRoot, "server", ".env"),
          chave ? (path.isAbsolute(chave) ? chave : path.join(config.projectRoot, chave)) : null,
        ],
        dataDir,
        caminhos: { ...caminhos, trabalho: dir },
      });
    },
    segredosNomeados: () => segredosNomeados(),
    escolhas: () => ({ modelo: lerConfig().model, esforco: lerConfig().effort, bin: lerConfig().bin }),
    ambienteBase: base,
    // Vazio em produção; os testes passam por aqui o cenário do claude falso.
    ambienteExtra,
    dirDosAnexos: dirDosAnexosDaEdicao,
  });

  /**
   * Todo texto de uma resposta do motor, pelo filtro da tela.
   * @template T
   * @param {T} dados
   * @returns {T}
   */
  const limpo = (dados) => {
    if (typeof dados === "string") return /** @type {any} */ (executor.filtrar(dados));
    if (Array.isArray(dados)) return /** @type {any} */ (dados.map(limpo));
    if (dados && typeof dados === "object") {
      return /** @type {any} */ (Object.fromEntries(Object.entries(dados).map(([chave, valor]) => [chave, limpo(valor)])));
    }
    return dados;
  };

  /**
   * A revisão do briefing. O briefing e as opções são o que a pessoa edita na
   * tela e regrava: vão como estão, para o que volta ser o que ela escreveu.
   * @param {any} revisao
   */
  const revisaoLimpa = (revisao) =>
    revisao && typeof revisao === "object"
      ? { ...limpo(revisao), ...("briefing" in revisao ? { briefing: revisao.briefing } : {}), ...("opcoes" in revisao ? { opcoes: revisao.opcoes } : {}) }
      : revisao;

  /**
   * As respostas do motor que vão inteiras para a tela. A conferência diz em
   * que pasta procurou o briefing, e o site traz o que o agente escreveu (a
   * direção criativa, as rotas, a crítica, o motivo de uma falha): nada disso
   * chega com um caminho desta máquina ou com um segredo.
   * @type {Record<string, (resposta: any) => any>}
   */
  const PARA_A_TELA = {
    revisao: revisaoLimpa,
    gravarBriefing: revisaoLimpa,
    gravarOpcoes: revisaoLimpa,
    projeto: limpo,
    abortar: limpo,
    recusarFoto: limpo,
    aprovar: limpo,
    rota: limpo,
  };

  /**
   * O motor, com o que ele diz passado pelo filtro da tela: as respostas
   * acima e as mensagens de recusa, que vêm escritas para a pessoa mas podem
   * citar um caminho desta máquina.
   */
  const motor = new Proxy(motorCru, {
    get(alvo, nome) {
      const valor = alvo[nome];
      if (typeof valor !== "function") return valor;
      const paraATela = PARA_A_TELA[String(nome)] ?? ((/** @type {any} */ resposta) => resposta);
      return (...args) => {
        const limpar = (/** @type {any} */ erro) => {
          if (erro?.expose === true && typeof erro.message === "string") erro.message = executor.filtrar(erro.message);
          throw erro;
        };
        try {
          const resposta = valor.apply(alvo, args);
          return resposta instanceof Promise ? resposta.then(paraATela).catch(limpar) : paraATela(resposta);
        } catch (erro) {
          return limpar(erro);
        }
      };
    },
  });

  /* ---------------------------------------------------------------- *
   * A fila e o que acontece na tela
   * ---------------------------------------------------------------- */

  /** @type {Fila | undefined} */
  let fila;
  /** @type {Promise<Fila> | undefined} */
  let subindo;
  /** Muda a cada subida do painel: a tela percebe que o cursor dela ficou velho. */
  const epoca = randomBytes(4).toString("hex");
  let sequencia = 0;
  /**
   * O que cada execução escreveu por último, por item da fila: com ajustes
   * rodando ao lado da criação, cada uma tem o seu log.
   * @type {Map<string, Array<{ n: number, ts: string, legiveis: import("./stream.js").Legivel[] }>>}
   */
  const recentes = new Map();
  /** O item que escreveu por último: é o log que a tela vê quando não pede nenhum. */
  let ultimoItem = "";
  /** A etapa em que cada execução está, para o card. @type {Map<string, string>} */
  const etapas = new Map();
  /** @type {string | undefined} */
  let tarefa;
  /**
   * Os projetos cuja execução acabou de sair da fila e ainda está sendo
   * registrada (o resumo do card, o site na lista de sites).
   * @type {Map<string, import("./queue.js").ItemDaFila>}
   */
  const fechando = new Map();

  /**
   * Sobe a fila uma vez: o que estava rodando quando o painel caiu vira
   * interrompido, e o que esperava volta pausado.
   */
  function pronta() {
    subindo ??= (async () => {
      executor.soltarTravaVelha();
      const emOutroPainel = executor.execucaoEmAndamento();
      await registro.interruptRunningClaudeRuns((run) => Boolean(emOutroPainel && emOutroPainel.pid === run.pid));

      await memoria.interruptRunningRepoEdits();

      const nova = new Fila({
        iniciar: (pedido, deps) =>
          pedido.tipo === "edicao"
            ? iniciarEdicao(/** @type {any} */ (pedido), deps)
            : executor.iniciarExecucao(pedido, {
            ...deps,
            // Quem decide o que roda junto é a fila.
            aoLado: true,
            // O modelo e o esforço do projeto, como estiverem quando a execução começar.
            doProjeto: async () => {
              const projectId = deps.extra?.projectId;
              return projectId ? escolhasDe(await registro.getClaudeProject(projectId)) : null;
            },
          }),
        salvos: await registro.loadClaudeQueue(),
        salvar: (itens) => registro.saveClaudeQueue(itens),
        vagas: () => {
          const cfg = lerConfig();
          return { criacoes: cfg.parallelSites ?? SITES_JUNTOS, ajustes: cfg.parallelAdjustments ?? AJUSTES_JUNTOS };
        },
        // O passo seguinte do site entra na fila antes de a vaga dele passar a outro.
        seguir: (fim) => seguirSite(fim),
      });
      nova.on("evento", (evento, item) => {
        if (evento.etapa) etapas.set(item.id, evento.etapa);
        // Só o que é legível vai à tela, e já filtrado pelo executor. O evento
        // bruto fica no arquivo da execução.
        if (!evento.legiveis?.length) return;
        let doItem = recentes.get(item.id);
        if (!doItem) {
          // Ficam os logs do que roda agora e os das últimas execuções que terminaram.
          const vivos = new Set(nova.estado().rodandoTodos.map((rodando) => rodando.id));
          for (const antigo of [...recentes.keys()].filter((id) => !vivos.has(id)).slice(0, -LOGS_GUARDADOS)) {
            recentes.delete(antigo);
            etapas.delete(antigo);
          }
          recentes.set(item.id, (doItem = []));
        }
        ultimoItem = item.id;
        doItem.push({ n: ++sequencia, ts: evento.ts, legiveis: evento.legiveis });
        if (doItem.length > MAX_EVENTOS) doItem.shift();
      });
      nova.on("fim", (fim) => {
        // Entre a execução sair da fila e o resumo do projeto ser regravado, o
        // projeto continua ocupado: sem isto o card mostraria por um instante
        // a situação de antes, e aceitaria outro pedido em cima dela.
        const projectId = fim.item.extra?.projectId;
        if (projectId) fechando.set(projectId, fim.item);
        void aoTerminar(fim)
          .catch((erro) => log(`[claude] depois da execução: ${erro?.message ?? erro}`))
          .finally(() => {
            if (projectId && fechando.get(projectId) === fim.item) fechando.delete(projectId);
          });
      });
      fila = nova;
      return nova;
    })();
    return subindo;
  }

  /** Por que a geração está (ou não está) liberada neste servidor. */
  function liberacao() {
    if (lerConfig().enableGeneration) return { enabled: true, reason: null };
    return {
      enabled: false,
      reason:
        "A geração pelo Claude está desligada. Ligue “Liberar o uso do Claude” em " +
        "Configurações → Motor Claude (cada execução consome a assinatura do Claude Code).",
    };
  }

  const exigirLiberacao = () => {
    const estado = liberacao();
    if (!estado.enabled) throw httpError(423, /** @type {string} */ (estado.reason));
  };

  /**
   * O teste do login ("Testar Claude") usa a mesma trava de uma execução: um
   * pedido que começasse no meio dele falharia por causa do teste, não dele.
   */
  let testando = false;
  /** Antes de tudo o que dispara o Claude Code: nada começa no meio do teste, nem com a trava desligada. */
  const exigirDisparo = () => {
    if (testando) throw httpError(409, "O teste do Claude está em andamento. Tente de novo em instantes.");
    exigirLiberacao();
  };

  /** O pacote do motor está nesta cópia do painel? */
  const pacote = () => (motorDado ? { instalado: true, motivo: null } : estadoDoPacote(dirMotor));

  /**
   * O item da fila como a tela o vê.
   * @param {import("./queue.js").ItemDaFila} item
   */
  const itemParaATela = (item) => ({
    id: item.id,
    estado: item.estado,
    tipo: item.pedido.tipo,
    frase: item.frase,
    criadoEm: item.criadoEm,
    inicio: item.inicio ?? null,
    projectId: item.extra?.projectId ?? null,
    por: item.extra?.por ?? null,
    slug: item.slug ?? null,
    execucaoId: item.execucaoId ?? null,
    etapa: item.estado === "rodando" ? (etapas.get(item.id) ?? null) : null,
    // O painel pôs na fila sozinho, na sequência de outra execução do mesmo site.
    encadeado: item.extra?.encadeado === true,
  });

  /**
   * O pedido que ocupa o projeto: o que está na fila ou o que acabou de rodar
   * e ainda está sendo registrado.
   * @param {string} projectId
   */
  const pendenteDe = (projectId) =>
    /** @type {Fila} */ (fila).itens().find((item) => item.extra?.projectId === projectId) ??
    fechando.get(projectId) ??
    null;

  /** Um pedido por projeto de cada vez — esperando, rodando ou interrompido. */
  function exigirSemPendencia(projectId) {
    const pendente = pendenteDe(projectId);
    if (!pendente) return;
    const motivo = {
      esperando: "já tem um pedido esperando na fila do Claude",
      rodando: "tem uma execução do Claude em andamento",
      interrompida: "tem uma execução interrompida — retome-a ou descarte-a antes de pedir outra",
    }[pendente.estado];
    throw httpError(409, `Este projeto ${motivo}.`);
  }

  /**
   * Reserva o projeto enquanto um pedido é montado: o segundo clique é
   * recusado na hora, sem esperar a cópia do material do primeiro.
   *
   * @template T
   * @param {string} projectId
   * @param {() => Promise<T>} fn
   */
  async function comReserva(projectId, fn) {
    const soltar = guarda.acquire(projectId);
    try {
      await pronta();
      exigirSemPendencia(projectId);
      return await fn();
    } finally {
      soltar();
    }
  }

  /**
   * @template T
   * @param {string} nome
   * @param {() => Promise<T>} fn
   */
  async function comTarefa(nome, fn) {
    if (tarefa) throw TAREFA_OCUPADA(tarefa);
    tarefa = nome;
    try {
      return await fn();
    } finally {
      tarefa = undefined;
    }
  }

  /* ---------------------------------------------------------------- *
   * O projeto no motor
   * ---------------------------------------------------------------- */

  const pastaDoCliente = (pasta) => path.join(caminhos.trabalho, "clientes", pasta);

  /** O registro do projeto no motor, criado (com a pasta de trabalho) na primeira vez. */
  async function abrirProjeto(projectId, quem = null) {
    const existente = await registro.getClaudeProject(projectId);
    const entry = existente ?? (await registro.ensureClaudeProject(projectId, { name: await nomeDoProjeto(projectId), by: quem }));
    await fs.mkdir(pastaDoCliente(entry.folder), { recursive: true });
    return entry;
  }

  /** O projeto que já passou pelo motor, ou 409 com o que fazer. */
  async function exigirProjeto(projectId) {
    const entry = await registro.getClaudeProject(projectId);
    if (!entry) throw httpError(409, "Este projeto ainda não tem briefing do Claude. Gere o briefing primeiro.");
    return entry;
  }

  /** O site do projeto no motor, ou 409. */
  async function exigirSite(projectId) {
    const entry = await exigirProjeto(projectId);
    if (!entry.slug) throw httpError(409, "Este projeto ainda não tem site gerado pelo Claude.");
    return /** @type {typeof entry & { slug: string }} */ (entry);
  }

  /**
   * Refaz o resumo que o card mostra — o briefing e o site —, perguntando ao
   * motor. Chamado depois de cada execução e de cada mudança feita pela tela.
   *
   * @param {string} projectId
   * @param {Record<string, unknown>} [junto] gravado junto com o resumo
   * @param {{ slug: string, estado: Record<string, any> } | null} [sabido] o
   *   estado de um site que quem chama acabou de receber do motor
   */
  async function atualizarResumo(projectId, junto = {}, sabido = null) {
    const entry = await registro.getClaudeProject(projectId);
    if (!entry) return null;
    const agora = new Date().toISOString();
    // Tudo numa gravação só: o card nunca vê a execução nova com o resumo velho.
    /** @type {Record<string, unknown>} */
    const patch = { ...junto };
    try {
      const conferido = await motor.conferirBriefing(entry.folder);
      patch.briefing = {
        state: !conferido.existe ? "missing" : conferido.erros.length ? "refused" : "ok",
        errors: conferido.existe ? conferido.erros.length : 0,
        warnings: conferido.avisos?.length ?? 0,
        checkedAt: agora,
      };
      // O registro do cliente, no motor, é quem diz qual é o site mais recente.
      const slug = (Array.isArray(conferido.projetos) ? conferido.projetos.at(-1) : null) ?? entry.slug;
      if (slug) {
        const estado = sabido?.slug === slug ? sabido.estado : await motor.estadoDoProjeto(slug);
        patch.slug = slug;
        patch.site = {
          awaitingApproval: Boolean(estado.aguardandoAprovacao),
          openStage: estado.etapaAberta ?? null,
          // O pipeline inteiro terminou: geração, revisão e as rodadas de crítica e refino.
          delivered: Boolean(estado.entregue),
          situation: estado.situacao ?? null,
          // Onde o site está no pipeline e o pedido que o faz andar (`null`: nenhum).
          phase: estado.pipeline?.fase ?? null,
          round: estado.pipeline?.rodada ?? null,
          rounds: estado.pipeline?.rodadas ?? null,
          next: proximoDe(estado),
          checkedAt: agora,
        };
      }
    } catch (/** @type {any} */ erro) {
      log(`[claude] resumo de ${entry.folder}: ${erro?.message ?? erro}`);
    }
    return registro.patchClaudeProject(projectId, patch);
  }

  /**
   * Põe na fila o passo seguinte do mesmo site — a continuação, a crítica ou
   * o refino que o motor indica —, em nome de quem pediu o primeiro e com a
   * mesma permissão de publicar. É assim que uma geração vira uma sequência
   * de execuções sem ninguém clicar entre elas.
   *
   * A sequência para sozinha em dois casos, e o card fica com "Continuar":
   * com a trava desligada (ou outra recusa na hora de enfileirar), e quando o
   * motor pede de novo um passo que ela já deu no mesmo ponto do pipeline —
   * uma execução que não fez o site andar não é repetida sem alguém decidir.
   *
   * @param {string} projectId
   * @param {import("./queue.js").ItemDaFila} anterior o pedido que acabou de rodar
   * @param {string} slug
   * @param {Record<string, any>} estado o que o motor respondeu em `estado`
   */
  async function encadear(projectId, anterior, slug, estado) {
    const tipo = proximoDe(estado);
    if (!tipo) return null;
    const passo = passoDe(tipo, estado);
    const trilha = Array.isArray(anterior.extra?.trilha) ? anterior.extra.trilha : [];
    if (trilha.includes(passo)) {
      log(`[claude] ${slug}: o motor pede de novo "${tipo}" no mesmo ponto do pipeline; a sequência parou.`);
      return null;
    }
    try {
      return await enfileirar(projectId, { tipo, slug }, anterior.extra?.por ?? null, {
        publicar: anterior.extra?.publicar === true,
        encadeado: true,
        trilha: [...trilha, passo],
      });
    } catch (/** @type {any} */ erro) {
      log(`[claude] ${slug}: a sequência não seguiu sozinha (${erro?.message ?? erro}).`);
      return null;
    }
  }

  /**
   * O estado do site no motor, como o executor o viu ao decidir o fim da
   * execução; `null` quando ela não terminou bem ou não mexeu em site.
   * @param {import("./queue.js").FimDeItem} fim
   */
  const estadoAoFim = (fim) => {
    const r = fim.resultado;
    return r?.status === "sucesso" && r.slug && fim.item.pedido.tipo !== "analisar" ? (r.projeto ?? null) : null;
  };

  /**
   * Chamado pela fila quando uma execução termina, antes de a vaga dela
   * passar adiante: com pipeline pela frente, o passo seguinte do site entra
   * na fila já — e na frente de quem ainda não começou. É o que deixa vários
   * sites nascerem juntos sem que um pare o outro entre as etapas.
   * @param {import("./queue.js").FimDeItem} fim
   */
  async function seguirSite(fim) {
    const projectId = fim.item.extra?.projectId;
    const estado = estadoAoFim(fim);
    if (!projectId || !estado || estado.entregue) return;
    await encadear(projectId, fim.item, /** @type {string} */ (fim.resultado?.slug), estado);
  }

  /**
   * O que fazer quando uma execução termina. Se terminou bem e o motor dá o
   * site por entregue, ele entra na lista de sites do projeto e segue para o
   * GitHub; se ainda há pipeline pela frente, o passo seguinte entra na fila
   * (por `seguirSite`, que roda junto). Em qualquer caso, o resumo do card é
   * refeito.
   */
  async function aoTerminar(fim) {
    const projectId = fim.item.extra?.projectId;
    if (!projectId) return;
    if (fim.item.pedido.tipo === "edicao") return aoTerminarEdicao(projectId, fim);
    const r = fim.resultado;
    const quem = fim.item.extra?.por ?? null;
    const estado = estadoAoFim(fim);

    if (estado?.entregue) {
      // Site entregue: entra na lista de sites do projeto, como os dos outros
      // motores, e daí segue para o GitHub e a área de aprovação. Antes disso
      // — entre a geração e a última rodada de refino — nada sai desta máquina.
      await recordClaudeSite(projectId, { slug: r.slug, by: quem });
      // Só segue sozinho quando quem pediu a geração também poderia enviá-lo;
      // senão o card para em "Enviar ao GitHub", para quem pode.
      const { githubToken, organization } = github.conta();
      if (fim.item.extra?.publicar === true && githubToken && organization) {
        await enviar(projectId, { quem, automatico: true }).catch((erro) =>
          log(`[claude] envio automático de ${r.slug} ao GitHub: ${erro?.message ?? erro}`),
        );
      }
    } else if (estado) {
      // O resumo sai com o passo seguinte já na fila.
      await fim.seguindo;
    }
    await atualizarResumo(
      projectId,
      {
        lastRun: {
          id: r?.id ?? fim.item.execucaoId ?? null,
          type: fim.item.pedido.tipo,
          status: r?.status ?? "falha",
          message: executor.filtrar(String(r?.mensagem ?? fim.erro ?? "")).slice(0, 2000),
          at: new Date().toISOString(),
          durationMs: r?.duracaoMs ?? null,
        },
        ...(r?.slug ? { slug: r.slug } : {}),
      },
      estado && r?.slug ? { slug: r.slug, estado } : null,
    );
  }

  /** @param {string} projectId @param {Record<string, any>} entry @param {Fila} filaAtual */
  function resumoDe(projectId, entry, filaAtual) {
    const item = pendenteDe(projectId);
    const esperando = filaAtual.estado().esperando;
    return {
      folder: entry.folder,
      slug: entry.slug ?? null,
      queue: item
        ? {
            ...itemParaATela(item),
            // 1 = o próximo a rodar.
            posicao: item.estado === "esperando" ? esperando.findIndex((outro) => outro.id === item.id) + 1 : null,
          }
        : null,
      material: entry.material ?? null,
      briefing: entry.briefing ?? null,
      // Um resumo gravado antes de o painel guardar o ponto do pipeline sai com ele em branco.
      site: entry.site ? { phase: null, round: null, rounds: null, next: null, ...entry.site } : null,
      lastRun: entry.lastRun ?? null,
      push: entry.push ?? null,
    };
  }

  /* ---------------------------------------------------------------- *
   * O site a caminho do GitHub
   * ---------------------------------------------------------------- */

  /** Um envio por projeto de cada vez: o segundo clique não cria outro repositório. */
  const enviando = new Set();

  /** O site do Claude mais recente do projeto. */
  async function siteDoClaude(projectId) {
    const lista = (await listGenerations())[projectId] ?? [];
    return [...lista].reverse().find((item) => item.engine === "claude" && item.claudeSlug) ?? null;
  }

  const dirTemplate = path.join(dirMotor, "template");
  const dirDoSite = (slug) => path.join(caminhos.trabalho, "projects", slug);

  /** O que iria ao repositório, e o que impede de ir. Só lê. */
  async function conferirEnvio(slug) {
    const plano = await arquivosDoSite({ dirTemplate, dirProjeto: dirDoSite(slug) });
    const motivos = await conferirSaida(plano.files, {
      declaradas: await dependenciasDoTemplate(dirTemplate),
      segredos: segredosNomeados(),
    });
    return { plano, motivos };
  }

  /** O repositório do site: o que ele já tem, ou um novo na organização. */
  async function repositorioDo(projectId, site, { repoName, privado, automatico }) {
    const { organization } = github.conta();
    const conhecido = (site.devArea?.state === "retired" ? null : site.devArea?.repoFullName) ?? site.repoFullName;
    if (conhecido) {
      const [owner, name] = conhecido.split("/");
      const repo = await github.getRepository(github.config(), { owner, repo: name });
      if (!repo) {
        throw httpError(
          409,
          `O repositório ${conhecido} não foi encontrado (ou o token do GitHub não o enxerga). Confira-o no GitHub.`,
        );
      }
      return { repo, criado: false };
    }

    const sugerido = repoNameOf(await nomeDoProjeto(projectId)).slice(0, 80) || site.claudeSlug;
    const pedido = typeof repoName === "string" ? repoName.trim() : "";
    // Sem ninguém para escolher, o painel acha um nome livre; com alguém, o
    // nome ocupado volta como recusa — pode ser o repositório de outro site.
    const candidatos = pedido
      ? [pedido]
      : automatico
        ? Array.from({ length: TENTATIVAS_DE_NOME }, (_, n) => (n === 0 ? sugerido : `${sugerido}-${n + 1}`))
        : [sugerido];
    for (const nome of candidatos) {
      if (!isValidRepoName(nome)) {
        throw httpError(400, "Nome de repositório inválido — use letras, números, hífen, ponto e sublinhado.");
      }
      if (await github.getRepository(github.config(), { owner: organization, repo: nome })) {
        if (candidatos.length > 1) continue;
        throw httpError(409, `Já existe o repositório ${organization}/${nome}. Escolha outro nome para este site.`);
      }
      const repo = await github.createOrgRepository(github.config(), {
        organization,
        name: nome,
        isPrivate: privado !== false,
        description: "Site gerado pelo painel Sites Express",
      });
      // Gravado já: se o envio dos arquivos falhar, tentar de novo atualiza
      // este repositório em vez de esbarrar no nome que agora existe.
      await setGenerationRepository(projectId, site.id, repo.full_name);
      return { repo, criado: true };
    }
    throw httpError(409, `Os nomes ${candidatos.join(", ")} já existem na organização. Envie pelo projeto, escolhendo o nome.`);
  }

  /**
   * Manda o site validado ao GitHub — o código-fonte, pronto para o workflow
   * da área de aprovação construir — e registra o resultado no projeto.
   *
   * @param {string} projectId
   * @param {{ quem?: string | null, repoName?: unknown, privado?: boolean,
   *   automatico?: boolean, validado?: boolean }} [opcoes]
   *   `automatico`: logo depois de uma execução, sem ninguém para escolher o
   *   nome do repositório. `validado`: a validação acabou de passar.
   */
  async function enviar(projectId, { quem = null, repoName, privado = true, automatico = false, validado = automatico } = {}) {
    const { githubToken, organization } = github.conta();
    if (!githubToken || !organization) {
      throw httpError(
        503,
        "O GitHub ainda não foi configurado. Preencha o token e a organização em Configurações → GitHub e publicação.",
      );
    }
    const site = await siteDoClaude(projectId);
    if (!site) throw httpError(409, "Este projeto ainda não tem site gerado e validado pelo Claude.");
    if (enviando.has(projectId)) throw httpError(409, "Este site já está sendo enviado ao GitHub. Aguarde terminar.");

    enviando.add(projectId);
    const agora = () => new Date().toISOString();
    try {
      const slug = site.claudeSlug;
      // O mesmo build e a mesma validação que fecham uma etapa: arquivo
      // travado alterado, build quebrado ou site sem assinatura não saem
      // daqui. Logo depois de uma execução, a validação é a que ela acabou de passar.
      if (!validado) {
        const validacao = await comTarefa(`validação de ${slug}`, () => (validar ? validar(slug) : motor.validar(slug)));
        if (!validacao.ok) {
          throw new EnvioBloqueado(`O site não passa na validação e não foi enviado:\n${executor.filtrar(validacao.texto)}`);
        }
      }
      const { plano, motivos } = await conferirEnvio(slug);
      if (motivos.length) throw new EnvioBloqueado(motivos.join("\n"));

      const { repo, criado } = await repositorioDo(projectId, site, { repoName, privado, automatico });
      const [owner, name] = repo.full_name.split("/");
      const commit = await github.commitSite({
        config: github.config(),
        owner,
        repo: name,
        branch: repo.default_branch || "main",
        message: criado ? "Site gerado pelo painel Sites Express" : "Atualizar o site pelo painel Sites Express",
        files: plano.files.map((file) => ({ path: file.path, read: () => fs.readFile(file.absolute) })),
      });

      let generation = await setClaudeSitePushed(projectId, site.id, { at: agora(), sha: commit.sha });
      // O push publica sozinho onde o workflow da área já está; onde não
      // está, o painel o instala. O envio vale mesmo se a prévia falhar.
      let aviso = null;
      const area = generation.devArea?.state === "retired" ? null : generation.devArea;
      if (area?.repoFullName) {
        if (commit.changed) {
          generation = await setGenerationDevArea(projectId, site.id, {
            state: "publishing",
            lastRun: { at: agora(), status: "pending", runUrl: null, sha: null },
            detail: null,
          });
          areaDeAprovacao.acompanhar(projectId, site.id);
        }
      } else if (!areaDeAprovacao.configurada()) {
        aviso =
          "A área de aprovação não está configurada (Configurações → Área de aprovação): o site está no GitHub, mas ainda sem link para o cliente.";
      } else {
        try {
          generation = await areaDeAprovacao.publicar(projectId, site.id, quem);
        } catch (/** @type {any} */ erro) {
          aviso = publicMessageOf(erro, statusOf(erro));
        }
      }

      await registro.patchClaudeProject(projectId, {
        push: { state: "sent", at: agora(), by: quem, automatic: automatico, repoFullName: repo.full_name, sha: commit.sha, message: aviso },
      });
      return {
        generation,
        repository: { fullName: repo.full_name, url: repo.html_url ?? `https://github.com/${repo.full_name}`, created: criado },
        commit: { sha: commit.sha, changed: commit.changed, files: commit.total, uploaded: commit.uploaded },
        outdated: plano.desatualizados,
        warning: aviso,
      };
    } catch (/** @type {any} */ erro) {
      const status = statusOf(erro);
      await registro
        .patchClaudeProject(projectId, {
          push: { state: "failed", at: agora(), by: quem, automatic: automatico, message: executor.filtrar(publicMessageOf(erro, status)) },
        })
        .catch(() => undefined);
      throw erro;
    } finally {
      enviando.delete(projectId);
    }
  }

  /** A execução como a tela a lista: sem o pid e sem o caminho do stream. */
  const execucaoParaATela = (run) => ({
    id: run.id,
    data: run.data,
    tipo: run.tipo,
    pedido: run.pedido,
    status: run.status,
    modelo: run.modelo ?? null,
    esforco: run.esforco ?? null,
    etapa: run.etapa ?? null,
    etapaAberta: run.etapa_aberta ?? null,
    duracaoMs: run.duracao_ms ?? null,
    // ESTIMATIVA DO CLAUDE CODE: a preço de API; o consumo de verdade sai da assinatura.
    custoEstimadoUsd: run.total_cost_usd ?? null,
    turnos: run.turnos ?? null,
    mensagem: run.mensagem ?? null,
    retomou: Boolean(run.retomou),
    sessaoNovaPorFalha: Boolean(run.sessao_nova_por_falha),
    por: run.por ?? null,
    slug: run.slug ?? null,
  });

  /* ---------------------------------------------------------------- *
   * Pedidos que gastam
   * ---------------------------------------------------------------- */

  /**
   * Confere o pedido de briefing e monta o plano — o que seria copiado, a
   * frase e os sites citados. Não copia nem enfileira.
   */
  async function planejarBriefing(projectId, corpo, quem) {
    const pacoteDoProjeto = await pacoteDoMaterial(projectId, { fonte: fonte?.(projectId) });
    const plano = planoDoMaterial(pacoteDoProjeto, corpo ?? {});
    const selecao = parseStockSelection(corpo?.stockImages);
    if (selecao.length && !isPixabayConfigured()) {
      throw httpError(409, "Há imagens de banco na seleção, mas a chave do Pixabay não está configurada.");
    }
    const fotos = selecao.length ? await pixabay.resolve(selecao) : [];

    const entry = await abrirProjeto(projectId, quem);
    /** @type {{ tipo: "analisar", pasta: string, observacoes?: string }} */
    const pedido = { tipo: "analisar", pasta: entry.folder, ...(plano.observacoes ? { observacoes: plano.observacoes } : {}) };
    const { frase, sites } = await motor.frase(pedido);
    if (!plano.arquivos.length && !plano.informacoes && !fotos.length && !sites.length) {
      throw httpError(
        400,
        "Não há material para analisar: marque arquivos do projeto, escreva as informações do site ou cite o site do cliente nas observações.",
      );
    }
    return { entry, pedido, frase, sites, plano, fotos, origem: pacoteDoProjeto.origem };
  }

  const planoParaATela = ({ entry, frase, sites, plano, fotos }) => ({
    folder: entry.folder,
    phrase: frase,
    sites,
    files: plano.arquivos.map((file) => ({
      id: file.id,
      name: file.uploadName,
      kind: file.kind,
      size: file.size,
      exportedToPdf: file.exportedToPdf,
    })),
    // Nativos do Google não informam tamanho antes da exportação.
    totalBytes: plano.arquivos.reduce((soma, file) => soma + (file.size ?? 0), 0),
    unknownSizes: plano.arquivos.filter((file) => file.size === null).length,
    infoChars: plano.informacoes.length,
    notes: plano.observacoes,
    stockImages: fotos.map(({ id, path: caminho, term, section, user, pageUrl }) => ({
      id,
      path: caminho,
      term,
      section,
      user,
      pageUrl,
    })),
  });

  /**
   * O comando que seria disparado, para a pessoa ver antes de autorizar — com
   * o modelo e o esforço que o projeto escolheu.
   */
  const comandoDe = async (projectId, tipo, { sites = [], pasta = null, escolhas = null } = {}) => {
    // O que veio com o ensaio vale só para ele: mostra o comando sem gravar nada.
    const doProjeto = { ...escolhasDe(await registro.getClaudeProject(projectId)), ...(escolhas ?? {}) };
    return (await executor.comandoPrevisto({ tipo, sites, pasta, doProjeto })).texto;
  };

  /**
   * O modelo e o esforço que vieram no corpo de um pedido, conferidos. Campo
   * ausente fica como está no projeto; `null` ou vazio volta ao das
   * Configurações.
   *
   * @param {any} corpo
   * @returns {{ modelo?: string | null, esforco?: string | null } | null}
   *   `null`: o corpo não trouxe nenhum dos dois
   */
  function escolhasDoCorpo(corpo) {
    /** @type {{ modelo?: string | null, esforco?: string | null }} */
    const escolhas = {};
    const texto = (valor) => (valor === null ? "" : typeof valor === "string" ? valor.trim() : null);
    if (corpo?.modelo !== undefined) {
      const modelo = texto(corpo.modelo);
      // O modelo vira um argumento do claude: a mesma regra das Configurações.
      if (modelo === null || (modelo && !MODELO_VALIDO.test(modelo))) throw httpError(400, MODELO_INVALIDO);
      escolhas.modelo = modelo || null;
    }
    if (corpo?.esforco !== undefined) {
      const esforco = texto(corpo.esforco);
      if (esforco === null || (esforco && !ESFORCOS.includes(esforco))) {
        throw httpError(400, `Esforço inválido — use ${ESFORCOS.join(", ")}.`);
      }
      escolhas.esforco = esforco || null;
    }
    return Object.keys(escolhas).length ? escolhas : null;
  }

  /** Grava no projeto o modelo e o esforço escolhidos; o que não veio fica como está. */
  async function gravarEscolhas(projectId, escolhas) {
    const entry = await registro.getClaudeProject(projectId);
    if (entry) await registro.patchClaudeProject(projectId, { options: { ...escolhasDe(entry), ...escolhas } });
  }

  /**
   * Põe o pedido na fila. A conferência do motor vem antes da trava — a pessoa
   * vê primeiro o que está errado no pedido — e a frase conferida é a que vai
   * ao claude.
   *
   * @param {string} projectId
   * @param {import("./executor.js").Pedido} pedido
   * @param {string | null} quem
   * @param {Record<string, any>} [extra]
   * @param {{ modelo?: string | null, esforco?: string | null } | null} [escolhas]
   *   o modelo e o esforço que vieram com o pedido: gravados no projeto só
   *   quando ele de fato entra na fila
   */
  async function enfileirar(projectId, pedido, quem, extra = {}, escolhas = null) {
    const { frase } = await motor.conferirPedido(pedido);
    exigirDisparo();
    if (escolhas) await gravarEscolhas(projectId, escolhas);
    const item = /** @type {Fila} */ (fila).adicionar(pedido, {
      frase,
      extra: { projectId, por: quem, ...extra },
      // O passo seguinte de um site em andamento não espera atrás de site novo.
      primeiro: extra.encadeado === true,
    });
    return itemParaATela(item);
  }

  /**
   * O que vale para quem não escolheu nada no projeto: o das Configurações e,
   * onde elas estão vazias, o que o motor espera. Vai junto a lista do que a
   * tela oferece em cada escolha.
   */
  async function padroes() {
    const cfg = lerConfig();
    const ambiente = await motor.ambiente();
    const doMotor = ambiente.padroes ?? {};
    const { modelo, esforco } = executor.resolver({ contrato: ambiente.headless, modeloEsperado: ambiente.modeloEsperado });
    return {
      modelo,
      esforco,
      rodadas: cfg.reviewRounds ?? doMotor.rodadas ?? null,
      direcao_de_arte: cfg.artDirection || doMotor.direcao_de_arte || null,
      movimento: cfg.motion || doMotor.movimento || null,
      escolher_rota: cfg.humanApproval ?? doMotor.escolher_rota ?? Boolean(ambiente.aprovacaoHumana),
      modelos: MODELOS,
      esforcos: ESFORCOS,
    };
  }

  /**
   * As opções de um projeto, para a tela: o modelo e o esforço que ele
   * escolheu, o que vale no lugar do que ele não escolheu e as opções do site,
   * que moram no briefing (`null` enquanto não há um).
   */
  async function lerOpcoes(projectId) {
    const entry = await registro.getClaudeProject(projectId);
    const [defaults, review] = await Promise.all([padroes(), entry ? motor.revisao(entry.folder) : null]);
    return { options: escolhasDe(entry), defaults, site: review?.opcoes ?? null };
  }


  /* ---------------------------------------------------------------- *
   * A edição livre: o site, a versão, o pedido e o fim
   * ---------------------------------------------------------------- */

  const SEM_TOKEN_DO_GITHUB = "Configure o token do GitHub em Configurações → GitHub e publicação: é por ele que o painel lê e envia o site.";

  /**
   * O site que a edição livre ajusta: o mais recente do projeto, quando ele
   * mora num repositório do GitHub e não é do motor (esse tem os ajustes dele).
   * @param {string} projectId
   * @returns {Promise<{ site: any, repo: string | null, motivo: string | null }>}
   */
  async function siteDeRepositorio(projectId) {
    const lista = (await listGenerations())[projectId] ?? [];
    const site = lista.at(-1) ?? null;
    if (!site) return { site: null, repo: null, motivo: "Este projeto ainda não tem site." };
    if (site.engine === "claude") {
      return { site, repo: null, motivo: "O site deste projeto foi feito pelo motor Claude: os ajustes dele ficam na aba Claude." };
    }
    const repo = site.devArea?.repoFullName ?? site.repoFullName ?? null;
    if (!repo) {
      return {
        site,
        repo: null,
        motivo:
          "O site deste projeto ainda não está num repositório do GitHub. Conecte o projeto ao GitHub no Lovable, ou informe o repositório em “Vincular site existente”.",
      };
    }
    return { site, repo, motivo: null };
  }

  /** O branch que o Lovable sincroniza: o principal do repositório. @type {Map<string, string>} */
  const ramos = new Map();
  async function ramoDe(/** @type {string} */ repo) {
    const sabido = ramos.get(repo);
    if (sabido) return sabido;
    const [owner, name] = repo.split("/");
    const dados = await github.getRepository(github.config(), { owner, repo: name });
    if (!dados) throw httpError(404, `O repositório ${repo} não foi encontrado no GitHub (ou o token do painel não o enxerga).`);
    const ramo = dados.default_branch || "main";
    ramos.set(repo, ramo);
    return ramo;
  }

  /** A última versão lida de cada repositório. @type {Map<string, { em: string, dados: any }>} */
  const versoes = new Map();
  /** A leitura em andamento de cada repositório: duas abas abertas leem uma vez. @type {Map<string, Promise<any>>} */
  const lendo = new Map();

  /** Um ajuste está rodando neste repositório agora? */
  const repoOcupado = (/** @type {string} */ repo) =>
    Boolean(fila?.estado().rodandoTodos.some((item) => item.pedido.tipo === "edicao" && /** @type {any} */ (item.pedido).repo === repo));

  /**
   * A última versão do repositório, alinhando o clone com o GitHub. Com um
   * ajuste rodando nele, o clone é do Claude: vale a última leitura.
   * @param {string} repo
   */
  async function versaoDe(repo) {
    if (repoOcupado(repo)) {
      const guardada = versoes.get(repo);
      return { ...(guardada?.dados ?? { repo, head: null, last: null, commits: [] }), busy: true, checkedAt: guardada?.em ?? null };
    }
    let leitura = lendo.get(repo);
    if (!leitura) {
      leitura = (async () => {
        try {
          const branch = await ramoDe(repo);
          const dados = await edicao.versao({ repo, branch });
          const em = new Date().toISOString();
          versoes.set(repo, { em, dados });
          return { ...dados, busy: false, checkedAt: em };
        } finally {
          lendo.delete(repo);
        }
      })();
      lendo.set(repo, leitura);
    }
    return leitura;
  }

  /**
   * A execução de um ajuste de edição livre, pela fila. Antes de mexer no
   * clone ela espera uma leitura de versão que esteja em andamento.
   * @param {any} pedido
   * @param {any} deps
   */
  function iniciarEdicao(pedido, deps) {
    return edicao.iniciar(pedido, {
      ...deps,
      esperarLeitura: () => Promise.resolve(lendo.get(pedido.repo)).catch(() => undefined),
      anteriores: async () => (await memoria.listRepoEdits(pedido.projectId)).filter((item) => item.id !== pedido.edicaoId),
      aoComecar: ({ runId, base: daBase, branch, modelo, esforco }) =>
        memoria.patchRepoEdit(pedido.projectId, pedido.edicaoId, {
          status: "running",
          startedAt: new Date().toISOString(),
          runId,
          base: daBase,
          branch,
          model: modelo,
          effort: esforco,
        }),
    });
  }

  /**
   * O fim de um ajuste de edição livre: a memória ganha o resultado e, quando
   * ele foi ao GitHub, o painel acompanha a área de aprovação — o workflow
   * dela publica sozinho a cada push.
   * @param {string} projectId
   * @param {import("./queue.js").FimDeItem} fim
   */
  async function aoTerminarEdicao(projectId, fim) {
    const pedido = /** @type {any} */ (fim.item.pedido);
    const r = /** @type {any} */ (fim.resultado);
    const agora = new Date().toISOString();
    versoes.delete(pedido.repo);
    if (!r?.edicao) {
      await memoria.patchRepoEdit(projectId, pedido.edicaoId, {
        status: "failed",
        finishedAt: agora,
        error: executor.filtrar(String(fim.erro ?? r?.mensagem ?? "O ajuste não chegou a rodar.")),
      });
      return;
    }
    const { fim: estado, base: daBase, commit, resumo } = r.edicao;
    await memoria.patchRepoEdit(projectId, pedido.edicaoId, {
      status: estado,
      finishedAt: agora,
      durationMs: r.duracaoMs ?? null,
      runId: r.id,
      ...(daBase ? { base: daBase } : {}),
      commit: commit ?? null,
      summary: resumo ?? null,
      error: estado === "pushed" || estado === "unchanged" ? null : r.mensagem,
    });
    if (estado !== "pushed") return;
    const lista = (await listGenerations())[projectId] ?? [];
    const site = [...lista].reverse().find((item) => (item.devArea?.repoFullName ?? item.repoFullName) === pedido.repo);
    const area = site?.devArea?.state === "retired" ? null : site?.devArea;
    if (site && area?.repoFullName) {
      await setGenerationDevArea(projectId, site.id, {
        state: "publishing",
        lastRun: { at: agora, status: "pending", runUrl: null, sha: null },
        detail: null,
      });
      areaDeAprovacao.acompanhar(projectId, site.id);
    }
  }

  return {
    /* ----- edição livre (sites de repositório) --------------------- */

    /**
     * A aba "Ajustes" de um projeto: se ele pode receber ajustes pelo Claude,
     * o repositório, a última versão já lida, o pedido em andamento e a
     * memória dos ajustes. Não fala com o GitHub.
     * @param {string} projectId
     */
    async edicoes(projectId) {
      const filaAtual = await pronta();
      const { repo, motivo } = await siteDeRepositorio(projectId);
      const semToken = !github.conta().githubToken;
      const pendente = pendenteDe(projectId);
      const guardada = repo ? versoes.get(repo) : null;
      const esperando = filaAtual.estado().esperando;
      return {
        available: Boolean(repo) && !semToken,
        reason: motivo ?? (semToken ? SEM_TOKEN_DO_GITHUB : null),
        repo,
        generation: liberacao(),
        queue: pendente
          ? {
              ...itemParaATela(pendente),
              posicao: pendente.estado === "esperando" ? esperando.findIndex((outro) => outro.id === pendente.id) + 1 : null,
            }
          : null,
        version: guardada ? { ...guardada.dados, busy: repoOcupado(/** @type {string} */ (repo)), checkedAt: guardada.em } : null,
        edits: await memoria.listRepoEdits(projectId),
      };
    },

    /** A última versão do repositório no GitHub, com quem fez as alterações recentes. Não usa o Claude. */
    async versaoDaEdicao(projectId) {
      await pronta();
      const { repo, motivo } = await siteDeRepositorio(projectId);
      if (!repo) throw httpError(409, /** @type {string} */ (motivo));
      if (!github.conta().githubToken) throw httpError(409, SEM_TOKEN_DO_GITHUB);
      try {
        return await versaoDe(repo);
      } catch (/** @type {any} */ erro) {
        if (erro?.expose === true || erro?.status) throw erro;
        throw httpError(
          502,
          `Não foi possível ler o repositório ${repo} no GitHub: ${executor.filtrar(gitDaEdicao.semToken(erro?.message ?? String(erro)))}`,
        );
      }
    },

    /** Pede um ajuste pelo Claude num site de repositório. CONSOME A ASSINATURA. */
    pedirEdicao: (projectId, corpo, { quem = null } = {}) =>
      comReserva(projectId, async () => {
        const texto = typeof corpo?.pedido === "string" ? corpo.pedido.trim() : "";
        if (!texto) throw httpError(400, "Escreva o que deve mudar no site.");
        if (texto.length > MAX_CARACTERES_DO_AJUSTE) {
          throw httpError(400, `O pedido de ajuste tem ${texto.length} caracteres — o limite é ${MAX_CARACTERES_DO_AJUSTE}.`);
        }
        const { repo, motivo } = await siteDeRepositorio(projectId);
        if (!repo) throw httpError(409, /** @type {string} */ (motivo));
        if (!github.conta().githubToken) throw httpError(409, SEM_TOKEN_DO_GITHUB);
        exigirDisparo();
        const branch = await ramoDe(repo);
        const anexos = await conferirAnexos({ dirDoSite: dirDosAnexosDaEdicao(repo), anexos: corpo?.anexos });
        const nova = await memoria.createRepoEdit({
          projectId,
          repo,
          request: texto,
          attachments: anexos?.itens.map((item) => item.nome) ?? [],
          by: quem,
        });
        const pedido = { tipo: "edicao", slug: `repo:${repo}`, repo, branch, pedido: texto, edicaoId: nova.id, projectId, anexos };
        try {
          const item = /** @type {Fila} */ (fila).adicionar(/** @type {any} */ (pedido), {
            frase: `ajuste em ${repo}: ${texto.replace(/\s+/g, " ").slice(0, 140)}`,
            extra: { projectId, por: quem, edicaoId: nova.id, ...(anexos ? { anexos: anexos.itens.length } : {}) },
          });
          const registrada = await memoria.patchRepoEdit(projectId, nova.id, { itemId: item.id, branch });
          return { item: itemParaATela(item), edit: registrada };
        } catch (erro) {
          await memoria.deleteRepoEdit(projectId, nova.id);
          throw erro;
        }
      }),

    /** Guarda uma imagem para o próximo pedido de ajuste do site de repositório. Não usa o Claude. */
    async anexarNaEdicao(projectId, { rascunho, nome, corpo }) {
      await pronta();
      const { repo, motivo } = await siteDeRepositorio(projectId);
      if (!repo) throw httpError(409, /** @type {string} */ (motivo));
      return guardarAnexo({ dirDoSite: dirDosAnexosDaEdicao(repo), rascunho, nome, corpo });
    },

    /** Tira do rascunho uma imagem que a pessoa desistiu de mandar. */
    async desanexarDaEdicao(projectId, { rascunho, arquivo }) {
      await pronta();
      const { repo, motivo } = await siteDeRepositorio(projectId);
      if (!repo) throw httpError(409, /** @type {string} */ (motivo));
      await removerAnexo({ dirDoSite: dirDosAnexosDaEdicao(repo), rascunho, arquivo });
    },

    /** O log legível de um ajuste de edição livre, refeito do stream guardado. */
    async logDaEdicao(projectId, editId) {
      const registroDaEdicao = await memoria.getRepoEdit(projectId, String(editId));
      if (!registroDaEdicao) throw httpError(404, "Ajuste não encontrado neste projeto.");
      if (!registroDaEdicao.runId) throw httpError(404, "Este ajuste ainda não começou: não há log.");
      return { lines: executor.lerLog(registroDaEdicao.runId, { raiz: edicao.dirDoClone(registroDaEdicao.repo) }) };
    },
    caminhos,
    /** Para os testes e para o encerramento do painel. */
    fila: pronta,
    liberacao,
    pacote,

    /** O estado do motor para as telas: instalado, liberado e a fila. */
    async estado() {
      const filaAtual = await pronta();
      const estado = filaAtual.estado();
      const ultimo = estado.ultimo;
      return {
        installed: pacote().instalado,
        reason: pacote().motivo,
        generation: liberacao(),
        queue: {
          paused: estado.pausada,
          running: estado.rodando ? itemParaATela(estado.rodando) : null,
          // Todas as execuções em andamento: a principal e os ajustes ao lado dela.
          runningAll: estado.rodandoTodos.map(itemParaATela),
          waiting: estado.esperando.map(itemParaATela),
          interrupted: estado.interrompidas.map(itemParaATela),
          last: ultimo
            ? {
                item: itemParaATela(ultimo.item),
                status: ultimo.resultado?.status ?? "falha",
                mensagem: ultimo.resultado?.mensagem ?? ultimo.erro ?? null,
              }
            : null,
        },
        task: tarefa ?? null,
      };
    },

    /**
     * O motor nesta máquina, para a tela de Configurações: o pacote, o Claude
     * Code, o navegador das capturas, o modelo, o esforço e o comando de uma
     * geração — os das Configurações, sem a escolha de nenhum projeto. Nada
     * aqui dispara o Claude Code: `claude --version` só diz a versão.
     */
    async diagnostico() {
      const instalado = pacote();
      const comum = { installed: instalado.instalado, reason: instalado.motivo, generation: liberacao() };
      const vazio = { claude: null, browser: null, model: null, effort: null, humanApproval: null, command: null };
      if (!instalado.instalado) return { ...comum, ...vazio };

      const cfg = lerConfig();
      try {
        const [versao, ambiente, previsto] = await Promise.all([
          executor.versaoClaude(),
          motor.ambiente(),
          executor.comandoPrevisto(),
        ]);
        const navegador = typeof ambiente.navegador === "string" && ambiente.navegador ? ambiente.navegador : null;
        return {
          ...comum,
          claude: {
            found: versao.encontrado,
            version: versao.versao ? executor.filtrar(versao.versao.split(/\r?\n/)[0]).slice(0, 80) : null,
            custom: Boolean(cfg.bin),
          },
          // Só o nome do programa: o caminho é desta máquina e não interessa à tela.
          browser: { found: Boolean(navegador), name: navegador ? path.basename(navegador) : null, custom: Boolean(cfg.browserPath) },
          model: { effective: previsto.modelo, expected: previsto.modeloEsperado, custom: Boolean(cfg.model) },
          // O esforço esperado é o da criação de um site, que é o comando mostrado.
          effort: { effective: previsto.esforco, expected: previsto.esforcoEsperado, custom: ESFORCOS.includes(cfg.effort) },
          humanApproval: { enabled: Boolean(ambiente.aprovacaoHumana), custom: typeof cfg.humanApproval === "boolean" },
          command: previsto.texto,
        };
      } catch (erro) {
        // O motor recusou a consulta (pacote pela metade, configuração quebrada):
        // a tela mostra o motivo no lugar do estado.
        if (/** @type {any} */ (erro)?.expose !== true) throw erro;
        return { ...comum, ...vazio, reason: executor.filtrar(/** @type {any} */ (erro).message) };
      }
    },

    /**
     * "Testar Claude": um `claude -p` mínimo, que só responde "ok", para saber
     * se o login da assinatura está funcionando. CONSOME UM POUCO DA ASSINATURA:
     * só roda a pedido, com a trava ligada e sem nada em andamento.
     */
    async testar() {
      const filaAtual = await pronta();
      if (testando) throw httpError(409, "O teste do Claude já está em andamento.");
      if (filaAtual.estado().rodando || executor.execucaoEmAndamento()) {
        throw httpError(409, "Há uma execução do Claude em andamento. Teste quando ela terminar.");
      }
      exigirLiberacao();
      testando = true;
      try {
        const teste = await executor.testarClaude();
        return {
          ok: teste.ok,
          message: executor.filtrar(teste.mensagem),
          model: teste.modelo,
          apiKeySource: teste.apiKeySource,
          // Estimativa do Claude Code: o consumo de verdade sai da assinatura.
          estimatedCostUsd: teste.custoEstimadoUsd,
        };
      } finally {
        testando = false;
      }
    },

    /** O resumo de cada projeto que já passou pelo motor, para a lista de projetos. */
    async resumos() {
      const filaAtual = await pronta();
      const projetos = await registro.listClaudeProjects();
      return Object.fromEntries(
        Object.entries(projetos).map(([projectId, entry]) => [projectId, resumoDe(projectId, entry, filaAtual)]),
      );
    },

    /** O material do projeto, classificado, para a tela de geração. Só lê. */
    async material(projectId, { refresh = false } = {}) {
      const pacoteDoProjeto = await pacoteDoMaterial(projectId, { refresh, fonte: fonte?.(projectId) });
      return {
        prompt: pacoteDoProjeto.prompt,
        files: pacoteDoProjeto.files,
        limits: pacoteDoProjeto.limits,
        engine: "claude",
        generation: liberacao(),
      };
    },

    /** Tudo o que as telas do projeto mostram: briefing, revisão, site e execuções. */
    async detalhe(projectId) {
      const filaAtual = await pronta();
      const entry = await registro.getClaudeProject(projectId);
      const basico = { installed: pacote().instalado, reason: pacote().motivo, generation: liberacao() };
      if (!entry) return { ...basico, project: null, review: null, site: null, runs: [] };

      const review = await motor.revisao(entry.folder);
      const slug = (Array.isArray(review.projetos) ? review.projetos.at(-1) : null) ?? entry.slug;
      const site = slug ? await motor.projeto(slug) : null;
      const runs = (await registro.listClaudeRuns({ projectId })).map(execucaoParaATela);
      return { ...basico, project: resumoDe(projectId, { ...entry, slug: slug ?? null }, filaAtual), review, site, runs };
    },

    /* ----- briefing ------------------------------------------------ */

    /** Ensaio: o que seria copiado e o comando que rodaria. Não gasta nem enfileira. */
    async ensaiarBriefing(projectId, corpo, quem) {
      await pronta();
      const escolhas = escolhasDoCorpo(corpo);
      const planejado = await planejarBriefing(projectId, corpo, quem);
      return {
        dryRun: true,
        plan: planoParaATela(planejado),
        command: await comandoDe(projectId, "analisar", { sites: planejado.sites, pasta: planejado.entry.folder, escolhas }),
        generation: liberacao(),
      };
    },

    /** Copia o material e põe o pedido de briefing na fila. CONSOME A ASSINATURA. */
    pedirBriefing: (projectId, corpo, { quem = null, publicar = false } = {}) =>
      comReserva(projectId, async () => {
        const escolhas = escolhasDoCorpo(corpo);
        const planejado = await planejarBriefing(projectId, corpo, quem);
        exigirDisparo();

        const fotos = planejado.fotos.length ? await pixabay.download(planejado.fotos) : [];
        const copia = await copiarMaterial({
          pastaDoCliente: pastaDoCliente(planejado.entry.folder),
          entrada,
          arquivos: planejado.plano.arquivos,
          origem: planejado.origem,
          informacoes: planejado.plano.informacoes,
          fotosDeBanco: fotos,
        });
        await registro.patchClaudeProject(projectId, {
          material: {
            copiedAt: new Date().toISOString(),
            by: quem,
            files: copia.arquivos,
            bytes: copia.bytes,
            skipped: copia.pulados.slice(0, 30),
          },
        });
        const item = await enfileirar(projectId, planejado.pedido, quem, { publicar }, escolhas);
        return { item, plan: planoParaATela(planejado), material: copia };
      }),

    /** Grava o briefing corrigido na tela; a conferência volta junto. Não gasta. */
    async gravarBriefing(projectId, briefing, quem) {
      await pronta();
      if (!briefing || typeof briefing !== "object" || Array.isArray(briefing)) {
        throw httpError(400, "O briefing precisa ser um objeto JSON.");
      }
      exigirSemPendencia(projectId);
      const entry = await abrirProjeto(projectId, quem);
      const review = await motor.gravarBriefing(entry.folder, briefing);
      await atualizarResumo(projectId);
      return { review };
    },

    /** As opções do projeto: o modelo e o esforço das execuções, os padrões e as opções do site. Só lê. */
    async opcoes(projectId) {
      await pronta();
      return lerOpcoes(projectId);
    },

    /**
     * Grava as opções do projeto. O modelo e o esforço das execuções ficam no
     * banco do painel e valem da próxima execução em diante; as opções do site
     * (`site`: páginas, banco de imagens, skills, observações, rodadas, direção
     * de arte, movimento, escolha de rota, referências) vão para o briefing,
     * pelo motor, que é quem as confere. Não gasta.
     *
     * @param {string} projectId
     * @param {any} corpo `{ modelo?, esforco?, site? }` — o que não vier fica como está
     * @param {string | null} [quem]
     */
    async gravarOpcoes(projectId, corpo, quem = null) {
      await pronta();
      if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) throw httpError(400, "Opções inválidas.");
      const escolhas = escolhasDoCorpo(corpo);
      const doSite = corpo.site;
      if (doSite !== undefined && (!doSite || typeof doSite !== "object" || Array.isArray(doSite))) {
        throw httpError(400, "Opções inválidas.");
      }
      if (!escolhas && doSite === undefined) throw httpError(400, "Opções inválidas.");

      // Primeiro o que o motor pode recusar: se ele recusa, nada muda.
      if (doSite !== undefined) {
        // O briefing é o arquivo que o agente lê: não muda com um pedido em andamento.
        exigirSemPendencia(projectId);
        const entry = await exigirProjeto(projectId);
        await motor.gravarOpcoes(entry.folder, doSite);
      }
      if (escolhas) {
        await abrirProjeto(projectId, quem);
        await gravarEscolhas(projectId, escolhas);
      }
      if (doSite !== undefined) await atualizarResumo(projectId);
      return lerOpcoes(projectId);
    },

    /* ----- site ---------------------------------------------------- */

    /** Ensaio da geração: a conferência do briefing e o comando que rodaria. */
    async ensaiarSite(projectId, corpo = {}) {
      await pronta();
      const refazer = corpo?.refazer === true;
      const escolhas = escolhasDoCorpo(corpo);
      const entry = await exigirProjeto(projectId);
      const review = await motor.revisao(entry.folder);
      /** @type {{ tipo: "cliente", pasta: string, refazer?: boolean }} */
      const pedido = { tipo: "cliente", pasta: entry.folder, ...(refazer ? { refazer: true } : {}) };
      const { frase } = await motor.frase(pedido);
      return {
        dryRun: true,
        plan: {
          folder: entry.folder,
          phrase: frase,
          exists: Boolean(review.existe),
          errors: review.erros ?? [],
          warnings: review.avisos ?? [],
          summary: review.resumo ?? [],
          previousSites: review.projetos ?? [],
          humanApproval: Boolean(review.aprovacaoHumana),
        },
        command: await comandoDe(projectId, "cliente", { escolhas }),
        generation: liberacao(),
      };
    },

    /** Põe a geração do site na fila. CONSOME A ASSINATURA. */
    pedirSite: (projectId, corpo, { quem = null, publicar = false } = {}) =>
      comReserva(projectId, async () => {
        const refazer = corpo?.refazer === true;
        const escolhas = escolhasDoCorpo(corpo);
        const opcoes = corpo?.opcoes;
        if (opcoes !== undefined && (!opcoes || typeof opcoes !== "object" || Array.isArray(opcoes))) {
          throw httpError(400, "Opções inválidas.");
        }
        const entry = await exigirProjeto(projectId);
        const review = await motor.revisao(entry.folder);
        if (!review.existe) throw httpError(409, "Este projeto ainda não tem briefing. Gere o briefing primeiro.");
        if (review.erros?.length) {
          throw httpError(
            409,
            `O briefing tem ${review.erros.length} pendência(s). Corrija-as antes de gerar o site:\n${review.erros
              .map((erro, indice) => `${indice + 1}. ${erro}`)
              .join("\n")}`,
          );
        }
        if (review.projetos?.length && !refazer) {
          throw httpError(
            409,
            "Este projeto já tem um site gerado pelo Claude. Peça um ajuste nele, ou confirme que quer gerar outro do zero.",
          );
        }
        exigirDisparo();

        // As opções da tela de revisão vão para o briefing antes de o pedido
        // entrar na fila: é o briefing que o modelo recebe.
        if (opcoes) await motor.gravarOpcoes(entry.folder, opcoes);
        /** @type {{ tipo: "cliente", pasta: string, refazer?: boolean }} */
        const pedido = { tipo: "cliente", pasta: entry.folder, ...(refazer ? { refazer: true } : {}) };
        return { item: await enfileirar(projectId, pedido, quem, { publicar }, escolhas) };
      }),

    /** Pede um ajuste no site já gerado. CONSOME A ASSINATURA. */
    pedirAjuste: (projectId, corpo, { quem = null, publicar = false } = {}) =>
      comReserva(projectId, async () => {
        const texto = typeof corpo?.pedido === "string" ? corpo.pedido.trim() : "";
        if (!texto) throw httpError(400, "Escreva o que deve mudar no site.");
        if (texto.length > MAX_CARACTERES_DO_AJUSTE) {
          throw httpError(400, `O pedido de ajuste tem ${texto.length} caracteres — o limite é ${MAX_CARACTERES_DO_AJUSTE}.`);
        }
        const escolhas = escolhasDoCorpo(corpo);
        const entry = await exigirSite(projectId);
        const anexos = await conferirAnexos({ dirDoSite: dirDoSite(entry.slug), anexos: corpo?.anexos });
        /** @type {{ tipo: "ajuste", slug: string, pedido: string }} */
        const pedido = { tipo: "ajuste", slug: entry.slug, pedido: texto };
        // A lista de imagens fica pronta antes de o pedido entrar na fila: o
        // motor a lê quando o agente abre a etapa. Sem imagem, some a de um
        // pedido anterior que não chegou a rodar.
        await gravarPendente(dirDoSite(entry.slug), anexos);
        try {
          const extra = { publicar, ...(anexos ? { anexos: anexos.itens.length } : {}) };
          return { item: await enfileirar(projectId, pedido, quem, extra, escolhas) };
        } catch (error) {
          await gravarPendente(dirDoSite(entry.slug), null);
          throw error;
        }
      }),

    /** Guarda uma imagem para acompanhar o próximo pedido de ajuste. Não usa o Claude. */
    async anexar(projectId, { rascunho, nome, corpo }) {
      await pronta();
      const entry = await exigirSite(projectId);
      return guardarAnexo({ dirDoSite: dirDoSite(entry.slug), rascunho, nome, corpo });
    },

    /** Tira do rascunho uma imagem que a pessoa desistiu de mandar. */
    async desanexar(projectId, { rascunho, arquivo }) {
      await pronta();
      const entry = await exigirSite(projectId);
      await removerAnexo({ dirDoSite: dirDoSite(entry.slug), rascunho, arquivo });
    },

    /**
     * "Continuar": põe na fila o passo que o motor indica para o site — a
     * continuação de uma etapa que ficou aberta, a crítica ou o refino de uma
     * sequência que parou. CONSOME A ASSINATURA.
     */
    pedirContinuacao: (projectId, corpo, { quem = null, publicar = false } = {}) =>
      comReserva(projectId, async () => {
        const escolhas = escolhasDoCorpo(corpo);
        const entry = await exigirSite(projectId);
        const estado = await motor.estadoDoProjeto(entry.slug);
        const tipo = proximoDe(estado);
        if (!tipo) {
          // Nada pela frente: é o motor quem diz por quê (site já entregue, direção esperando aprovação).
          await motor.conferirPedido({ tipo: "continuar", slug: entry.slug });
          throw httpError(409, "Não há o que continuar neste site.");
        }
        const extra = { publicar, trilha: [passoDe(tipo, estado)] };
        return { item: await enfileirar(projectId, { tipo, slug: entry.slug }, quem, extra, escolhas) };
      }),

    /**
     * Aprova a direção criativa e põe a geração do site na fila. CONSOME A
     * ASSINATURA: a aprovação só serve para o site ser gerado em seguida.
     */
    aprovar: (projectId, { quem = null, publicar = false } = {}) =>
      comReserva(projectId, async () => {
        const entry = await exigirSite(projectId);
        const estado = await motor.estadoDoProjeto(entry.slug);
        if (!estado.aguardandoAprovacao) {
          throw httpError(409, "Não há direção criativa esperando aprovação neste projeto.");
        }
        exigirDisparo();
        const resposta = await motor.aprovar(entry.slug);
        if (!resposta.aprovado) {
          await atualizarResumo(projectId);
          throw httpError(409, (resposta.mensagens ?? ["A direção criativa não pôde ser aprovada."]).join("\n"));
        }
        const item = await enfileirar(projectId, { tipo: "continuar", slug: entry.slug }, quem, { publicar });
        await atualizarResumo(projectId);
        return { aprovado: true, mensagens: resposta.mensagens ?? [], item };
      }),

    /**
     * Escolhe outra rota criativa entre as propostas e põe na fila a execução
     * que refaz a direção com ela. CONSOME A ASSINATURA: a escolha só serve
     * para o site seguir por essa rota.
     *
     * @param {string} projectId
     * @param {unknown} rota o número da rota, como o motor a lista
     */
    escolherRota: (projectId, rota, { quem = null, publicar = false } = {}) =>
      comReserva(projectId, async () => {
        const entry = await exigirSite(projectId);
        const estado = await motor.estadoDoProjeto(entry.slug);
        if (!estado.aguardandoAprovacao) {
          throw httpError(409, "Não há direção criativa esperando a escolha de uma rota neste projeto.");
        }
        const site = await motor.projeto(entry.slug);
        const propostas = Array.isArray(site.rotas) ? site.rotas : [];
        if (!Number.isInteger(rota) || !propostas.some((proposta) => proposta?.n === rota)) {
          throw httpError(400, "Escolha uma das rotas propostas para este site.");
        }
        exigirDisparo();
        const escolhido = await motor.rota(entry.slug, /** @type {number} */ (rota));
        try {
          const extra = { publicar, trilha: [passoDe("continuar", escolhido)] };
          const item = await enfileirar(projectId, { tipo: "continuar", slug: entry.slug }, quem, extra);
          return { site: escolhido, item };
        } finally {
          // A rota já mudou no motor, entre ou não o pedido na fila.
          await atualizarResumo(projectId);
        }
      }),

    /* ----- site feito na ferramenta antiga --------------------------- */

    /**
     * O que há para trazer: as pastas do projeto do painel em que há um site
     * do motor (com a sessão dele). Só lê.
     */
    async planoDaAdocao(projectId) {
      await pronta();
      const entry = await registro.getClaudeProject(projectId);
      if (entry?.slug) return { possible: false, reason: "Este projeto já tem um site no motor Claude.", sources: [] };
      if (!isLocalProjectId(projectId)) {
        return {
          possible: false,
          reason: "O painel traz um site para o motor a partir da pasta dele, enviada a um projeto criado no painel (Novo projeto → Site para publicar).",
          sources: [],
        };
      }
      const sources = await sitesDoMotorNoProjeto(projectId);
      return {
        possible: sources.length > 0,
        reason: sources.length
          ? null
          : "Não há, nos arquivos deste projeto, a pasta de um site feito com o Joinvixable (com .session/session.json e content.json). Envie a pasta inteira do site, não só o build.",
        sources,
      };
    },

    /**
     * Traz o site para a pasta de trabalho do motor e o registra como site do
     * Claude. Não dispara o Claude nem gasta nada: daí em diante valem o
     * envio ao GitHub e o pedido de ajuste de qualquer site do motor.
     *
     * @param {string} projectId
     * @param {{ origem?: unknown, quem?: string | null }} [opcoes]
     */
    adotar: (projectId, { origem, quem = null } = {}) =>
      comReserva(projectId, async () => {
        if (!isLocalProjectId(projectId)) {
          throw httpError(409, "Só um projeto criado no painel, com a pasta do site enviada, pode ser trazido para o motor.");
        }
        const existente = await registro.getClaudeProject(projectId);
        if (existente?.slug) throw httpError(409, "Este projeto já tem um site no motor Claude.");

        const sources = await sitesDoMotorNoProjeto(projectId);
        if (!sources.length) {
          throw httpError(422, "Não há, nos arquivos deste projeto, a pasta de um site feito com o Joinvixable (com .session/session.json e content.json).");
        }
        const pedida = typeof origem === "string" ? origem.replace(/^\/+|\/+$/g, "") : null;
        const escolhida = pedida === null ? (sources.length === 1 ? sources[0] : null) : sources.find((source) => source.path === pedida);
        if (!escolhida) {
          throw httpError(400, pedida === null ? "Há mais de um site nos arquivos do projeto: escolha qual trazer." : "Essa pasta não é um site do motor neste projeto.");
        }

        const entry = await abrirProjeto(projectId, quem);
        // A pasta de trabalho leva o nome que o painel escolheu para o projeto,
        // nunca o que veio escrito na sessão do site.
        const slug = entry.folder;
        if (existsSync(dirDoSite(slug))) throw httpError(409, "Já existe um site com este nome na pasta de trabalho do motor.");
        const copia = await copiarSiteAdotado({ projectId, origem: escolhida.path, destino: dirDoSite(slug), slug, entrada });

        // O motor é quem diz se entende o que chegou: sem isso, nada é registrado.
        try {
          await motor.estadoDoProjeto(slug);
        } catch (erro) {
          await fs.rm(dirDoSite(slug), { recursive: true, force: true });
          throw erro;
        }
        await registro.patchClaudeProject(projectId, { slug, adopted: { at: new Date().toISOString(), by: quem, from: escolhida.path, files: copia.files } });
        const generation = await adoptClaudeSite(projectId, { slug, displayName: await nomeDoProjeto(projectId), by: quem });
        await atualizarResumo(projectId);
        return { slug, files: copia.files, bytes: copia.bytes, stages: copia.etapas, generation };
      }),

    /* ----- GitHub --------------------------------------------------- */

    /** O que a tela mostra antes do envio: para onde vai, quantos arquivos e o que impede. */
    async planoDoEnvio(projectId) {
      await pronta();
      const { githubToken, organization } = github.conta();
      const site = await siteDoClaude(projectId);
      if (!site) throw httpError(409, "Este projeto ainda não tem site gerado e validado pelo Claude.");
      const { plano, motivos } = await conferirEnvio(site.claudeSlug);
      const conhecido = (site.devArea?.state === "retired" ? null : site.devArea?.repoFullName) ?? site.repoFullName ?? null;
      return {
        configured: Boolean(githubToken && organization),
        organization: organization || null,
        repoFullName: conhecido,
        suggestedRepoName: repoNameOf(await nomeDoProjeto(projectId)).slice(0, 80) || site.claudeSlug,
        approvalArea: areaDeAprovacao.configurada(),
        files: plano.files.length,
        totalBytes: plano.totalBytes,
        outdated: plano.desatualizados,
        problems: motivos,
        validatedAt: site.claudeValidatedAt ?? null,
        pushedAt: site.claudePushedAt ?? null,
      };
    },

    /**
     * Manda o site ao GitHub, depois de validá-lo de novo. Não usa o Claude.
     *
     * @param {string} projectId
     * @param {{ quem?: string | null, repoName?: unknown, privado?: boolean }} [opcoes]
     */
    async enviarAoGitHub(projectId, { quem = null, repoName, privado = true } = {}) {
      await pronta();
      exigirSemPendencia(projectId);
      return enviar(projectId, { quem, repoName, privado, automatico: false });
    },

    /* ----- o que não gasta ------------------------------------------ */

    /** Fecha como falha a etapa que ficou aberta. */
    async abortar(projectId, motivo = "") {
      await pronta();
      exigirSemPendencia(projectId);
      const entry = await exigirSite(projectId);
      const site = await motor.abortar(entry.slug, String(motivo ?? "").replace(/\s+/g, " ").trim().slice(0, 300));
      await atualizarResumo(projectId);
      return { site };
    },

    /** Tira uma foto de banco proposta, antes de aprovar a direção. */
    async recusarFoto(projectId, ref) {
      await pronta();
      exigirSemPendencia(projectId);
      const entry = await exigirSite(projectId);
      if (typeof ref !== "string" || !/^[a-z]+:[\w-]+$/i.test(ref)) throw httpError(400, "Foto inválida.");
      return { site: await motor.recusarFoto(entry.slug, ref) };
    },

    /**
     * O site já gerado passa a aceitar várias páginas, ou volta a ser de página
     * única. Não usa o Claude: é o que deixa o ajuste seguinte criar páginas.
     */
    mudarTipoDoSite: (projectId, corpo) =>
      comReserva(projectId, async () => {
        if (typeof corpo?.multiplas_paginas !== "boolean") {
          throw httpError(400, "Informe se o site tem várias páginas (multiplas_paginas: true ou false).");
        }
        const entry = await exigirSite(projectId);
        const tipo = await motor.tipoDoSite(entry.slug, corpo.multiplas_paginas, entry.folder);
        return { multiplasPaginas: tipo.multiplasPaginas === true, paginas: Array.isArray(tipo.paginas) ? tipo.paginas : [] };
      }),

    /** O mesmo build e a mesma validação que fecham uma etapa. */
    async validar(projectId) {
      await pronta();
      exigirSemPendencia(projectId);
      const entry = await exigirSite(projectId);
      return comTarefa(`validação de ${entry.slug}`, async () => {
        const r = await (validar ? validar(entry.slug) : motor.validar(entry.slug));
        return { ok: r.ok, texto: executor.filtrar(r.texto) };
      });
    },

    /** Fotografa o site, em desktop e em celular. */
    async capturar(projectId, tipo) {
      await pronta();
      if (tipo !== "telas") throw httpError(404, "Rota não encontrada");
      exigirSemPendencia(projectId);
      const entry = await exigirSite(projectId);
      return comTarefa(`capturas de ${entry.slug}`, async () => {
        await motor.telas(entry.slug);
        const site = await motor.projeto(entry.slug);
        return { telas: site.telas ?? [] };
      });
    },

    /**
     * O arquivo de uma imagem da pasta de trabalho, conferido: as telas do
     * site, uma foto do material do cliente ou a miniatura de uma foto de
     * banco proposta.
     *
     * @param {string} projectId
     * @param {"telas" | "material" | "miniatura"} tipo
     * @param {string} nome
     */
    async imagem(projectId, tipo, nome) {
      const entry = await exigirProjeto(projectId);
      const relativo = String(nome ?? "");
      const tipoDoArquivo = IMAGENS[path.extname(relativo).toLowerCase()];
      /** @type {string | null} */
      let raiz = null;
      if (tipo === "telas") {
        if (entry.slug && /^[\w.-]+\.png$/i.test(relativo)) {
          raiz = path.join(caminhos.trabalho, "projects", entry.slug, ".session", "telas");
        }
      } else if (tipo === "material") {
        raiz = pastaDoCliente(entry.folder);
      } else if (tipo === "miniatura") {
        if (/^[\w-]+\.jpg$/i.test(relativo)) raiz = path.join(caminhos.trabalho, ".cache", "imagens", "miniaturas");
      }
      const naoAchada = () => httpError(404, "Imagem não encontrada.");
      const absoluto = raiz ? path.resolve(raiz, relativo) : null;
      if (!raiz || !absoluto || !tipoDoArquivo || !dentroDe(raiz, absoluto) || absoluto === path.resolve(raiz) || !existsSync(absoluto)) {
        throw naoAchada();
      }
      // O nome vem do briefing, que o modelo escreve. Um atalho ou uma junção
      // com cara de foto não pode levar o painel a servir um arquivo de fora.
      const [raizReal, real] = await Promise.all([fs.realpath(raiz), fs.realpath(absoluto)]).catch(() => [null, null]);
      if (!raizReal || !real || !dentroDe(raizReal, real) || !(await fs.stat(real)).isFile()) throw naoAchada();
      return { arquivo: real, contentType: tipoDoArquivo };
    },

    /** O log legível de uma execução do projeto, refeito do stream guardado. */
    async log(projectId, execucaoId) {
      const run = await registro.getClaudeRun(String(execucaoId));
      if (!run || run.projectId !== projectId) throw httpError(404, "Execução não encontrada neste projeto.");
      return { run: execucaoParaATela(run), lines: executor.lerLog(run.id) };
    },

    /**
     * O que aconteceu em uma execução depois do cursor que a tela guarda.
     * Consulta simples, repetida pela tela: não há conexão aberta.
     *
     * @param {unknown} cursor como veio da resposta anterior; vazio na primeira consulta
     * @param {unknown} [item] o pedido da fila que a tela quer ver; sem ele (ou
     *   sem log dele), vale a execução principal, ou a última que escreveu
     */
    async eventos(cursor, item) {
      const filaAtual = await pronta();
      const [epocaDaTela, itemDaTela, numero] = String(cursor ?? "").split(":");
      const pedido = typeof item === "string" ? item : "";
      const principal = filaAtual.estado().rodando?.id ?? "";
      const itemAtual = recentes.has(pedido) ? pedido : recentes.has(principal) ? principal : ultimoItem;
      const doItem = recentes.get(itemAtual) ?? [];
      // O cursor só vale para a mesma subida do painel e a mesma execução.
      const mesma = epocaDaTela === epoca && itemDaTela === itemAtual;
      const desde = mesma ? Number(numero) || 0 : 0;
      // A tela ficou para trás do que ainda está guardado: recomeça do que há.
      const perdeu = mesma && desde > 0 && doItem.length > 0 && doItem[0].n > desde;
      const novos = perdeu ? doItem : doItem.filter((evento) => evento.n > desde);
      return {
        cursor: `${epoca}:${itemAtual}:${doItem.at(-1)?.n ?? 0}`,
        /** A tela deve trocar o que tinha pelo que veio, em vez de acrescentar. */
        reset: !mesma || perdeu,
        item: itemAtual || null,
        events: novos.map((evento) => ({ ts: evento.ts, legiveis: evento.legiveis })),
      };
    },

    /* ----- fila ---------------------------------------------------- */

    /**
     * Cancela uma execução em andamento (dois tempos, árvore de processos
     * inteira). Sem o item, cancela a principal.
     *
     * @param {unknown} [itemId]
     */
    async cancelar(itemId) {
      return { cancelled: (await pronta()).cancelar(typeof itemId === "string" && itemId ? itemId : undefined) };
    },

    /** Tira da fila um pedido que ainda não começou. */
    async remover(itemId) {
      const item = (await pronta()).remover(String(itemId));
      if (!item) throw httpError(404, "Esse pedido não está mais esperando na fila.");
      if (item.pedido.tipo === "edicao") {
        const pedido = /** @type {any} */ (item.pedido);
        await memoria.patchRepoEdit(pedido.projectId, pedido.edicaoId, {
          status: "cancelled",
          finishedAt: new Date().toISOString(),
          error: "Tirado da fila antes de começar. Nada foi enviado ao GitHub.",
        });
      }
      return { removed: itemParaATela(item) };
    },

    /** Libera a fila que voltou pausada de um reinício. CONSOME A ASSINATURA. */
    async retomarFila() {
      const filaAtual = await pronta();
      exigirDisparo();
      filaAtual.retomar();
      return { paused: false };
    },

    /** Retoma uma execução interrompida. CONSOME A ASSINATURA. */
    async retomarInterrompida(itemId, { quem = null } = {}) {
      const filaAtual = await pronta();
      const item = filaAtual.estado().interrompidas.find((candidato) => candidato.id === String(itemId));
      if (!item) throw httpError(404, "Essa execução interrompida não está mais na lista.");

      // Com o site já criado, vale o passo que o motor indica para ele —
      // continuar, criticar ou refinar. Sem nada pela frente, o "continue o
      // site" traz a recusa do motor, com o motivo. Sem site, vale o pedido de antes.
      if (item.pedido.tipo === "edicao") {
        const pedidoDaEdicao = /** @type {any} */ (item.pedido);
        exigirDisparo();
        filaAtual.retirarInterrompida(item.id);
        const novo = filaAtual.adicionar(pedidoDaEdicao, {
          frase: item.frase,
          extra: { ...(item.extra ?? {}), por: quem ?? item.extra?.por ?? null },
        });
        await memoria.patchRepoEdit(pedidoDaEdicao.projectId, pedidoDaEdicao.edicaoId, {
          status: "queued",
          itemId: novo.id,
          finishedAt: null,
          error: null,
        });
        return { item: itemParaATela(novo) };
      }

      /** @type {any} */
      let pedido = item.pedido;
      /** @type {Record<string, any>} */
      const extra = { ...(item.extra ?? {}), por: quem ?? item.extra?.por ?? null, encadeado: false };
      if (item.slug) {
        const estado = await motor.estadoDoProjeto(item.slug);
        pedido = { tipo: proximoDe(estado) ?? "continuar", slug: item.slug };
        // Quem retoma abre uma sequência nova, a partir deste passo.
        extra.trilha = [passoDe(pedido.tipo, estado)];
      }
      const { frase } = await motor.conferirPedido(pedido);
      exigirDisparo();
      filaAtual.retirarInterrompida(item.id);
      const novo = filaAtual.adicionar(pedido, { frase, extra });
      return { item: itemParaATela(novo) };
    },

    /** Tira uma execução interrompida da lista, sem rodar nada. */
    async descartarInterrompida(itemId) {
      const item = (await pronta()).descartarInterrompida(String(itemId));
      if (!item) throw httpError(404, "Essa execução interrompida não está mais na lista.");
      const projectId = item.extra?.projectId;
      if (projectId) await atualizarResumo(projectId);
      return { discarded: itemParaATela(item) };
    },

    /** Encerramento do painel: cancela e espera a execução em andamento. */
    async parar() {
      if (fila) await fila.parar();
    },
  };
}

/** @typedef {ReturnType<typeof criarServicoClaude>} ServicoClaude */

/** @type {ServicoClaude | undefined} */
let emUso;

/** O serviço do painel: um por processo, criado no primeiro uso. */
export const servicoClaude = () => (emUso ??= criarServicoClaude());

/**
 * Troca o serviço que as rotas usam. Só os testes precisam disto: montam um
 * com pasta de dados temporária, o claude falso e, onde o pacote do motor não
 * está, um motor de mentira.
 *
 * @param {ServicoClaude | undefined} servico
 */
export function usarServicoClaude(servico) {
  emUso = servico;
}
