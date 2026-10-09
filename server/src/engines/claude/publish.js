import fs from "node:fs/promises";
import path from "node:path";
import { CREDENTIAL_FORMATS } from "../../../../shared/secret-formats.js";

/**
 * O site que o Claude gerou, a caminho do GitHub.
 *
 * O repositório precisa instalar e construir sozinho, no GitHub Actions, sem
 * o pacote do motor por perto. E o que o modelo escreveu não é confiável: ele
 * não escolhe dependência, script de build nem configuração.
 *
 * Por isso o envio tem duas origens:
 *
 * - **do template** do motor (confiável): tudo o que está na raiz dele —
 *   `package.json`, lockfile, `vite.config`, `tsconfig`, `tailwind.config`,
 *   `postcss.config`, `index.html` —, menos o `content.json` de exemplo;
 * - **do projeto** (escrito pelo modelo): `src/`, `public/`, `content.json` e
 *   `imagens.json`.
 *
 * Ficam de fora o briefing, a direção criativa, a sessão das etapas e o
 * `dist` — o material do cliente e o histórico do trabalho não vão ao GitHub.
 *
 * Antes de qualquer arquivo sair, duas conferências que bloqueiam o envio: o
 * site não pode importar pacote que o template não declara (construiria aqui,
 * com as dependências do motor, e quebraria no GitHub), e nenhum arquivo dele
 * pode carregar uma credencial deste painel.
 */

/** Do projeto vai só isto. */
const PASTAS_DO_PROJETO = ["src", "public"];
const ARQUIVOS_DO_PROJETO = ["content.json", "imagens.json"];
/** Da raiz do template, isto fica: é o conteúdo de exemplo. */
const SO_DO_PROJETO = new Set(ARQUIVOS_DO_PROJETO);

export const LIMITES_DO_SITE = Object.freeze({
  maxArquivos: 3000,
  maxBytesPorArquivo: 50 * 1024 * 1024,
  maxBytesTotal: 500 * 1024 * 1024,
  /** Acima disto um arquivo não é lido atrás de texto: é imagem, fonte, vídeo. */
  maxBytesDeTexto: 2 * 1024 * 1024,
});

const megas = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Erro com a mensagem escrita para a pessoa: o envio foi bloqueado, e por quê. */
export class EnvioBloqueado extends Error {
  /** @param {string} mensagem */
  constructor(mensagem) {
    super(mensagem);
    this.status = 422;
    this.expose = true;
  }
}

/**
 * @typedef {{ path: string, absolute: string, size: number, origem: "template" | "projeto" }} ArquivoDoSite
 */

/** Os arquivos de uma pasta, com o caminho relativo a ela. Atalhos e junções não são seguidos. */
async function percorrer(raiz, prefixo, origem, saida) {
  let itens;
  try {
    itens = await fs.readdir(raiz, { withFileTypes: true });
  } catch (/** @type {any} */ erro) {
    if (erro?.code === "ENOENT") return;
    throw erro;
  }
  for (const item of itens) {
    const absoluto = path.join(raiz, item.name);
    const relativo = prefixo ? `${prefixo}/${item.name}` : item.name;
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) await percorrer(absoluto, relativo, origem, saida);
    else if (item.isFile()) saida.push({ path: relativo, absolute: absoluto, size: (await fs.stat(absoluto)).size, origem });
  }
}

/**
 * A lista do que vai ao repositório, na ordem dos caminhos.
 *
 * @param {{ dirTemplate: string, dirProjeto: string }} params
 * @returns {Promise<{ files: ArquivoDoSite[], totalBytes: number, desatualizados: string[] }>}
 *   `desatualizados`: arquivos de configuração que no projeto são de uma
 *   versão anterior do template — vão os atuais, e a tela avisa.
 */
export async function arquivosDoSite({ dirTemplate, dirProjeto }) {
  /** @type {ArquivoDoSite[]} */
  const files = [];
  /** @type {string[]} */
  const desatualizados = [];

  const raizDoTemplate = await fs.readdir(dirTemplate, { withFileTypes: true });
  for (const item of raizDoTemplate) {
    if (!item.isFile() || SO_DO_PROJETO.has(item.name)) continue;
    const absoluto = path.join(dirTemplate, item.name);
    files.push({ path: item.name, absolute: absoluto, size: (await fs.stat(absoluto)).size, origem: "template" });
    const doProjeto = await fs.readFile(path.join(dirProjeto, item.name)).catch(() => null);
    if (doProjeto && !doProjeto.equals(await fs.readFile(absoluto))) desatualizados.push(item.name);
  }

  for (const pasta of PASTAS_DO_PROJETO) {
    await percorrer(path.join(dirProjeto, pasta), pasta, "projeto", files);
  }
  for (const nome of ARQUIVOS_DO_PROJETO) {
    const absoluto = path.join(dirProjeto, nome);
    const info = await fs.lstat(absoluto).catch(() => null);
    if (info?.isFile()) files.push({ path: nome, absolute: absoluto, size: info.size, origem: "projeto" });
  }

  if (!files.some((file) => file.path === "package.json") || !files.some((file) => file.path === "src/main.tsx")) {
    throw new EnvioBloqueado("O site não tem os arquivos de um projeto do motor (package.json e src/main.tsx). Nada foi enviado.");
  }
  if (!files.some((file) => file.path === "content.json")) {
    throw new EnvioBloqueado("O site não tem content.json: a geração não terminou. Nada foi enviado.");
  }
  if (files.length > LIMITES_DO_SITE.maxArquivos) {
    throw new EnvioBloqueado(`O site tem ${files.length} arquivos — o limite do envio é ${LIMITES_DO_SITE.maxArquivos}.`);
  }
  const grande = files.find((file) => file.size > LIMITES_DO_SITE.maxBytesPorArquivo);
  if (grande) {
    throw new EnvioBloqueado(`"${grande.path}" tem ${megas(grande.size)} — o limite por arquivo é ${megas(LIMITES_DO_SITE.maxBytesPorArquivo)}.`);
  }
  const totalBytes = files.reduce((soma, file) => soma + file.size, 0);
  if (totalBytes > LIMITES_DO_SITE.maxBytesTotal) {
    throw new EnvioBloqueado(`O site soma ${megas(totalBytes)} — o limite do envio é ${megas(LIMITES_DO_SITE.maxBytesTotal)}.`);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, totalBytes, desatualizados };
}

