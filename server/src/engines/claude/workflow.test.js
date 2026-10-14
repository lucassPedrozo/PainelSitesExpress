import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { estadoDoPacote } from "./motor.js";
import { arquivosDoSite, conferirSaida, dependenciasDoTemplate } from "./publish.js";

/**
 * O site que o motor Claude gera, pelo caminho que ele faz depois de ir ao
 * GitHub: os scripts do workflow da área de aprovação (`server/workflows/
 * scripts`), rodados aqui sobre o que o painel enviaria — a configuração do
 * template do motor e um site de várias páginas com o rodapé da biblioteca.
 *
 * O que não dá para rodar sem rede é o `npm ci`: as dependências vêm por uma
 * junção para as do pacote do motor, que são as mesmas do lockfile do template
 * (o teste disso mora no pacote). O resto é o que o runner faz.
 *
 * Pulado onde o pacote do motor não está (ele vive num repositório privado)
 * ou onde não há bash.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dirMotor = path.resolve(aqui, "..", "..", "..", "..", "joinvixable");
const scripts = path.resolve(aqui, "..", "..", "..", "workflows", "scripts");
const pacote = estadoDoPacote(dirMotor);
const temBash = spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" }).status === 0;
const pular = !pacote.instalado ? `pacote do motor ausente: ${pacote.motivo}` : !temBash ? "sem bash nesta máquina" : false;

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-workflow-"));
after(() => {
  // A junção sai antes: apagar a pasta com ela dentro não pode alcançar as dependências do motor.
  for (const pasta of fs.readdirSync(raiz)) fs.rmSync(path.join(raiz, pasta, "node_modules"), { force: true });
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const escrever = (base, arquivos) => {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(base, caminho)), { recursive: true });
    fs.writeFileSync(path.join(base, caminho), conteudo);
  }
};

const rodar = (nome, cwd, env = {}) => {
  const saidaDoGitHub = path.join(cwd, "..", `github-output-${nome}.txt`);
  fs.writeFileSync(saidaDoGitHub, "");
  const r = spawnSync("bash", [path.join(scripts, nome)], {
    cwd,
    encoding: "utf8",
    // O MSYS do Git Bash no Windows converteria "/cliente/" num caminho.
    env: { ...process.env, MSYS_NO_PATHCONV: "1", GITHUB_OUTPUT: saidaDoGitHub, GITHUB_STEP_SUMMARY: "", ...env },
  });
  return { ...r, texto: `${r.stdout}${r.stderr}`, saidas: fs.readFileSync(saidaDoGitHub, "utf8") };
};

/** O site como o motor o deixa na pasta de trabalho: o template, mais o que a geração escreve. */
function criarProjeto() {
  const dirProjeto = path.join(raiz, "trabalho", "projects", "cliente-teste");
  fs.cpSync(path.join(dirMotor, "template"), dirProjeto, { recursive: true });
  // O rodapé é de cada site (a biblioteca do motor só tem mecânicas): este é o mínimo que um site entrega, com a
  // assinatura Joinvix dentro do <footer>, depois da linha legal.
  const rodape = { marca: "Conta Simples MEI", legal: "© 2026 Conta Simples MEI. Vitória, ES." };
  escrever(dirProjeto, {
    "src/sections/Rodape.tsx": [
      "import AssinaturaJoinvix from '../componentes/AssinaturaJoinvix'",
      "",
      "export default function Rodape({ data }: { data: { marca: string; legal: string } }) {",
      "  return (",
      '    <footer className="bg-escuro px-6 py-10 text-claro">',
      '      <p className="font-titulos text-p2">{data.marca}</p>',
      '      <p className="mt-2 text-pm">{data.legal}</p>',
      "      <AssinaturaJoinvix />",
      "    </footer>",
      "  )",
      "}",
      "",
    ].join("\n"),
    "src/App.tsx": [
      "import content from '../content.json'",
      "import { paginaAtual } from '@/lib/paginas'",
      "import Rodape from './sections/Rodape'",
      "",
      "export default function App() {",
      "  const pagina = paginaAtual()",
      "  return (",
      "    <>",
      '      <main id="inicio" className="mx-auto max-w-pagina px-6 py-secao">',
      '        <h1 className="font-titulos text-p4">{pagina === \'servicos\' ? content.servicos.titulo : content.site.titulo}</h1>',
      '        <a href={pagina === \'servicos\' ? \'index.html\' : \'servicos.html\'}>{content.site.outra}</a>',
      '        <div id="sobre" /><div id="servicos" /><div id="contato" />',
      "      </main>",
      "      <Rodape data={content.rodape} />",
      "    </>",
      "  )",
      "}",
      "",
    ].join("\n"),
    "content.json": JSON.stringify({
      site: { titulo: "Conta Simples MEI", descricao: "Contabilidade para MEI em Vitória.", idioma: "pt-BR", outra: "Ver a outra página" },
      paginas: [
        { slug: "inicio", titulo: "Conta Simples MEI", descricao: "Contabilidade para MEI em Vitória." },
        { slug: "servicos", titulo: "Serviços | Conta Simples MEI", descricao: "Abertura, declaração anual e regularização do MEI." },
      ],
      servicos: { titulo: "Serviços para o MEI" },
      rodape,
    }),
    "imagens.json": "[]",
    // O que a geração deixa na pasta e nunca vai ao GitHub.
    "briefing.json": '{"contato":{"whatsapp":"5527999990000"}}',
    "design-brief.json": "{}",
    ".session/session.json": "{}",
  });
  return dirProjeto;
}

