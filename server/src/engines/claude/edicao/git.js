import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ambienteDoFilho } from "../environment.js";

/**
 * O Git e o npm da edição livre: o clone do repositório do site nesta máquina,
 * sempre alinhado à última versão do branch que o Lovable sincroniza, e o
 * caminho de volta — commit normal e envio, sem reescrever o histórico do
 * GitHub (o Lovable perde o que não estava no GitHub quando o histórico muda).
 *
 * O token do GitHub nunca fica gravado no clone: vai em cada comando que fala
 * com o GitHub, por variável de ambiente do Git (cabeçalho de autorização), e
 * some de qualquer mensagem de erro. Nada aqui é rodado pelo agente — o
 * contrato dele nega `git`.
 */

/** Uma falha de comando, com a saída já sem o token. */
class FalhaDoGit extends Error {
  /** @param {string} mensagem @param {{ saida?: string, codigo?: number | null }} [extra] */
  constructor(mensagem, { saida = "", codigo = null } = {}) {
    super(mensagem);
    this.saida = saida;
    this.codigo = codigo;
  }
}

/** As alterações não se juntam com o que chegou ao GitHub durante o ajuste. */
export class ConflitoNoRepositorio extends Error {}

/** A pasta, fora do Git, onde o painel põe as imagens anexadas ao pedido. */
export const PASTA_DE_ANEXOS = ".painel-anexos";

/** Quanto cada tipo de comando pode demorar. */
const PRAZOS = { rede: 5 * 60_000, local: 60_000, instalar: 10 * 60_000, build: 10 * 60_000 };

/** O fim de uma saída longa: é onde o erro costuma estar. */
const rabo = (texto, n = 4000) => (texto.length > n ? `…${texto.slice(-n)}` : texto);

/**
 * @param {{
 *   token: () => string,
 *   base?: () => NodeJS.ProcessEnv,
 *   gitBin?: string,
 *   npmBin?: string,
 *   remoto?: (repo: string) => string,
 * }} params
 *   `remoto`: o endereço do repositório; os testes trocam o GitHub por um repositório local.
 */
