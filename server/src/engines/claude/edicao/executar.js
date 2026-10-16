import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../../atomic-write.js";
import { configuracoesDoAgente, ESFORCOS, montarComando } from "../command.js";
import { ambienteDoFilho } from "../environment.js";
import { conferirSaida } from "../publish.js";
import { CONTRATO_DA_EDICAO, ESFORCO_PADRAO, INTOCAVEIS, MODELO_PADRAO, montarPedido, REGRAS_DA_EDICAO } from "./contrato.js";
import { ConflitoNoRepositorio, PASTA_DE_ANEXOS } from "./git.js";
import { AUTOR_DO_AJUSTE, commitParaATela, MARCA_DO_AJUSTE, ultimaAlteracao } from "./origem.js";

/**
 * A edição livre: um ajuste pelo Claude num site que mora num repositório do
 * GitHub (feito no Lovable, ou vinculado de fora). Uma execução, em quatro
 * etapas que aparecem no log:
 *
 * 1. **preparar** — o clone fica igual à última versão do branch no GitHub
 *    (o que o Lovable sincroniza), as dependências são instaladas quando
 *    mudaram e as imagens do pedido entram no clone;
 * 2. **editar** — o `claude -p` roda dentro do clone, com o contrato da
 *    edição livre, e o pedido leva a memória dos ajustes anteriores;
 * 3. **conferir** — o painel olha o que mudou: nada fora do permitido, nenhum
 *    import fora do `package.json`, nenhuma credencial, e o build passando;
 * 4. **enviar** — um commit normal, com a marca do ajuste, junto do que
 *    chegou ao GitHub enquanto o Claude trabalhava (sem reescrever o
 *    histórico), e o envio. O push publica a área de aprovação sozinho.
 *
 * Tudo o que esta execução escreve na tela passa pelo mesmo filtro das do
 * motor: caminhos desta máquina viram rótulos e segredos somem.
 */

/**
 * @typedef {{
 *   tipo: "edicao", slug: string, repo: string, branch: string, pedido: string,
 *   edicaoId: string, projectId: string,
 *   anexos?: { pasta: string, itens: Array<{ arquivo: string, nome: string, usar: boolean }> } | null,
 * }} PedidoDeEdicao `slug`: \`repo:<dono/nome>\` — o alvo na fila; dois ajustes no
 *   mesmo repositório nunca rodam juntos.
 * @typedef {"pushed" | "unchanged" | "failed" | "conflict" | "cancelled"} FimDaEdicao
 */

/** O nome da pasta do clone: o do repositório, sem caractere que vire caminho. */
export const pastaDoRepositorio = (/** @type {string} */ repo) => `edicao-${repo.replace(/[^A-Za-z0-9._-]+/g, "--")}`;

const cortar = (texto, n) => (texto.length > n ? `${texto.slice(0, n)}…` : texto);

/**
 * @param {{
 *   executor: import("../executor.js").Executor,
 *   caminhos: import("../workspace.js").Caminhos,
 *   git: import("./git.js").GitDaEdicao,
 *   protegidosPara: (dir: string) => string[],
 *   segredosNomeados: () => Array<[string, string]>,
 *   escolhas: () => { modelo?: string | null, esforco?: string | null, bin?: string },
 *   ambienteBase?: () => NodeJS.ProcessEnv,
 *   ambienteExtra?: () => Record<string, string | null | undefined>,
 *   dirDosAnexos: (repo: string) => string,
 * }} dependencias
 *   `protegidosPara`: o que o agente não lê, com o clone como pasta de trabalho.
 *   `escolhas`: o modelo e o esforço das Configurações e o executável do claude.
 *   `dirDosAnexos`: onde ficam os rascunhos de imagem dos pedidos deste repositório.
 */