/**
 * O pacote de um `import`: "lucide-react" de `lucide-react/icons`,
 * "@radix-ui/react-slot" inteiro, `null` para caminho relativo, alias `@/` e
 * módulo do Node.
 *
 * @param {string} alvo
 */
export function pacoteDoImport(alvo) {
  if (!alvo || alvo.startsWith(".") || alvo.startsWith("/") || alvo.startsWith("@/") || alvo.startsWith("node:")) return null;
  // Arquivo com extensão de recurso, importado pelo alias do Vite (`~`, `#`) ou por URL.
  if (/^[a-z]+:/i.test(alvo) || /^[~#]/.test(alvo)) return null;
  return alvo.startsWith("@") ? alvo.split("/").slice(0, 2).join("/") : alvo.split("/")[0];
}

// `from "x"`, `import "x"`, `import("x")` e `require("x")`; no CSS, `@import "x"`.
const IMPORTS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const IMPORT_DE_CSS = /@import\s+(?:url\(\s*)?["']([^"']+)["']/g;

/**
 * Os pacotes que um arquivo de código importa.
 * @param {string} texto
 * @param {string} caminho
 * @returns {string[]}
 */
export function pacotesImportados(texto, caminho) {
  const achados = new Set();
  const padroes = /\.css$/i.test(caminho) ? [IMPORT_DE_CSS] : IMPORTS;
  for (const padrao of padroes) {
    for (const m of texto.matchAll(padrao)) {
      const pacote = pacoteDoImport(m[1]);
      if (pacote) achados.add(pacote);
    }
  }
  return [...achados];
}

const EH_CODIGO = /\.(tsx?|jsx?|mts|mjs|cjs|css)$/i;
/** O que pode carregar texto: código, dados, marcação. Imagem e fonte não são lidas. */
const EH_TEXTO = /\.(tsx?|jsx?|mts|mjs|cjs|css|json|html?|svg|md|txt|xml|webmanifest|map|ya?ml)$/i;

/**
 * As duas conferências que bloqueiam o envio. Lê só o que veio do projeto —
 * o template é do motor.
 *
 * @param {ArquivoDoSite[]} files
 * @param {{ declaradas: string[], segredos?: Array<[rotulo: string, valor: string]> }} contexto
 *   `declaradas`: as dependências do `package.json` do template.
 *   `segredos`: cada segredo deste painel, com o nome dele — o valor nunca
 *   aparece na mensagem.
 * @returns {Promise<string[]>} os motivos do bloqueio; vazio quando pode ir
 */
export async function conferirSaida(files, { declaradas, segredos = [] }) {
  const conhecidas = new Set(declaradas);
  /** @type {Map<string, string>} pacote → o primeiro arquivo que o importa */
  const fora = new Map();
  /** @type {string[]} */
  const vazamentos = [];
  const valores = segredos.filter(([, valor]) => typeof valor === "string" && valor.length >= 8);

  for (const file of files) {
    if (file.origem !== "projeto" || !EH_TEXTO.test(file.path) || file.size > LIMITES_DO_SITE.maxBytesDeTexto) continue;
    const texto = await fs.readFile(file.absolute, "utf8");

    if (EH_CODIGO.test(file.path)) {
      for (const pacote of pacotesImportados(texto, file.path)) {
        if (!conhecidas.has(pacote) && !fora.has(pacote)) fora.set(pacote, file.path);
      }
    }

    for (const [rotulo, valor] of valores) {
      if (texto.includes(valor)) vazamentos.push(`${file.path} contém o valor de ${rotulo}`);
    }
    for (const [formato, nome] of CREDENTIAL_FORMATS) {
      // `search` ignora o `lastIndex` de uma expressão global.
      if (texto.search(formato) >= 0) vazamentos.push(`${file.path} contém algo com formato de ${nome}`);
    }
  }

  /** @type {string[]} */
  const motivos = [];
  if (fora.size) {
    motivos.push(
      `O site importa ${fora.size === 1 ? "um pacote que o template não tem" : "pacotes que o template não tem"}: ` +
        `${[...fora].map(([pacote, onde]) => `${pacote} (em ${onde})`).join(", ")}. ` +
        "Ele construiu aqui com as dependências do motor, mas quebraria no GitHub. Peça um ajuste para tirar o import.",
    );
  }
  if (vazamentos.length) {
    motivos.push(
      `Há credencial dentro do site: ${[...new Set(vazamentos)].slice(0, 8).join("; ")}. ` +
        "Nada foi enviado. Troque a credencial e peça um ajuste para tirá-la do código.",
    );
  }
  return motivos;
}

/**
 * As dependências que o `package.json` do template declara.
 * @param {string} dirTemplate
 * @returns {Promise<string[]>}
 */
export async function dependenciasDoTemplate(dirTemplate) {
  const pacote = JSON.parse(await fs.readFile(path.join(dirTemplate, "package.json"), "utf8"));
  return Object.keys({ ...(pacote.dependencies ?? {}), ...(pacote.devDependencies ?? {}) });
}