export function criarGit({ token, base = () => process.env, gitBin = "git", npmBin, remoto = (repo) => `https://github.com/${repo}.git` }) {
  const npm = npmBin ?? (process.platform === "win32" ? "npm.cmd" : "npm");

  /** Tira o token (e a forma dele em base64) de um texto. */
  const semToken = (texto) => {
    const valor = token();
    let limpo = String(texto ?? "");
    if (valor) {
      limpo = limpo.split(valor).join("•••");
      limpo = limpo.split(Buffer.from(`x-access-token:${valor}`).toString("base64")).join("•••");
    }
    return limpo;
  };

  /**
   * O ambiente de um comando: a lista de permissão de sempre, o Git sem
   * perguntar nada no terminal e, quando fala com o GitHub, o cabeçalho de
   * autorização (e nenhum gerenciador de credenciais da máquina).
   * @param {boolean} comRede
   */
  const ambiente = (comRede) => {
    const env = ambienteDoFilho({ base: base(), definidas: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } });
    const valor = token();
    if (comRede && valor) {
      // Depois da lista de permissão, que descarta valor vazio: o `credential.helper`
      // vazio é o que desliga o gerenciador de credenciais da máquina — um token
      // recusado nunca vira a senha salva de outra pessoa.
      Object.assign(env, {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${valor}`).toString("base64")}`,
        GIT_CONFIG_KEY_1: "credential.helper",
        GIT_CONFIG_VALUE_1: "",
      });
    }
    return env;
  };

  /**
   * @param {string} bin
   * @param {string[]} args
   * @param {{ cwd?: string, entrada?: string, prazo?: number, rede?: boolean, shell?: boolean }} [opcoes]
   * @returns {Promise<{ codigo: number | null, saida: string, erro: string }>}
   */
  function rodar(bin, args, { cwd, entrada, prazo = PRAZOS.local, rede = false, shell = false } = {}) {
    return new Promise((resolve) => {
      let saida = "";
      let erro = "";
      let filho;
      try {
        filho = spawn(bin, args, { cwd, env: ambiente(rede), windowsHide: true, shell });
      } catch (/** @type {any} */ falha) {
        resolve({ codigo: null, saida, erro: falha?.message ?? String(falha) });
        return;
      }
      const relogio = setTimeout(() => {
        erro += `\n(o comando passou de ${Math.round(prazo / 1000)} s e foi encerrado)`;
        filho.kill();
      }, prazo);
      filho.stdout.on("data", (pedaco) => (saida = (saida + pedaco.toString("utf8")).slice(-200_000)));
      filho.stderr.on("data", (pedaco) => (erro = (erro + pedaco.toString("utf8")).slice(-200_000)));
      filho.on("error", (falha) => {
        clearTimeout(relogio);
        resolve({ codigo: null, saida, erro: `${erro}\n${falha.message}` });
      });
      filho.on("close", (codigo) => {
        clearTimeout(relogio);
        resolve({ codigo, saida: semToken(saida), erro: semToken(erro) });
      });
      filho.stdin.on("error", () => undefined);
      filho.stdin.end(entrada ?? "");
    });
  }

  /**
   * Um comando do Git que precisa dar certo.
   * @param {string[]} args
   * @param {{ cwd?: string, entrada?: string, rede?: boolean, prazo?: number }} [opcoes]
   */
  async function git(args, opcoes = {}) {
    const r = await rodar(gitBin, args, { prazo: opcoes.rede ? PRAZOS.rede : PRAZOS.local, ...opcoes });
    if (r.codigo !== 0) {
      throw new FalhaDoGit(`git ${args[0]} falhou: ${rabo(r.erro.trim() || r.saida.trim(), 600)}`, {
        saida: `${r.saida}\n${r.erro}`,
        codigo: r.codigo,
      });
    }
    return r.saida;
  }

  /**
   * Deixa o clone igual à última versão do branch no GitHub: clona na primeira
   * vez; depois busca, aponta o branch para o do GitHub e limpa o que sobrou
   * de um ajuste anterior. As dependências instaladas ficam.
   *
   * @param {{ dir: string, repo: string, branch: string }} params
   * @returns {Promise<{ sha: string, clonou: boolean }>}
   */
  async function alinhar({ dir, repo, branch }) {
    const url = remoto(repo);
    let clonou = false;
    if (!existsSync(path.join(dir, ".git"))) {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(dir), { recursive: true });
      // Fins de linha como estão no repositório: o que o Lovable escreveu volta
      // igual. E caminhos longos: o clone mora fundo na pasta de dados, e o
      // Windows recusaria um arquivo além dos 260 caracteres.
      await git(["-c", "core.longpaths=true", "clone", "--no-tags", "--single-branch", "--branch", branch, "-c", "core.autocrlf=false", "-c", "core.longpaths=true", url, dir], {
        rede: true,
      });
      clonou = true;
    } else {
      await git(["remote", "set-url", "origin", url], { cwd: dir });
      await git(["config", "core.autocrlf", "false"], { cwd: dir });
      await git(["config", "core.longpaths", "true"], { cwd: dir });
    }
    await git(["fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: dir, rede: true });
    // Um rebase que ficou pela metade (o painel caiu no meio) não pode segurar o clone.
    await rodar(gitBin, ["rebase", "--abort"], { cwd: dir });
    await git(["checkout", "-B", branch, `origin/${branch}`], { cwd: dir });
    await git(["reset", "--hard", `origin/${branch}`], { cwd: dir });
    // Sai tudo o que não é do repositório, inclusive o que ele ignora (build, anexos
    // do pedido anterior) — menos as dependências, que custam a instalar.
    await git(["clean", "-ffdx", "-e", "node_modules", "-e", "node_modules/**"], { cwd: dir });
    await fs.mkdir(path.join(dir, ".git", "info"), { recursive: true });
    await fs.writeFile(path.join(dir, ".git", "info", "exclude"), `${PASTA_DE_ANEXOS}/\n`);
    return { sha: (await git(["rev-parse", "HEAD"], { cwd: dir })).trim(), clonou };
  }

  /**
   * Os commits mais recentes do branch, com os arquivos de cada um.
   * @param {{ dir: string, ref?: string, n?: number }} params
   * @returns {Promise<Array<{ sha: string, authorName: string, authorEmail: string,
   *   committerName: string, committerEmail: string, at: string, subject: string,
   *   body: string, files: string[] }>>}
   */
  async function historico({ dir, ref = "HEAD", n = 15 }) {
    const formato = ["%H", "%an", "%ae", "%cn", "%ce", "%aI", "%s", "%b"].join("%x1f");
    const saida = await git(["log", `-n${n}`, `--format=%x1e${formato}%x1d`, "--name-only", ref], { cwd: dir });
    return saida
      .split("\x1e")
      .filter((bloco) => bloco.trim())
      .map((bloco) => {
        const [cabeca, arquivos = ""] = bloco.split("\x1d");
        const [sha, authorName, authorEmail, committerName, committerEmail, at, subject, body = ""] = cabeca.split("\x1f");
        return {
          sha,
          authorName,
          authorEmail,
          committerName,
          committerEmail,
          at,
          subject,
          body: body.trim(),
          files: arquivos
            .split("\n")
            .map((linha) => linha.trim())
            .filter(Boolean),
        };
      });
  }

  /**
   * O que mudou no clone desde o último commit (fora a pasta dos anexos).
   * @param {string} dir
   * @returns {Promise<string[]>}
   */
  async function alterados(dir) {
    const saida = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: dir });
    const partes = saida.split("\0").filter(Boolean);
    /** @type {string[]} */
    const arquivos = [];
    for (let i = 0; i < partes.length; i++) {
      const estado = partes[i].slice(0, 2);
      arquivos.push(partes[i].slice(3));
      // Renomeado: o caminho antigo vem em seguida.
      if (estado.includes("R") || estado.includes("C")) arquivos.push(partes[++i]);
    }
    return [...new Set(arquivos)].filter((arquivo) => !arquivo.startsWith(`${PASTA_DE_ANEXOS}/`));
  }

  /**
   * Um commit com tudo o que mudou. O autor é o do painel, e a mensagem
   * termina com a marca do ajuste — é por ela que a próxima leitura sabe que a
   * alteração foi do Claude.
   * @param {{ dir: string, mensagem: string, autor: { nome: string, email: string } }} params
   */
  async function commitar({ dir, mensagem, autor }) {
    await git(["add", "-A", "--", "."], { cwd: dir });
    await git(["-c", `user.name=${autor.nome}`, "-c", `user.email=${autor.email}`, "commit", "--no-verify", "-F", "-"], {
      cwd: dir,
      entrada: mensagem,
    });
    return (await git(["rev-parse", "HEAD"], { cwd: dir })).trim();
  }

  /**
   * Junta o commit do ajuste ao que chegou no GitHub enquanto ele rodava. Só o
   * commit local muda de base: o histórico do GitHub fica como está.
   * @param {{ dir: string, branch: string, base: string }} params `base`: a versão de onde o ajuste partiu
   * @returns {Promise<{ juntou: boolean, remoto: string }>} `juntou`: havia novidade no GitHub
   */
  async function juntarComRemoto({ dir, branch, base }) {
    await git(["fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: dir, rede: true });
    const remoto = (await git(["rev-parse", `origin/${branch}`], { cwd: dir })).trim();
    if (remoto === base) return { juntou: false, remoto };
    const r = await rodar(gitBin, ["-c", "user.name=Painel", "-c", "user.email=painel@localhost", "rebase", `origin/${branch}`], {
      cwd: dir,
    });
    if (r.codigo !== 0) {
      await rodar(gitBin, ["rebase", "--abort"], { cwd: dir });
      throw new ConflitoNoRepositorio(
        "O site mudou no GitHub enquanto o Claude trabalhava (alguém editou no Lovable?), e as alterações mexem nas mesmas linhas. Nada foi enviado. Peça o ajuste de novo: ele parte da versão nova.",
      );
    }
    return { juntou: true, remoto };
  }

  /** Envia o branch ao GitHub. Um envio recusado (o GitHub andou) volta como `false`. */
  async function enviar({ dir, branch }) {
    const r = await rodar(gitBin, ["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: dir, rede: true, prazo: PRAZOS.rede });
    if (r.codigo === 0) return true;
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(r.erro)) return false;
    throw new FalhaDoGit(`O envio ao GitHub falhou: ${rabo(r.erro.trim(), 600)}`, { saida: r.erro, codigo: r.codigo });
  }

  /**
   * O que identifica as dependências do site: o `package.json` e o arquivo de
   * travamento. Muda quando alguém adiciona um pacote no Lovable.
   * @param {string} dir
   */
  async function assinaturaDasDependencias(dir) {
    const hash = createHash("sha256");
    for (const nome of ["package.json", "package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]) {
      const caminho = path.join(dir, nome);
      if (existsSync(caminho)) hash.update(nome).update(await fs.readFile(caminho));
    }
    return hash.digest("hex");
  }

  /**
   * Instala as dependências quando elas mudaram desde a última instalação. Sem
   * scripts de instalação: o build do Vite não precisa deles, e nenhum código
   * do repositório roda nesta máquina só por instalar.
   * @param {string} dir
   * @returns {Promise<{ instalou: boolean }>}
   */
  async function instalar(dir) {
    const marca = path.join(dir, ".git", "painel-dependencias");
    const assinatura = await assinaturaDasDependencias(dir);
    const anterior = await fs.readFile(marca, "utf8").catch(() => "");
    if (anterior === assinatura && existsSync(path.join(dir, "node_modules"))) return { instalou: false };
    const comTrava = existsSync(path.join(dir, "package-lock.json"));
    const args = comTrava
      ? ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]
      : ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"];
    const r = await rodar(npm, args, { cwd: dir, prazo: PRAZOS.instalar, shell: process.platform === "win32", rede: false });
    if (r.codigo !== 0) {
      throw new FalhaDoGit(`A instalação das dependências do site falhou (npm ${args[0]}): ${rabo(`${r.erro}\n${r.saida}`.trim(), 1500)}`);
    }
    await fs.writeFile(marca, assinatura);
    return { instalou: true };
  }

  /**
   * `npm run build`, como o GitHub vai rodar.
   * @param {string} dir
   * @returns {Promise<{ ok: boolean, saida: string }>}
   */
  async function build(dir) {
    const r = await rodar(npm, ["run", "build"], { cwd: dir, prazo: PRAZOS.build, shell: process.platform === "win32" });
    return { ok: r.codigo === 0, saida: rabo(`${r.saida}\n${r.erro}`.trim(), 3000) };
  }

  /** As dependências que o `package.json` do site declara. */
  async function dependenciasDeclaradas(dir) {
    const pacote = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    return Object.keys({ ...(pacote.dependencies ?? {}), ...(pacote.devDependencies ?? {}) });
  }

  return { alinhar, historico, alterados, commitar, juntarComRemoto, enviar, instalar, build, dependenciasDeclaradas, semToken };
}

/** @typedef {ReturnType<typeof criarGit>} GitDaEdicao */
