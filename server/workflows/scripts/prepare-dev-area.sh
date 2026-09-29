# Adapta o checkout para o site responder numa pasta da area de
# desenvolvimento ("/zezinho/") em vez da raiz do dominio. Roda so no runner:
# nada e commitado, e o codigo que vai para o dominio do cliente continua o
# mesmo.
#
# 1. `vite build` ganha `--base=/zezinho/` em todo script do package.json. O
#    `--base` no fim do `npm run build` nao serve: os builds do Lovable
#    costumam ser `vite build && node scripts/flatten-dist.mjs`, e o argumento
#    iria para o script de pos-build.
# 2. `<BrowserRouter>` ganha `basename` — sem ele o React Router nao reconhece
#    a pasta e mostra a pagina 404 do proprio site. O TanStack Start le a base
#    do Vite sozinho.
# 3. Caminhos literais para arquivos de `public/` ("/videos/v1.mp4",
#    "/favicon.png") ganham a pasta na frente: o Vite so reescreve os que
#    passam por ele (imports, CSS e o index.html).
#
# Site estatico (sem package.json, com index.html na raiz — feito fora do
# Lovable): nao ha build. Os caminhos absolutos nos .html, .css e .js
# ("/css/site.css", "/img/logo.png", href="/") ganham a pasta na frente.
set -euo pipefail

if ! printf '%s' "${BASE_PATH:-}" | grep -Eq '^/([a-z0-9-]+/)+$'; then
  printf '::error::BASE_PATH invalido: "%s" (esperado /pasta/).\n' "${BASE_PATH:-}"
  exit 1
fi

node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_PATH;
const baseSemBarra = base.slice(0, -1);

// 0) Site estatico: sem build, os arquivos vao como estao — so os caminhos
// absolutos precisam da pasta.
const pkgPath = "package.json";
if (!fs.existsSync(pkgPath)) {
  if (!fs.existsSync("index.html")) {
    console.log("::error::Sem package.json e sem index.html na raiz: nao ha site para publicar.");
    process.exit(1);
  }
  const ignorar = new Set([".git", ".github", "node_modules"]);
  // Atributos que carregam endereco e url(...) do CSS; "//cdn..." fica como
  // esta (outro dominio), e o que ja tem a pasta tambem.
  const atributo = /(\b(?:href|src|action|poster|data-src|content)\s*=\s*["'])\/(?!\/)/g;
  const cssUrl = /(url\(\s*["']?)\/(?!\/)/g;
  const jaTemBase = (texto, indice) => texto.startsWith(base.slice(1), indice);
  const trocados = [];
  const percorrerEstatico = (pasta) => {
    for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
      if (ignorar.has(item.name)) continue;
      const arquivo = path.join(pasta, item.name);
      if (item.isDirectory()) {
        percorrerEstatico(arquivo);
        continue;
      }
      if (!/\.(html?|css|js)$/i.test(item.name)) continue;
      const original = fs.readFileSync(arquivo, "utf8");
      const texto = original
        .replace(atributo, (achado, antes, deslocamento, todo) =>
          jaTemBase(todo, deslocamento + achado.length) ? achado : `${antes}${base}`)
        .replace(cssUrl, (achado, antes, deslocamento, todo) =>
          jaTemBase(todo, deslocamento + achado.length) ? achado : `${antes}${base}`);
      if (texto !== original) {
        fs.writeFileSync(arquivo, texto);
        trocados.push(arquivo);
      }
    }
  };
  percorrerEstatico(".");
  console.log(`Site estatico (sem package.json): publicado sem build na base ${base}.`);
  console.log(`Arquivos adaptados: ${trocados.length ? trocados.join(", ") : "nenhum"}`);
  process.exit(0);
}

// 1) package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const scripts = pkg.scripts ?? {};
let comBase = 0;
for (const [nome, comando] of Object.entries(scripts)) {
  if (typeof comando !== "string" || !/\bvite build\b/.test(comando)) continue;
  if (/--base[= ]/.test(comando)) {
    console.log(`::error::O script "${nome}" ja define --base; a area de desenvolvimento precisa controlar a base.`);
    process.exit(1);
  }
  scripts[nome] = comando.replace(/\bvite build\b/g, `vite build --base=${base}`);
  comBase += 1;
  console.log(`package.json: "${nome}" -> ${scripts[nome]}`);
}
if (comBase === 0) {
  console.log("::error::Nenhum script do package.json roda `vite build`. A area de desenvolvimento so sabe publicar sites Vite em subpasta.");
  process.exit(1);
}
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// 2 e 3) codigo-fonte
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const publicos = fs.existsSync("public")
  ? fs.readdirSync("public").filter((nome) => !nome.startsWith("."))
  : [];
// Aspas, crase ou parentese antes; barra, aspas, crase, ?, # ou ) depois —
// assim "/og.png" casa e "/og.png-velho" nao.
const caminhoPublico = publicos.length
  ? new RegExp(`(["'\`(])/(${publicos.map(escapar).join("|")})(?=[/"'\`?#)])`, "g")
  : null;

const alterados = [];
const avisos = new Set();
const percorrer = (pasta) => {
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const arquivo = path.join(pasta, item.name);
    if (item.isDirectory()) {
      percorrer(arquivo);
      continue;
    }
    if (!/\.(tsx?|jsx?|mts|mjs|css)$/.test(item.name)) continue;

    const original = fs.readFileSync(arquivo, "utf8");
    let texto = original.replace(
      /<BrowserRouter(?![^>]*\bbasename\b)/g,
      `<BrowserRouter basename="${baseSemBarra}"`,
    );
    if (caminhoPublico) texto = texto.replace(caminhoPublico, `$1${base}$2`);

    if (/\bcreate(Browser|Hash)Router\(/.test(texto) && !/\bbasename\b/.test(texto)) {
      avisos.add(`${arquivo}: createBrowserRouter sem basename — as rotas podem nao abrir na pasta.`);
    }
    if (texto !== original) {
      fs.writeFileSync(arquivo, texto);
      alterados.push(arquivo);
    }
  }
};
if (fs.existsSync("src")) percorrer("src");

console.log(`Base da area de desenvolvimento: ${base}`);
console.log(`Arquivos adaptados: ${alterados.length ? alterados.join(", ") : "nenhum"}`);
for (const aviso of avisos) console.log(`::warning::${aviso}`);
NODE
