import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * A edição livre de ponta a ponta: um site "do Lovable" num repositório Git
 * (um repositório local faz o papel do GitHub), o claude falso no lugar do
 * executável e o serviço do motor de verdade — fila, memória dos ajustes,
 * clone, build, commit e envio.
 *
 * Nenhum teste chama o claude de verdade nem o GitHub.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-edicao-"));
const dataDir = path.join(raiz, "dados");
process.env.PANEL_DATA_DIR = dataDir;
process.env.PREVIEW_WATCH_INTERVAL_MS = "0";

const { linkGeneration, setGenerationDevArea } = await import("../../../store/generations.js");
const memoria = await import("../../../store/repo-edits.js");
const { CLAUDE_FALSO, SEGREDOS_DO_PAINEL } = await import("../fixtures/apoio.mjs");
const { criarMotorFalso } = await import("../fixtures/motor-falso.mjs");
const { criarServicoClaude } = await import("../service.js");
const { caminhosDoMotor } = await import("../workspace.js");
const { criarGit } = await import("./git.js");
const { origemDoCommit, ultimaAlteracao } = await import("./origem.js");

const temGit = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

const REPO = "joinvix-sites/aurora-eng";
const PROJETO = "projeto-aurora";
const TOKEN = "github_pat_de_teste_0123456789abcdef";
const remoto = path.join(raiz, "github", "aurora.git");
const chamadasEm = path.join(raiz, "chamadas.jsonl");
const engineDir = path.join(raiz, "pacote");
fs.mkdirSync(path.join(engineDir, "node_modules"), { recursive: true });

