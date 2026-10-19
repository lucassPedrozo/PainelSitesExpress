#!/usr/bin/env node
/**
 * Varredura de segredos antes de publicar.
 *
 *   node scripts/verificar-segredos.mjs [ref]      tudo o que um push de <ref> enviaria,
 *                                                  histórico incluído (padrão: HEAD)
 *   node scripts/verificar-segredos.mjs --arvore   o que entraria no próximo commit
 *                                                  (versionados + não ignorados)
 *
 * Três conferências:
 *   1. valores reais — cada segredo que existe nesta máquina (.env, chave da
 *      service account, server/data/) procurado literalmente em cada arquivo;
 *   2. arquivos proibidos — .env, chaves, banco local, logs, executáveis;
 *   3. formatos de credencial — tokens do GitHub, chaves de API, PEM, JWT,
 *      senha embutida em URL.
 *
 * Nunca imprime um valor secreto: só o nome da chave e o arquivo onde apareceu.
 * Sai com 0 quando está limpo, 1 quando acha algo e 2 em erro de execução.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { CREDENTIAL_FORMATS } from "../shared/secret-formats.js";

const RAIZ = resolve(import.meta.dirname, "..");

// Chaves do .env que são configuração, não segredo. Todo o resto é tratado como
// sensível — inclusive domínios e hosts, que dizem onde está a infraestrutura.
const CHAVES_PUBLICAS = new Set([
  "PORT", "CACHE_TTL_MS", "SERVER_HOST", "GITHUB_ORG", "GOOGLE_CREDENTIALS_PATH",
  "LOVABLE_ENABLE_GENERATION", "LOVABLE_MAX_ATTACHMENTS", "LOVABLE_MAX_ATTACHMENT_BYTES",
  "PREVIEW_WATCH_INTERVAL_MS", "DEV_AREA_WATCH_INTERVAL_MS", "DEV_AREA_FTP_DIR",
  "DEV_AREA_FTP_PROTOCOL", "DEV_AREA_FTP_PORT", "GENERATION_ENGINE",
  "GEMINI_MODEL", "PANEL_DATA_DIR",
  // As escolhas do motor Claude são palavras comuns ("medium", "autoral",
  // "expressivo"): procuradas como segredo, apareceriam em metade do código.
  "CLAUDE_ENABLE_GENERATION", "CLAUDE_HUMAN_APPROVAL", "CLAUDE_MODEL", "CLAUDE_REASONING_EFFORT",
  "CLAUDE_REVIEW_ROUNDS", "CLAUDE_ART_DIRECTION", "CLAUDE_MOTION",
]);

// Nos JSON locais, só os campos cujo caminho indica credencial. `redirect_uri` e
// afins são endereços públicos por natureza.
const CAMPO_SENSIVEL = /(token|secret|key|hash|salt|password|senha|sess|refresh|access|private|code|client_id)/i;
const CAMPO_PUBLICO = /(uri|url|expires|type|scope)$/i;

/** @type {Array<[RegExp, string]>} */
const ARQUIVOS_PROIBIDOS = [
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, "arquivo .env"],
  [/(^|\/)g-suite-[^/]*\.json$|service-account[^/]*\.json$/i, "chave de service account"],
  [/(^|\/)server\/data\//, "banco local do painel"],
  // Prompts, seções e template do motor Claude são conhecimento interno: o
  // pacote vive num repositório privado e nunca entra neste.
  [/(^|\/)joinvixable\//, "pacote do motor Claude (repositório privado)"],
  [/(^|\/)(lovable-auth|sessions)\.json$/, "credenciais do painel"],
  [/\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)$/i, "chave privada"],
  [/\.log(\.\d+)?$/, "log de execução"],
  [/\.exe$/i, "executável compilado"],
];

// Os formatos de credencial moram em `shared/`: a mesma lista confere o site
// que o motor Claude gera, antes de ele ir ao GitHub.
const FORMATOS = CREDENTIAL_FORMATS;

