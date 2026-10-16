import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { HttpError } from "../../http.js";

/**
 * A conversa do painel com o pacote do motor (`joinvixable/`).
 *
 * O motor é TypeScript rodado por `tsx`; o servidor do painel é JavaScript e
 * sobe sem transpilador. Então nada do motor é importado aqui: cada pergunta
 * é um processo filho. As consultas respondem em JSON (`scripts/consulta.ts`),
 * e os comandos de sempre — validar, telas — respondem pelo código de saída e
 * pelo texto.
 *
 * Nada neste arquivo dispara o Claude. Quem dispara o `claude -p` é o
 * executor (`executor.js`).
 */

/** Recusa vinda do motor, escrita para a pessoa: briefing recusado, etapa aberta, cliente que já tem projeto. */
class RecusaDoMotor extends HttpError {
  /** @param {string} mensagem */
  constructor(mensagem) {
    super(409, mensagem);
  }
}

/** O motor não está nesta cópia do painel, ou está sem as dependências instaladas. */
class MotorIndisponivel extends HttpError {
  /** @param {string} mensagem */
  constructor(mensagem) {
    super(503, mensagem);
  }
}

const TEMPO_DA_CONSULTA_MS = 60_000;
const TEMPO_DO_SCRIPT_MS = 10 * 60_000;

/**
 * @param {string} dirMotor
 * @returns {{ instalado: boolean, motivo: string | null }}
 */
export function estadoDoPacote(dirMotor) {
  if (!existsSync(path.join(dirMotor, "package.json"))) {
    return {
      instalado: false,
      motivo:
        "O pacote do motor (joinvixable/) não está nesta cópia do painel. Ele vive num repositório privado, clonado nessa pasta.",
    };
  }
  if (!existsSync(path.join(dirMotor, "node_modules", "tsx", "dist", "cli.mjs"))) {
    return {
      instalado: false,
      motivo: "As dependências do motor não estão instaladas. Rode npm run setup na pasta do painel.",
    };
  }
  return { instalado: true, motivo: null };
}

/**
 * @param {{
 *   dirMotor: string,
 *   ambiente: () => Record<string, string>,
 *   log?: (linha: string) => void,
 * }} opcoes
 *   `ambiente`: o ambiente dos processos do motor, já pela lista de permissão.
 */