export function criarEdicaoLivre({ executor, caminhos, git, protegidosPara, segredosNomeados, escolhas, ambienteBase = () => process.env, ambienteExtra = () => ({}), dirDosAnexos }) {
  const dirDoClone = (repo) => path.join(caminhos.dados, pastaDoRepositorio(repo));

  /** O filtro da tela desta execução: o do motor, com o clone virando `<repositório>`. */
  const filtroPara = (dir) => {
    const doMotor = executor.filtroDaTela();
    return (/** @type {string} */ texto) => doMotor(String(texto ?? "").split(dir).join("<repositório>").split(dir.replace(/\\/g, "/")).join("<repositório>"));
  };

  /**
   * A última versão do repositório e quem fez as alterações recentes — o que
   * a aba mostra. Alinha o clone com o GitHub (clona na primeira vez).
   * @param {{ repo: string, branch: string }} params
   */
  async function versao({ repo, branch }) {
    const dir = dirDoClone(repo);
    await git.alinhar({ dir, repo, branch });
    const commits = await git.historico({ dir, n: 15 });
    const ultima = ultimaAlteracao(commits);
    return {
      repo,
      branch,
      head: commits[0] ? commitParaATela(commits[0], repo) : null,
      last: ultima ? commitParaATela(ultima, repo) : null,
      commits: commits.map((commit) => commitParaATela(commit, repo)),
    };
  }

  /**
   * Põe as imagens do pedido dentro do clone: as de referência na pasta que o
   * Git ignora, as de usar no site em `public/img/ajustes/`.
   * @param {string} dir @param {PedidoDeEdicao} pedido
   */
  async function colocarAnexos(dir, pedido) {
    const lista = pedido.anexos;
    if (!lista?.itens?.length) return [];
    const origem = path.join(dirDosAnexos(pedido.repo), ".session", "anexos", lista.pasta);
    /** @type {Array<{ nome: string, caminho: string, usar: boolean }>} */
    const colocados = [];
    for (const item of lista.itens) {
      const destino = item.usar ? path.join("public", "img", "ajustes", item.arquivo) : path.join(PASTA_DE_ANEXOS, item.arquivo);
      await fs.mkdir(path.join(dir, path.dirname(destino)), { recursive: true });
      await fs.copyFile(path.join(origem, item.arquivo), path.join(dir, destino));
      colocados.push({ nome: item.nome, caminho: destino.replace(/\\/g, "/"), usar: item.usar });
    }
    return colocados;
  }

  /**
   * @param {PedidoDeEdicao} pedido
   * @param {{
   *   onEvento?: (evento: import("../executor.js").EventoDaExecucao) => void,
   *   extra?: Record<string, any>,
   *   anteriores: () => Promise<Array<{ request: string, summary: string | null, status: string, finishedAt: string | null }>>,
   *   aoComecar: (dados: { runId: string, base: any, branch: string, modelo: string, esforco: string }) => Promise<unknown> | unknown,
   *   esperarLeitura?: () => Promise<unknown>,
   * }} deps `esperarLeitura`: uma leitura de versão em andamento no mesmo clone, que termina antes de o ajuste mexer nele
   * @returns {import("../executor.js").Execucao}
   */
  function iniciar(pedido, deps) {
    const id = executor.novoId();
    const log = executor.arquivoDoLog(id);
    const dir = dirDoClone(pedido.repo);
    const filtro = filtroPara(dir);
    /** @type {string[]} */
    const sinais = [];
    /** @type {string | undefined} */
    let sessionId;
    /** @type {{ encerrar(sinal: string): void, vivo(): boolean } | undefined} */
    let controle;
    let cancelada = false;
    let etapa = "preparar";

    const cancelar = () => {
      if (cancelada) return;
      cancelada = true;
      const alvo = controle;
      if (!alvo?.vivo()) return;
      sinais.push("SIGINT");
      alvo.encerrar("SIGINT");
      const relogio = setTimeout(() => {
        if (!alvo.vivo()) return;
        sinais.push("SIGTERM");
        alvo.encerrar("SIGTERM");
      }, CONTRATO_DA_EDICAO.cancelamento_espera_ms);
      relogio.unref();
    };

    /** @param {import("../stream.js").Legivel[]} legiveis @param {unknown} [bruto] */
    const emitir = (legiveis, bruto) => {
      if (!legiveis.length && bruto === undefined) return;
      deps.onEvento?.({
        ts: new Date().toISOString(),
        legiveis: legiveis.map((linha) => ({ ...linha, texto: filtro(linha.texto) })),
        bruto,
        slug: pedido.slug,
        sessionId,
        etapa,
      });
    };
    /** O que o painel conduz fica também no stream guardado: o log do ajuste conta a história inteira. */
    const anotar = (subtype, texto) => {
      try {
        appendFileSync(log, `${JSON.stringify({ type: "joinvixable", subtype, ts: new Date().toISOString(), texto })}
`);
      } catch {
        // sem o arquivo, o log ao vivo continua valendo
      }
    };
    const nota = (texto) => {
      anotar("aviso", texto);
      emitir([{ tipo: "aviso", texto }]);
    };
    const mudarEtapa = (nova, texto) => {
      etapa = nova;
      anotar("etapa", texto);
      emitir([{ tipo: "etapa", texto }]);
    };

    const rodar = async () => {
      const soltar = executor.travar(id, `ajuste em ${pedido.repo}`, { aoLado: true, slug: pedido.slug });
      const inicio = Date.now();
      const configurado = escolhas();
      const nivel = (valor) => (ESFORCOS.includes(String(valor ?? "").trim()) ? String(valor).trim() : "");
      const modelo = (configurado.modelo ?? "").trim() || MODELO_PADRAO;
      const esforco = nivel(configurado.esforco) || ESFORCO_PADRAO;
      /** @type {Record<string, any>} */
      const registro = {
        ...(deps.extra ?? {}),
        id,
        data: new Date(inicio).toISOString(),
        tipo: "edicao",
        pedido: cortar(pedido.pedido, 300),
        repo: pedido.repo,
        edicaoId: pedido.edicaoId,
        status: "rodando",
        modelo,
        esforco,
        pid: process.pid,
        log: path.basename(log),
      };
      void executor.registrar({ ...registro });

      /** @type {FimDaEdicao} */
      let fim = "failed";
      let mensagem = "";
      /** @type {any} */
      let base = null;
      /** @type {any} */
      let commit = null;
      /** @type {string[]} */
      let arquivos = [];
      /** @type {string | null} */
      let resumo = null;
      let custo = null;
      let turnos = null;
      try {
        mkdirSync(caminhos.execucoes, { recursive: true });

        // 1. A última versão do GitHub.
        mudarEtapa("preparar", `Etapa preparar (buscando a última versão de ${pedido.repo} no GitHub)`);
        await deps.esperarLeitura?.();
        const { clonou } = await git.alinhar({ dir, repo: pedido.repo, branch: pedido.branch });
        const commits = await git.historico({ dir, n: 15 });
        const ultima = ultimaAlteracao(commits);
        base = ultima ? { ...commitParaATela(ultima, pedido.repo), sha: commits[0]?.sha ?? ultima.sha } : null;
        const cabeca = commits[0]?.sha ?? "";
        if (base) {
          const quem = { lovable: "no Lovable", claude: "pelo Claude", person: `por ${base.author}`, panel: "pelo painel" }[base.origin];
          nota(`${clonou ? "Repositório clonado" : "Repositório atualizado"}. Última alteração no site: feita ${quem} em ${base.at.slice(0, 16).replace("T", " ")} — "${cortar(base.message, 120)}".`);
        }
        await deps.aoComecar({ runId: id, base, branch: pedido.branch, modelo, esforco });
        if (cancelada) throw new Cancelada();

        const { instalou } = await git.instalar(dir);
        if (instalou) nota("Dependências do site instaladas (sem scripts de instalação).");
        const anexos = await colocarAnexos(dir, pedido);
        if (cancelada) throw new Cancelada();

        // 2. O Claude, dentro do clone.
        mudarEtapa("editar", "Etapa editar (o Claude está ajustando o site)");
        const regras = path.join(caminhos.dados, "edicao-regras.md");
        await trocarSeMudou(regras, REGRAS_DA_EDICAO);
        const configuracoes = path.join(caminhos.dados, "edicao-config", `${id}.json`);
        await fs.mkdir(path.dirname(configuracoes), { recursive: true });
        await fs.writeFile(
          configuracoes,
          `${JSON.stringify(configuracoesDoAgente({ contrato: CONTRATO_DA_EDICAO, protegidos: protegidosPara(dir) }), null, 2)}\n`,
        );
        const entrada = montarPedido({ pedido: pedido.pedido, base, anteriores: await deps.anteriores(), anexos });
        try {
          const sessao = await executor.rodarSessao({
            contrato: CONTRATO_DA_EDICAO,
            comando: montarComando({
              contrato: CONTRATO_DA_EDICAO,
              bin: configurado.bin,
              modelo,
              esforco,
              tipo: "ajuste",
              runbook: regras,
              configuracoes,
            }),
            entrada,
            cwd: dir,
            env: ambienteDoFilho({
              base: ambienteBase(),
              definidas: { ...CONTRATO_DA_EDICAO.variaveis_definidas, ...ambienteExtra() },
              removidas: CONTRATO_DA_EDICAO.variaveis_removidas,
            }),
            log,
            emitir,
            aoIniciar: (novo) => (controle = novo),
            aoSessao: (sessao) => {
              sessionId = sessao;
              registro.session_id = sessao;
              void executor.registrar({ ...registro });
            },
            cancelada: () => cancelada,
          });
          custo = sessao.custoEstimadoUsd;
          turnos = sessao.turnos;
          resumo = sessao.final ? cortar(filtro(sessao.final), 2000) : null;
          if (cancelada) throw new Cancelada();
          if (sessao.falha) throw new FalhaDaEdicao(sessao.falha);
        } finally {
          rmSync(configuracoes, { force: true });
        }

        // 3. O que mudou, conferido pelo painel.
        mudarEtapa("conferir", "Etapa conferir (o painel confere o que mudou e roda o build)");
        arquivos = await git.alterados(dir);
        if (!arquivos.length) {
          fim = "unchanged";
          mensagem = resumo ?? "O Claude terminou sem alterar nenhum arquivo.";
          return;
        }
        const proibidos = arquivos.filter((arquivo) => INTOCAVEIS.some((regra) => regra.test(arquivo)));
        if (proibidos.length) {
          throw new FalhaDaEdicao(`O ajuste mexeu no que o painel não deixa mudar (${proibidos.join(", ")}). Nada foi enviado.`);
        }
        const existentes = [];
        for (const arquivo of arquivos) {
          const absoluto = path.join(dir, arquivo);
          const info = await fs.stat(absoluto).catch(() => null);
          if (info?.isFile()) existentes.push({ path: arquivo, absolute: absoluto, size: info.size, origem: "projeto" });
        }
        const motivos = await conferirSaida(/** @type {any} */ (existentes), {
          declaradas: await git.dependenciasDeclaradas(dir),
          segredos: segredosNomeados(),
        });
        if (motivos.length) throw new FalhaDaEdicao(motivos.join("\n").replace("Ele construiu aqui com as dependências do motor, mas quebraria no GitHub.", "Ele quebraria o build no GitHub."));
        const build = await git.build(dir);
        if (!build.ok) throw new FalhaDaEdicao(`O build não passa com o ajuste, e nada foi enviado:\n${filtro(build.saida)}`);
        nota(`Build aprovado. ${arquivos.length === 1 ? "1 arquivo alterado" : `${arquivos.length} arquivos alterados`}: ${cortar(arquivos.join(", "), 400)}.`);
        if (cancelada) throw new Cancelada();

        // 4. O commit e o envio.
        mudarEtapa("enviar", "Etapa enviar (commit e envio ao GitHub)");
        const titulo = cortar(pedido.pedido.replace(/\s+/g, " ").trim(), 64);
        const mensagemDoCommit = [
          `Ajuste pelo Claude: ${titulo}`,
          "",
          pedido.pedido.trim(),
          "",
          `Pedido${deps.extra?.por ? ` por ${deps.extra.por}` : ""} no Painel Sites Express.`,
          "",
          `${MARCA_DO_AJUSTE}: ${pedido.edicaoId}`,
          "",
        ].join("\n");
        await git.commitar({ dir, mensagem: mensagemDoCommit, autor: AUTOR_DO_AJUSTE });

        // O GitHub pode ter andado enquanto o Claude trabalhava (uma edição no
        // Lovable): o commit do ajuste vai para cima do que chegou, e o build
        // é conferido de novo com tudo junto.
        for (let tentativa = 0; tentativa < 2; tentativa++) {
          const { juntou } = await git.juntarComRemoto({ dir, branch: pedido.branch, base: tentativa === 0 ? cabeca : "" });
          if (juntou) {
            nota("O site mudou no GitHub durante o ajuste: as alterações foram juntadas à versão nova.");
            const deNovo = await git.build(dir);
            if (!deNovo.ok) throw new FalhaDaEdicao(`Junto da versão nova do GitHub, o build não passa, e nada foi enviado:\n${filtro(deNovo.saida)}`);
          }
          if (await git.enviar({ dir, branch: pedido.branch })) {
            const [novo] = await git.historico({ dir, n: 1 });
            commit = { ...commitParaATela(novo, pedido.repo), files: arquivos };
            fim = "pushed";
            mensagem = resumo ?? "Ajuste enviado ao GitHub.";
            return;
          }
        }
        throw new FalhaDaEdicao("O GitHub recusou o envio duas vezes (o repositório está mudando agora). Nada foi enviado; peça o ajuste de novo em instantes.");
      } catch (/** @type {any} */ erro) {
        if (erro instanceof Cancelada || cancelada) {
          fim = "cancelled";
          mensagem = "Ajuste cancelado. Nada foi enviado ao GitHub.";
        } else if (erro instanceof ConflitoNoRepositorio) {
          fim = "conflict";
          mensagem = erro.message;
        } else {
          fim = "failed";
          mensagem = filtro(git.semToken(erro?.message ?? String(erro)));
        }
      } finally {
        const duracaoMs = Date.now() - inicio;
        const desfecho = {
          pushed: `Enviado ao GitHub: commit ${commit?.sha?.slice(0, 7) ?? ""}. A área de aprovação republica pelo push.`,
          unchanged: "Terminado sem alteração: nada a enviar.",
          conflict: `Não enviado: ${mensagem}`,
          cancelled: mensagem,
          failed: `Não enviado: ${mensagem}`,
        }[fim];
        anotar("aviso", cortar(filtro(desfecho), 2000));
        emitir([{ tipo: fim === "pushed" || fim === "unchanged" ? "resultado" : "erro", texto: cortar(filtro(desfecho), 2000) }]);
        const status = fim === "pushed" || fim === "unchanged" ? "sucesso" : fim === "cancelled" ? "cancelada" : "falha";
        Object.assign(registro, {
          status,
          duracao_ms: duracaoMs,
          total_cost_usd: custo,
          turnos,
          mensagem: cortar(filtro(mensagem), 2000),
          etapa_aberta: null,
          sinais,
          edicao: fim,
          ...(commit ? { commit: commit.sha } : {}),
        });
        delete registro.pid;
        await executor.registrar({ ...registro });
        soltar();
        resultado = {
          id,
          status,
          pedido: cortar(pedido.pedido, 300),
          slug: pedido.slug,
          sessionId,
          codigoSaida: null,
          duracaoMs,
          custoEstimadoUsd: custo,
          mensagem: cortar(filtro(mensagem), 2000),
          sinais,
          log,
          edicao: { fim, base, commit, arquivos, resumo },
        };
      }
    };

    /** @type {any} */
    let resultado;
    return {
      id,
      // O resultado é montado no fim de qualquer caminho (enviado, sem mudança, falha, cancelado).
      promessa: rodar().then(() => resultado),
      cancelar,
      get slug() {
        return pedido.slug;
      },
      get sessionId() {
        return sessionId;
      },
    };
  }

  async function trocarSeMudou(arquivo, conteudo) {
    const atual = await fs.readFile(arquivo, "utf8").catch(() => null);
    if (atual !== conteudo) await writeFileAtomic(arquivo, conteudo);
  }

  return { iniciar, versao, dirDoClone };
}

class Cancelada extends Error {}
class FalhaDaEdicao extends Error {}