function git(args, input) {
  const r = spawnSync("git", args, { cwd: RAIZ, input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

function lerEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const valores = {};
  for (const linha of readFileSync(caminho, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) valores[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return valores;
}

/**
 * Os dados do motor Claude ficam na mesma pasta de dados, mas não guardam
 * credencial do painel: são o material e os sites dos clientes, milhares de
 * JSON de sessão, e uma junção `node_modules` que leva às dependências do
 * motor. Ler tudo isso atrás de "segredos" só rendia falso positivo — o
 * `keywords` de um pacote qualquer — e minutos de varredura.
 */
const FORA_DA_BUSCA = new Set(["joinvixable", "node_modules"]);

/**
 * Os arquivos que alguém enviou a um projeto criado no painel
 * (`projetos/<id>/`) — um site inteiro, às vezes. Nos bancos do painel o nome
 * do arquivo já diz que tudo ali é sensível (`sessions.json`,
 * `lovable-auth.json`). Num arquivo enviado ele não diz nada: o
 * `session.json` de um site é a sessão de trabalho dele, com o id do modelo
 * que o gerou, e não o banco de sessões do painel. Lá quem decide se um valor
 * é sensível é o nome do campo.
 */
const PASTA_DOS_ENVIADOS = "projetos";

function jsonsEm(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).flatMap((nome) => {
    if (FORA_DA_BUSCA.has(nome)) return [];
    const caminho = join(pasta, nome);
    // `lstat`: uma junção ou um link não é seguido para fora da pasta de dados.
    const info = lstatSync(caminho);
    if (info.isSymbolicLink()) return [];
    if (info.isDirectory()) return jsonsEm(caminho);
    return nome.endsWith(".json") ? [caminho] : [];
  });
}

/**
 * Onde moram os segredos desta máquina: esta pasta ou, num worktree do git (que
 * não tem `.env` próprio), a pasta principal do repositório. Sem isso, um push
 * feito de um worktree só conferia formatos.
 */
function raizDosSegredos() {
  if (existsSync(join(RAIZ, ".env"))) return RAIZ;
  try {
    const comum = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).toString().trim();
    const principal = resolve(comum, "..");
    if (existsSync(join(principal, ".env"))) return principal;
  } catch {
    // Sem git ou fora de um repositório: fica a pasta do script.
  }
  return RAIZ;
}

/** Cada segredo desta máquina, como { rótulo → valor }. */
function segredosConhecidos(base) {
  const segredos = new Map();
  const env = lerEnv(join(base, ".env"));
  for (const [chave, valor] of Object.entries(env)) {
    if (CHAVES_PUBLICAS.has(chave) || valor.length < 6 || /^\d+$/.test(valor)) continue;
    segredos.set(`.env:${chave}`, valor);
  }

  const chaves = readdirSync(base)
    .filter((n) => /^g-suite-.*\.json$|service-account.*\.json$/i.test(n))
    .map((n) => join(base, n));
  if (env.GOOGLE_CREDENTIALS_PATH) chaves.push(resolve(base, env.GOOGLE_CREDENTIALS_PATH));
  const dados = resolve(base, env.PANEL_DATA_DIR || "server/data");

  /**
   * @param {unknown} valor
   * @param {string} caminho o rótulo que aparece no achado: arquivo e campo
   * @param {string} campos só o caminho dos campos, sem o nome do arquivo
   * @param {boolean} peloArquivo o nome do arquivo também conta
   */
  const visitar = (valor, caminho, campos, peloArquivo) => {
    if (Array.isArray(valor)) valor.forEach((v, i) => visitar(v, `${caminho}[${i}]`, `${campos}[${i}]`, peloArquivo));
    else if (valor && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor)) visitar(v, `${caminho}.${k}`, `${campos}.${k}`, peloArquivo);
    } else if (typeof valor === "string" && valor.length >= 16) {
      const campo = caminho.split(".").pop();
      if (CAMPO_SENSIVEL.test(peloArquivo ? caminho : campos) && !CAMPO_PUBLICO.test(campo)) segredos.set(caminho, valor);
    }
  };
  const enviados = join(dados, PASTA_DOS_ENVIADOS) + sep;
  for (const arquivo of new Set([...chaves, ...jsonsEm(dados)])) {
    if (!existsSync(arquivo)) continue;
    const enviado = arquivo.startsWith(enviados);
    // Dois sites enviados têm arquivos de mesmo nome: o rótulo leva o caminho
    // inteiro, para o valor de um não tomar o lugar do valor do outro.
    const rotulo = enviado ? relative(dados, arquivo).split(sep).join("/") : basename(arquivo);
    try {
      visitar(JSON.parse(readFileSync(arquivo, "utf8")), rotulo, "", !enviado);
    } catch {
      console.warn(`aviso: não consegui ler ${basename(arquivo)} como JSON`);
    }
  }

  // A chave PEM pode vazar quebrada em linhas: procura trechos do corpo.
  for (const [rotulo, valor] of [...segredos]) {
    if (!valor.includes("BEGIN")) continue;
    const corpo = valor.replace(/-----[^-]+-----|\\n|\s/g, "");
    for (let i = 0; i + 40 <= corpo.length; i += 200) segredos.set(`${rotulo}#trecho${i}`, corpo.slice(i, i + 40));
  }
  return segredos;
}

