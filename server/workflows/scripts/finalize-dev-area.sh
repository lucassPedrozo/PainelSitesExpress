# Acabamento do build da area de desenvolvimento, depois do build e antes do
# envio:
#
# - `noindex` em toda pagina e no cabecalho HTTP: e o site do cliente antes da
#   aprovacao, e nao pode aparecer no Google no lugar do dominio dele;
# - um script que poe a pasta na frente dos links escritos como "/#contato"
#   ou "/" em <a href>. Reescrever o codigo-fonte nao serve: o mesmo texto
#   pode ir para um <Link to>, que ja recebe a base do roteador. No navegador
#   so os <a> de verdade sao tocados, e os que o roteador ja montou com a
#   pasta ficam como estao;
# - `joinvix-build.json` com o commit publicado. O painel le este arquivo
#   para confirmar que a pasta tem a versao que acabou de ser construida, e
#   nao so que ela abre.
set -euo pipefail

dist_dir="${DIST_DIR:-dist}"

if ! printf '%s' "${BASE_PATH:-}" | grep -Eq '^/([a-z0-9-]+/)+$'; then
  printf '::error::BASE_PATH invalido: "%s" (esperado /pasta/).\n' "${BASE_PATH:-}"
  exit 1
fi

if [ ! -d "$dist_dir" ]; then
  printf '::error::Pasta de build nao encontrada: %s\n' "$dist_dir"
  exit 1
fi

DIST_DIR="$dist_dir" node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const dist = process.env.DIST_DIR;
const base = process.env.BASE_PATH;

const corrigeLinks = `(function(){var b=${JSON.stringify(base)};function f(a){var h=a.getAttribute("href");if(!h||h.charAt(0)!=="/"||h.charAt(1)==="/"||h.indexOf(b)===0||h+"/"===b)return;a.setAttribute("href",b+h.slice(1))}function t(n){if(n.nodeType!==1)return;if(n.tagName==="A")f(n);if(n.querySelectorAll)n.querySelectorAll("a[href^='/']").forEach(f)}new MutationObserver(function(l){l.forEach(function(m){if(m.type==="attributes")t(m.target);else m.addedNodes.forEach(t)})}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["href"]});document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a)f(a)},true)})();`;
const cabeca = `<meta name="robots" content="noindex, nofollow"><script data-joinvix-area-dev>${corrigeLinks}</script>`;

const paginas = [];
const percorrer = (pasta) => {
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const arquivo = path.join(pasta, item.name);
    if (item.isDirectory()) percorrer(arquivo);
    else if (item.name.endsWith(".html")) paginas.push(arquivo);
  }
};
percorrer(dist);

let injetadas = 0;
for (const pagina of paginas) {
  const html = fs.readFileSync(pagina, "utf8");
  if (html.includes("data-joinvix-area-dev")) continue;
  // Logo depois da abertura do <head>: o script precisa estar de pe antes de
  // o <body> ser lido, para pegar os links da pagina pre-renderizada.
  const comCabeca = html.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}${cabeca}`);
  if (comCabeca === html) continue;
  fs.writeFileSync(pagina, comCabeca);
  injetadas += 1;
}

if (injetadas === 0) {
  console.log("::error::Nenhuma pagina com <head> no build; a area de desenvolvimento nao foi preparada.");
  process.exit(1);
}

fs.writeFileSync(
  path.join(dist, "joinvix-build.json"),
  `${JSON.stringify({ sha: process.env.GITHUB_SHA ?? null, base, builtAt: new Date().toISOString() })}\n`,
);

const htaccess = path.join(dist, ".htaccess");
const cabecalho = [
  "",
  "# Area de desenvolvimento: fora dos buscadores.",
  "<IfModule mod_headers.c>",
  '  Header set X-Robots-Tag "noindex, nofollow"',
  "</IfModule>",
  "",
].join("\n");
fs.appendFileSync(htaccess, cabecalho);

console.log(`Paginas preparadas: ${injetadas} de ${paginas.length}`);
NODE