/** O checkout do runner: só o que o painel enviaria, com as dependências do motor no lugar do `npm ci`. */
async function checkout(nome, dirProjeto) {
  const dirTemplate = path.join(dirMotor, "template");
  const { files } = await arquivosDoSite({ dirTemplate, dirProjeto });
  assert.deepEqual(await conferirSaida(files, { declaradas: await dependenciasDoTemplate(dirTemplate) }), []);
  const repo = path.join(raiz, nome, "repo");
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file.path)), { recursive: true });
    fs.copyFileSync(file.absolute, path.join(repo, file.path));
  }
  fs.symlinkSync(path.join(dirMotor, "node_modules"), path.join(raiz, nome, "node_modules"), "junction");
  return { repo, files: files.map((file) => file.path) };
}

/** `npm run build`, sem o npm: o script do package.json do checkout, com o vite do motor. */
function construir(repo) {
  const build = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).scripts.build;
  assert.match(build, /^vite build( --base=\/[a-z0-9-]+\/)?$/);
  const r = spawnSync(process.execPath, [path.join(dirMotor, "node_modules", "vite", "bin", "vite.js"), ...build.split(" ").slice(1), "--logLevel", "error"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
}

describe("site do motor Claude pelos scripts do workflow", { skip: pular }, () => {
  it("área de aprovação: o site de várias páginas responde na pasta do cliente, com a assinatura e fora dos buscadores", { timeout: 300_000 }, async () => {
    const { repo, files } = await checkout("area", criarProjeto());
    for (const esperado of ["package.json", "package-lock.json", "vite.config.ts", "index.html", "src/main.tsx", "src/componentes/AssinaturaJoinvix.tsx", "public/joinvix/assinatura-para-fundo-escuro.png", "content.json"]) {
      assert.ok(files.includes(esperado), `${esperado} vai ao repositório`);
    }
    for (const fora of ["briefing.json", "design-brief.json", ".session/session.json"]) assert.ok(!files.includes(fora), `${fora} não vai`);

    // 1. A base da área: o script reescreve o build e não acha nada para corrigir no código.
    const preparo = rodar("prepare-dev-area.sh", repo, { BASE_PATH: "/cliente-teste/" });
    assert.equal(preparo.status, 0, preparo.texto);
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).scripts.build, "vite build --base=/cliente-teste/");
    assert.doesNotMatch(preparo.texto, /::(warning|error)::/);

    // 2. O build, como o runner o roda.
    assert.match(rodar("ensure-static-build.sh", repo).texto, /nada a converter/);
    construir(repo);

    // 3. A pasta publicada e o fallback de rotas.
    const saida = rodar("resolve-build-output.sh", repo, { BASE_PATH: "/cliente-teste/" });
    assert.equal(saida.status, 0, saida.texto);
    assert.match(saida.saidas, /^dist-dir=dist$/m);
    assert.match(saida.saidas, /^server-bundle=$/m);
    const dist = path.join(repo, "dist");
    assert.ok(fs.readFileSync(path.join(dist, ".htaccess"), "utf8").includes("RewriteBase /cliente-teste/\n"));

    // 4. A assinatura já está no site: o passo não insere a faixa nem baixa nada.
    const assinatura = rodar("ensure-joinvix-signature.sh", repo, { DIST_DIR: "dist", JOINVIX_SIGNATURE_LOGO_URL: "http://127.0.0.1:9/nao-deveria-ser-usada.png" });
    assert.equal(assinatura.status, 0, assinatura.texto);
    assert.match(assinatura.texto, /Assinatura Joinvix presente no site\./);
    assert.equal(fs.existsSync(path.join(dist, "joinvix-assinatura.png")), false, "a faixa de reserva não foi necessária");
    assert.ok(fs.existsSync(path.join(dist, "joinvix", "assinatura-para-fundo-escuro.png")) && fs.existsSync(path.join(dist, "joinvix", "assinatura-para-fundo-claro.png")));

    // 5. O acabamento da área: noindex e o commit publicado, em todas as páginas.
    const acabamento = rodar("finalize-dev-area.sh", repo, { BASE_PATH: "/cliente-teste/", DIST_DIR: "dist", GITHUB_SHA: "abc123" });
    assert.equal(acabamento.status, 0, acabamento.texto);
    assert.match(acabamento.texto, /Paginas preparadas: 3 de 3/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist, "joinvix-build.json"), "utf8")).sha, "abc123");

    const inicio = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    const servicos = fs.readFileSync(path.join(dist, "servicos.html"), "utf8");
    for (const [nome, html] of [["index.html", inicio], ["servicos.html", servicos]]) {
      assert.match(html, /<meta name="robots" content="noindex, nofollow">/, `${nome} fica fora dos buscadores`);
      assert.match(html, /(src|href)="\/cliente-teste\/assets\/[^"]+"/, `${nome} carrega os arquivos da pasta do cliente`);
      assert.doesNotMatch(html, /src="\/?src\/main\.tsx"/, `${nome} não aponta para o código-fonte`);
      assert.doesNotMatch(html, /__TITULO__|__DESCRICAO__/);
    }
    assert.match(inicio, /<title>Conta Simples MEI<\/title>/);
    assert.match(servicos, /<title>Serviços \| Conta Simples MEI<\/title>/);
    assert.match(servicos, /<meta name="description" content="Abertura, declaração anual e regularização do MEI\."/);
    // Os links entre páginas são relativos: valem na pasta do cliente sem reescrita.
    const bundle = fs.readdirSync(path.join(dist, "assets")).filter((nome) => nome.endsWith(".js")).map((nome) => fs.readFileSync(path.join(dist, "assets", nome), "utf8")).join("\n");
    assert.ok(bundle.includes("servicos.html") && bundle.includes("joinvix/assinatura-para-fundo-escuro.png") && /joinvix\.com\.br/.test(bundle));
  });

  it("domínio do cliente: o mesmo repositório, sem base, sai com caminhos relativos", { timeout: 300_000 }, async () => {
    const { repo } = await checkout("dominio", criarProjeto());
    construir(repo);
    const saida = rodar("resolve-build-output.sh", repo);
    assert.equal(saida.status, 0, saida.texto);
    const inicio = fs.readFileSync(path.join(repo, "dist", "index.html"), "utf8");
    assert.match(inicio, /(src|href)="\.\/assets\/[^"]+"/, "o mesmo dist abre na raiz do domínio ou numa subpasta");
    assert.ok(fs.existsSync(path.join(repo, "dist", "servicos.html")));
    assert.match(rodar("ensure-joinvix-signature.sh", repo, { DIST_DIR: "dist" }).texto, /Assinatura Joinvix presente no site\./);
  });
});