/** [{ caminho, conteudo }] do que seria publicado. */
function arquivosPublicados(ref) {
  if (ref === "--arvore") {
    const nomes = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
      .toString().split("\0").filter(Boolean);
    return nomes
      .filter((n) => existsSync(join(RAIZ, n)))
      .map((n) => ({ caminho: n, conteudo: readFileSync(join(RAIZ, n)).toString("latin1") }));
  }

  // Todos os blobs alcançáveis pelo ref: é exatamente o que um push enviaria.
  const linhas = git(["rev-list", "--objects", "--filter=object:type=blob", ref])
    .toString().split("\n").filter((l) => l.includes(" "));
  const caminhos = new Map(linhas.map((l) => [l.slice(0, l.indexOf(" ")), l.slice(l.indexOf(" ") + 1)]));
  const saida = git(["cat-file", "--batch"], [...caminhos.keys()].join("\n") + "\n");

  const arquivos = [];
  let pos = 0;
  while (pos < saida.length) {
    const fim = saida.indexOf(0x0a, pos);
    const [sha, , tamanho] = saida.subarray(pos, fim).toString().split(" ");
    const inicio = fim + 1;
    arquivos.push({ caminho: caminhos.get(sha), conteudo: saida.subarray(inicio, inicio + Number(tamanho)).toString("latin1") });
    pos = inicio + Number(tamanho) + 1;
  }
  return arquivos;
}

function mascarar(trecho) {
  return `${trecho.slice(0, 6)}… (${trecho.length} caracteres)`;
}

function main() {
  const ref = process.argv[2] || "HEAD";
  const alvo = ref === "--arvore" ? "arquivos do próximo commit" : `tudo o que um push de "${ref}" enviaria`;
  // Latin-1 preserva cada byte, então o valor procurado precisa da mesma codificação.
  const base = raizDosSegredos();
  const segredos = [...segredosConhecidos(base)].map(([r, v]) => [r, Buffer.from(v, "utf8").toString("latin1")]);
  const arquivos = arquivosPublicados(ref);
  const achados = [];

  for (const { caminho, conteudo } of arquivos) {
    for (const [padrao, motivo] of ARQUIVOS_PROIBIDOS) {
      if (padrao.test(caminho)) achados.push(`[arquivo proibido] ${caminho} — ${motivo}`);
    }
    for (const [rotulo, valor] of segredos) {
      if (conteudo.includes(valor)) achados.push(`[segredo real] ${caminho} — contém o valor de ${rotulo}`);
    }
    for (const [padrao, motivo] of FORMATOS) {
      for (const m of conteudo.matchAll(padrao)) achados.push(`[formato] ${caminho} — ${motivo}: ${mascarar(m[0])}`);
    }
  }

  console.log(`Varredura: ${alvo}`);
  console.log(`  ${arquivos.length} arquivos examinados, ${segredos.length} segredos conhecidos nesta máquina`);
  if (base !== RAIZ) console.log(`  segredos lidos da pasta principal do repositório (${basename(base)})`);
  if (segredos.length === 0) console.log("  aviso: nenhum segredo local encontrado — só formatos e nomes foram conferidos");

  if (achados.length === 0) {
    console.log("\nNenhuma credencial encontrada.");
    return 0;
  }
  console.log(`\n${achados.length} problema(s):`);
  for (const a of [...new Set(achados)]) console.log(`  ${a}`);
  return 1;
}

try {
  process.exitCode = main();
} catch (erro) {
  console.error(`erro: ${erro.message}`);
  process.exitCode = 2;
}