export function criarMotor({ dirMotor, ambiente, log = (linha) => console.error(linha) }) {
  const tsx = path.join(dirMotor, "node_modules", "tsx", "dist", "cli.mjs");
  const script = (nome) => path.join(dirMotor, "scripts", `${nome}.ts`);

  const exigirPacote = () => {
    const estado = estadoDoPacote(dirMotor);
    if (!estado.instalado) throw new MotorIndisponivel(/** @type {string} */ (estado.motivo));
  };

  /**
   * Roda um script do motor em outro processo, sem travar quem chama.
   *
   * @param {string} nome
   * @param {string[]} args
   * @param {{ entrada?: string, timeoutMs?: number }} [opcoes]
   * @returns {Promise<{ codigo: number | null, saida: string, erro: string }>}
   */
  function rodar(nome, args, { entrada, timeoutMs = TEMPO_DO_SCRIPT_MS } = {}) {
    exigirPacote();
    return new Promise((resolve) => {
      let saida = "";
      let erro = "";
      const filho = spawn(process.execPath, [tsx, script(nome), ...args], {
        cwd: dirMotor,
        env: ambiente(),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const relogio = setTimeout(() => encerrarArvore(filho.pid), timeoutMs);
      filho.stdout.on("data", (pedaco) => (saida += pedaco));
      filho.stderr.on("data", (pedaco) => (erro = (erro + pedaco).slice(-20_000)));
      filho.on("error", (falha) => {
        clearTimeout(relogio);
        resolve({ codigo: null, saida, erro: falha.message });
      });
      filho.on("close", (codigo) => {
        clearTimeout(relogio);
        resolve({ codigo, saida, erro });
      });
      filho.stdin.on("error", () => undefined);
      filho.stdin.end(entrada ?? "", "utf8");
    });
  }

  /**
   * Uma pergunta ao motor. A resposta é a última linha da saída, em JSON;
   * `ok: false` vira uma recusa com a mensagem que o motor escreveu.
   *
   * @param {string[]} args
   * @param {unknown} [entrada] vai em JSON pelo stdin
   * @returns {Promise<Record<string, any>>}
   */
  async function consulta(args, entrada) {
    const { codigo, saida, erro } = await rodar("consulta", args, {
      entrada: entrada === undefined ? undefined : JSON.stringify(entrada),
      timeoutMs: TEMPO_DA_CONSULTA_MS,
    });
    const ultima = saida.trim().split("\n").pop() ?? "";
    let resposta;
    try {
      resposta = JSON.parse(ultima);
    } catch {
      log(`[claude] consulta ${args[0]} sem resposta (código ${codigo}): ${erro.trim().slice(-500) || saida.slice(-500)}`);
      throw new HttpError(500, "O motor de geração não respondeu a uma consulta. O detalhe ficou no log do servidor.");
    }
    if (resposta?.ok !== true) {
      throw new RecusaDoMotor(String(resposta?.erro ?? "O motor recusou o pedido."));
    }
    return resposta;
  }

  return {
    dir: dirMotor,
    estado: () => estadoDoPacote(dirMotor),
    consulta,

    /**
     * O contrato de permissões do `claude -p`, o modelo esperado, os padrões do
     * pipeline (`padroes`: rodadas, direção de arte, movimento e escolha de
     * rota, já com o que o painel passou pelo ambiente) e os fatos do ambiente
     * do motor.
     */
    ambiente: () => consulta(["ambiente"]),

    /**
     * Confere o pedido antes de gastar e devolve a frase do runbook que vai
     * pelo stdin. Recusa com o motivo, escrito para a pessoa.
     * @param {object} pedido
     * @returns {Promise<{ frase: string, sites: string[] }>}
     */
    conferirPedido: async (pedido) => {
      const { frase, sites } = await consulta(["pedido"], pedido);
      return { frase, sites: Array.isArray(sites) ? sites : [] };
    },

    /**
     * Só a frase e os sites citados, sem conferir nada: é o que o ensaio
     * mostra antes de o material do cliente ter sido copiado.
     * @param {object} pedido
     * @returns {Promise<{ frase: string, sites: string[] }>}
     */
    frase: async (pedido) => {
      const { frase, sites } = await consulta(["frase"], pedido);
      return { frase, sites: Array.isArray(sites) ? sites : [] };
    },

    /**
     * Onde o site parou e o que vem depois: `proximo` é o pedido que faz o
     * pipeline andar (continuar, criticar ou refinar), ou `null`.
     * @param {string} slug
     */
    estadoDoProjeto: (slug) => consulta(["estado", slug]),
    /** @param {string} pasta */
    conferirBriefing: (pasta) => consulta(["conferir", pasta]),
    /** @param {string} pasta */
    revisao: (pasta) => consulta(["revisao", pasta]),
    /** @param {string} pasta @param {object} opcoes */
    gravarOpcoes: (pasta, opcoes) => consulta(["opcoes", pasta], opcoes),
    /**
     * Grava o briefing corrigido na tela e devolve a revisão, com a conferência.
     * @param {string} pasta @param {object} briefing
     */
    gravarBriefing: (pasta, briefing) => consulta(["briefing", pasta], briefing),
    /** @param {string} slug */
    projeto: (slug) => consulta(["projeto", slug]),
    /** @param {string} slug */
    aprovar: (slug) => consulta(["aprovar", slug]),
    /**
     * Troca a rota criativa enquanto a direção espera aprovação: a escolhida
     * fica registrada, e a direção é refeita com ela na execução seguinte.
     * @param {string} slug @param {number} n
     */
    rota: (slug, n) => consulta(["rota", slug, String(n)]),
    /** @param {string} slug @param {string} [motivo] */
    abortar: (slug, motivo = "") => consulta(["abortar", slug, ...(motivo.trim() ? [motivo.trim()] : [])]),
    /** @param {string} slug @param {string} ref */
    recusarFoto: (slug, ref) => consulta(["recusar-foto", slug, ref]),
    /**
     * O site já gerado passa a aceitar várias páginas, ou volta a ser de página
     * única. O briefing do cliente acompanha o do projeto.
     * @param {string} slug @param {boolean} variasPaginas @param {string} pasta
     */
    tipoDoSite: (slug, variasPaginas, pasta) =>
      consulta(["tipo-de-site", slug, variasPaginas ? "paginas" : "unica", pasta]),

    /**
     * Grava o runbook — o mesmo texto do AGENTS.md, gerado das fontes na hora —
     * no arquivo que o executor anexa ao prompt de sistema do claude.
     * @param {string} arquivo
     */
    gravarRunbook: (arquivo) => consulta(["runbook", arquivo]),

    /**
     * `npm run validate -- <slug>`: o mesmo build e a mesma validação que
     * fecham uma etapa.
     * @param {string} slug
     * @returns {Promise<{ ok: boolean, texto: string }>}
     */
    validar: async (slug) => {
      const { codigo, saida, erro } = await rodar("validate", [slug]);
      return { ok: codigo === 0, texto: (saida || erro).trim() };
    },

    /**
     * Fotografa o site (desktop e celular), como o modelo o vê na revisão.
     * @param {string} slug
     */
    telas: async (slug) => {
      const { codigo, saida, erro } = await rodar("telas", [slug]);
      if (codigo !== 0) {
        throw new RecusaDoMotor((erro || saida).trim().split("\n").pop() || "Não foi possível fotografar o site.");
      }
    },
  };
}

/**
 * Encerra um processo com os descendentes dele. No Windows não há sinais:
 * a árvore sai na hora, pelo taskkill.
 * @param {number | undefined} pid
 */
function encerrarArvore(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // já saiu
  }
}

/** @typedef {ReturnType<typeof criarMotor>} Motor */