/** Um comando git num repositório, como alguém de fora (o Lovable, uma pessoa). */
function g(cwd, args, env = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const COMO_LOVABLE = {
  GIT_AUTHOR_NAME: "lovable-dev[bot]",
  GIT_AUTHOR_EMAIL: "123456+lovable-dev[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "gpt-engineer-app[bot]",
  GIT_COMMITTER_EMAIL: "159125892+gpt-engineer-app[bot]@users.noreply.github.com",
};
const COMO_PAINEL = { GIT_AUTHOR_NAME: "joinvix", GIT_AUTHOR_EMAIL: "joinvix@users.noreply.github.com", GIT_COMMITTER_NAME: "joinvix", GIT_COMMITTER_EMAIL: "joinvix@users.noreply.github.com" };

/** Uma cópia de trabalho do "GitHub", para o teste editar como o Lovable editaria. */
const lovable = path.join(raiz, "lovable");

/** O Lovable muda um arquivo e envia ao GitHub. */
function editarNoLovable(arquivo, transformar, mensagem) {
  g(lovable, ["pull", "--quiet", "origin", "main"]);
  const caminho = path.join(lovable, arquivo);
  fs.writeFileSync(caminho, transformar(fs.readFileSync(caminho, "utf8")));
  g(lovable, ["add", "-A"]);
  g(lovable, ["commit", "-q", "-m", mensagem], COMO_LOVABLE);
  g(lovable, ["push", "-q", "origin", "main"]);
}

const controle = { cenario: "edicao", sinal: "", pronto: "" };
const acompanhadas = [];

const servico = criarServicoClaude({
  dataDir,
  motor: criarMotorFalso({ trabalho: caminhosDoMotor({ dataDir, dirMotor: engineDir }).trabalho }).motor,
  lerConfig: () => ({
    enableGeneration: true,
    bin: CLAUDE_FALSO,
    model: "",
    effort: "",
    reviewRounds: null,
    parallelSites: null,
    parallelAdjustments: null,
    artDirection: "",
    motion: "",
    browserPath: "",
    humanApproval: null,
    engineDir,
  }),
  base: () => ({ ...process.env, ...SEGREDOS_DO_PAINEL, GITHUB_TOKEN: TOKEN }),
  ambienteExtra: () => ({
    CLAUDE_FALSO_CENARIO: controle.cenario,
    CLAUDE_FALSO_REGISTRO: chamadasEm,
    CLAUDE_FALSO_SINAL: controle.sinal,
    CLAUDE_FALSO_PRONTO: controle.pronto,
  }),
  github: {
    conta: () => ({ githubToken: TOKEN, organization: "joinvix-sites" }),
    config: () => ({}),
    getRepository: async () => ({ default_branch: "main", full_name: REPO }),
    createOrgRepository: async () => {
      throw new Error("não deveria criar repositório");
    },
    commitSite: async () => {
      throw new Error("a edição livre não usa a API de commits");
    },
  },
  areaDeAprovacao: { configurada: () => true, publicar: async () => ({}), acompanhar: (projectId, id) => acompanhadas.push([projectId, id]) },
  git: criarGit({ token: () => TOKEN, remoto: () => remoto }),
  log: () => undefined,
});

/** Espera o ajuste sair da fila e devolve o registro dele na memória. */
async function terminado(editId, prazoMs = 60_000) {
  const ate = Date.now() + prazoMs;
  while (Date.now() < ate) {
    const edit = await memoria.getRepoEdit(PROJETO, editId);
    if (edit && edit.status !== "queued" && edit.status !== "running") {
      // O fim da fila (a memória e a área de aprovação) acabou de gravar.
      await new Promise((ok) => setTimeout(ok, 50));
      return /** @type {NonNullable<typeof edit>} */ (await memoria.getRepoEdit(PROJETO, editId));
    }
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error(`o ajuste ${editId} não terminou`);
}

const pedir = async (pedido, cenario = "edicao") => {
  controle.cenario = cenario;
  const { edit } = await servico.pedirEdicao(PROJETO, { pedido }, { quem: "Ana" });
  return terminado(edit.id);
};

const chamadas = () => fs.readFileSync(chamadasEm, "utf8").trim().split("\n").map((linha) => JSON.parse(linha));
const cabecaDoGithub = () => g(remoto, ["rev-parse", "main"]);
const arquivoNoGithub = (arquivo) => g(remoto, ["show", `main:${arquivo}`]);

before(async () => {
  if (!temGit) return;
  // O "GitHub": um repositório nu, com o site que o Lovable escreveu.
  fs.mkdirSync(path.dirname(remoto), { recursive: true });
  g(raiz, ["init", "-q", "--bare", "-b", "main", remoto]);
  g(raiz, ["clone", "-q", remoto, lovable]);
  g(lovable, ["checkout", "-q", "-b", "main"]);
  fs.mkdirSync(path.join(lovable, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(lovable, "package.json"),
    `${JSON.stringify({ name: "aurora", private: true, scripts: { build: "node build.mjs" }, dependencies: { react: "^19.0.0" } }, null, 2)}\n`,
  );
  // O build do site de teste: falha se houver src/QUEBRA.
  fs.writeFileSync(
    path.join(lovable, "build.mjs"),
    'import { existsSync } from "node:fs";\nif (existsSync("src/QUEBRA")) { console.error("erro de build: src/QUEBRA"); process.exit(1); }\nconsole.log("build ok");\n',
  );
  fs.writeFileSync(path.join(lovable, "src", "App.tsx"), 'export default function App() {\n  return <h1>Bem-vindo</h1>;\n}\n');
  fs.writeFileSync(path.join(lovable, "src", "Footer.tsx"), "export const Footer = () => <footer>Aurora</footer>;\n");
  fs.writeFileSync(path.join(lovable, ".gitignore"), "node_modules\ndist\n");
  g(lovable, ["add", "-A"]);
  g(lovable, ["commit", "-q", "-m", "Use tech stack vite_react_shadcn_ts"], COMO_LOVABLE);
  g(lovable, ["push", "-q", "-u", "origin", "main"]);
  // Depois, o painel grava o workflow da área de aprovação: não é alteração do site.
  fs.mkdirSync(path.join(lovable, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(lovable, ".github", "workflows", "Area.yml"), "name: area\n");
  g(lovable, ["add", "-A"]);
  g(lovable, ["commit", "-q", "-m", "Adicionar workflow da área de desenvolvimento"], COMO_PAINEL);
  g(lovable, ["push", "-q", "origin", "main"]);

  const site = await linkGeneration(PROJETO, { id: "3f1c2b9a-0000-4000-8000-0000000000aa", repoFullName: REPO, by: "Ana" });
  await setGenerationDevArea(PROJETO, site.id, { state: "live", repoFullName: REPO, slug: "aurora", url: "https://aprovacao.exemplo.com.br/aurora/" });
});

after(async () => {
  await servico.parar();
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("quem fez cada alteração", () => {
  const commit = (extra) => ({ sha: "a", authorName: "", authorEmail: "", committerName: "", committerEmail: "", at: "", subject: "", body: "", files: ["src/App.tsx"], ...extra });

  it("Lovable pelo robô dele, Claude pela marca do ajuste, painel quando só mexe em .github/", () => {
    assert.equal(origemDoCommit(commit({ authorName: "lovable-dev[bot]", committerName: "gpt-engineer-app[bot]" })), "lovable");
    assert.equal(origemDoCommit(commit({ authorName: "x", body: "texto\n\nAjuste-Painel: aj-1" })), "claude");
    assert.equal(origemDoCommit(commit({ authorName: "joinvix", files: [".github/workflows/Build.yml"] })), "panel");
    assert.equal(origemDoCommit(commit({ authorName: "Ana" })), "person");
  });

  it("a última alteração do site pula a configuração de publicação do painel", () => {
    const lista = [
      commit({ sha: "b", authorName: "joinvix", files: [".github/workflows/Area.yml"] }),
      commit({ sha: "a", authorName: "lovable-dev[bot]" }),
    ];
    assert.equal(ultimaAlteracao(lista)?.sha, "a");
  });
});

describe("a edição livre", { skip: !temGit }, () => {
  it("a aba sabe o repositório; a versão diz que a última alteração foi do Lovable", async () => {
    const aba = await servico.edicoes(PROJETO);
    assert.equal(aba.available, true);
    assert.equal(aba.repo, REPO);
    assert.deepEqual(aba.edits, []);

    const versao = await servico.versaoDaEdicao(PROJETO);
    assert.equal(versao.head.origin, "panel");
    assert.equal(versao.last.origin, "lovable");
    assert.equal(versao.last.author, "Lovable");
    assert.equal(versao.commits.length, 2);
  });

  it("o ajuste parte da última versão, vai ao GitHub com a marca do Claude e fica na memória", async () => {
    const antes = cabecaDoGithub();
    const edit = await pedir("Troque o título da página inicial");
    assert.equal(edit.status, "pushed", edit.error ?? "");
    assert.equal(edit.base?.origin, "lovable");
    assert.equal(edit.commit?.origin, "claude");
    assert.deepEqual(edit.commit?.files, ["src/App.tsx"]);
    assert.match(edit.summary ?? "", /Título da página inicial/);
    assert.equal(edit.by, "Ana");

    // No GitHub: um commit novo em cima do de antes (nada reescrito), com o autor e a marca do painel.
    assert.equal(g(remoto, ["rev-parse", "main~1"]), antes);
    assert.match(arquivoNoGithub("src/App.tsx"), /Bem-vindo à Aurora/);
    const mensagem = g(remoto, ["log", "-1", "--format=%an|%B", "main"]);
    assert.match(mensagem, /^Claude \(Painel Sites Express\)\|Ajuste pelo Claude: Troque o título/);
    assert.match(mensagem, new RegExp(`Ajuste-Painel: ${edit.id}`));
    assert.match(mensagem, /Pedido por Ana/);

    // A área de aprovação republica pelo push: o painel passa a acompanhar.
    assert.deepEqual(acompanhadas.at(-1), [PROJETO, "3f1c2b9a-0000-4000-8000-0000000000aa"]);

    // A versão agora diz que a última alteração foi do Claude.
    const versao = await servico.versaoDaEdicao(PROJETO);
    assert.equal(versao.last.origin, "claude");
    assert.equal(versao.last.editId, edit.id);
  });

  it("o claude roda no clone, com o contrato da edição e sem os segredos do painel", () => {
    const chamada = chamadas().at(-1);
    assert.match(chamada.cwd.replace(/\\/g, "/"), /edicao-joinvix-sites--aurora-eng$/);
    const negadas = chamada.args.slice(chamada.args.indexOf("--disallowedTools") + 1);
    for (const regra of ["Bash(git *)", "Edit(./package.json)", "Edit(./.github/**)", "Bash(npm install *)"]) {
      assert.ok(negadas.includes(regra), `falta negar ${regra}`);
    }
    assert.ok(chamada.args.includes("Edit(./**)"));
    for (const segredo of [...Object.keys(SEGREDOS_DO_PAINEL), "GITHUB_TOKEN"]) {
      assert.ok(!chamada.variaveis.includes(segredo), `${segredo} chegou ao claude`);
    }
    // O banco do painel e o resto da pasta de dados não são legíveis.
    const deny = chamada.configuracoes.permissions.deny.join("\n");
    assert.match(deny, /painel\.json|Read\(\/\/.*dados/);
    assert.match(chamada.runbook, /Ajuste de um site institucional/);
    // O token nunca fica gravado no clone.
    const config = fs.readFileSync(path.join(chamada.cwd, ".git", "config"), "utf8");
    assert.ok(!config.includes(TOKEN));
  });

  it("o pedido seguinte leva a memória dos ajustes anteriores", async () => {
    const edit = await pedir("Agora deixe o rodapé com o nome completo", "edicao-nada");
    assert.equal(edit.status, "unchanged");
    assert.equal(edit.commit, null);
    const entrada = chamadas().at(-1).entrada;
    assert.match(entrada, /Ajustes anteriores neste site/);
    assert.match(entrada, /Troque o título da página inicial/);
    assert.match(entrada, /feita por você \(Claude\)/);
  });

  it("o Lovable edita no meio do ajuste: as alterações se juntam, sem reescrever o histórico", async () => {
    controle.pronto = path.join(raiz, "pronto-1");
    controle.sinal = path.join(raiz, "sinal-1");
    controle.cenario = "edicao";
    // Volta o título, para o cenário ter o que trocar.
    editarNoLovable("src/App.tsx", (t) => t.replace("Bem-vindo à Aurora", "Bem-vindo"), "Volta o título");
    const { edit: pedido } = await servico.pedirEdicao(PROJETO, { pedido: "Troque o título de novo" }, { quem: "Ana" });
    for (let i = 0; i < 400 && !fs.existsSync(controle.pronto); i++) await new Promise((ok) => setTimeout(ok, 50));
    editarNoLovable("src/Footer.tsx", (t) => t.replace("Aurora", "Aurora Engenharia"), "Rodapé com o nome completo");
    const doLovable = cabecaDoGithub();
    fs.writeFileSync(controle.sinal, "ok");
    const edit = await terminado(pedido.id);
    controle.pronto = "";
    controle.sinal = "";

    assert.equal(edit.status, "pushed", edit.error ?? "");
    // O commit do Lovable continua no histórico, logo abaixo do ajuste.
    assert.equal(g(remoto, ["rev-parse", "main~1"]), doLovable);
    assert.match(arquivoNoGithub("src/Footer.tsx"), /Aurora Engenharia/);
    assert.match(arquivoNoGithub("src/App.tsx"), /Bem-vindo à Aurora/);
  });

  it("o Lovable mexe na mesma linha no meio do ajuste: conflito, e nada é enviado", async () => {
    editarNoLovable("src/App.tsx", (t) => t.replace("Bem-vindo à Aurora", "Bem-vindo"), "Volta o título");
    controle.pronto = path.join(raiz, "pronto-2");
    controle.sinal = path.join(raiz, "sinal-2");
    controle.cenario = "edicao";
    const { edit: pedido } = await servico.pedirEdicao(PROJETO, { pedido: "Troque o título" }, { quem: "Ana" });
    for (let i = 0; i < 400 && !fs.existsSync(controle.pronto); i++) await new Promise((ok) => setTimeout(ok, 50));
    editarNoLovable("src/App.tsx", (t) => t.replace("Bem-vindo", "Olá, seja bem-vindo"), "Novo título no Lovable");
    const doLovable = cabecaDoGithub();
    fs.writeFileSync(controle.sinal, "ok");
    const edit = await terminado(pedido.id);
    controle.pronto = "";
    controle.sinal = "";

    assert.equal(edit.status, "conflict");
    assert.match(edit.error ?? "", /mudou no GitHub/);
    assert.equal(cabecaDoGithub(), doLovable);
  });

  it("build quebrado ou pacote fora do package.json: falha, e nada é enviado", async () => {
    const antes = cabecaDoGithub();
    const quebrado = await pedir("Algo que quebra o build", "edicao-quebra");
    assert.equal(quebrado.status, "failed");
    assert.match(quebrado.error ?? "", /build não passa/);
    assert.equal(cabecaDoGithub(), antes);

    const comImport = await pedir("Ponha confete na página", "edicao-import");
    assert.equal(comImport.status, "failed");
    assert.match(comImport.error ?? "", /pacote-que-nao-existe/);
    assert.equal(cabecaDoGithub(), antes);
  });

  it("a memória lista do mais recente para o mais antigo, com o log de cada ajuste", async () => {
    const aba = await servico.edicoes(PROJETO);
    assert.deepEqual(
      aba.edits.map((edit) => edit.status),
      ["failed", "failed", "conflict", "pushed", "unchanged", "pushed"],
    );
    const { lines } = await servico.logDaEdicao(PROJETO, aba.edits.at(-1).id);
    assert.ok(lines.some((linha) => linha.tipo === "resultado" || /Título/.test(linha.texto)));
    // Nada de caminho desta máquina nem de segredo no log.
    const texto = lines.map((linha) => linha.texto).join("\n");
    assert.ok(!texto.includes(raiz) && !texto.includes(raiz.replace(/\\/g, "/")));
    assert.ok(!texto.includes(TOKEN));
  });
});
