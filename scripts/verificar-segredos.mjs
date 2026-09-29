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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");

// Chaves do .env que são configuração, não segredo. Todo o resto é tratado como
// sensível — inclusive domínios e hosts, que dizem onde está a infraestrutura.
const CHAVES_PUBLICAS = new Set([
  "PORT", "CACHE_TTL_MS", "SERVER_HOST", "GITHUB_ORG", "GOOGLE_CREDENTIALS_PATH",
  "LOVABLE_ENABLE_GENERATION", "LOVABLE_MAX_ATTACHMENTS", "LOVABLE_MAX_ATTACHMENT_BYTES",
  "PREVIEW_WATCH_INTERVAL_MS", "DEV_AREA_WATCH_INTERVAL_MS", "DEV_AREA_FTP_DIR",
  "DEV_AREA_FTP_PROTOCOL", "DEV_AREA_FTP_PORT", "GENERATION_ENGINE", "AI_PROVIDER",
  "AI_MODEL", "PANEL_DATA_DIR",
]);

// Nos JSON locais, só os campos cujo caminho indica credencial. `redirect_uri` e
// afins são endereços públicos por natureza.
const CAMPO_SENSIVEL = /(token|secret|key|hash|salt|password|senha|sess|refresh|access|private|code|client_id)/i;
const CAMPO_PUBLICO = /(uri|url|expires|type|scope)$/i;

const ARQUIVOS_PROIBIDOS = [
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, "arquivo .env"],
  [/(^|\/)g-suite-[^/]*\.json$|service-account[^/]*\.json$/i, "chave de service account"],
  [/(^|\/)server\/data\//, "banco local do painel"],
  [/(^|\/)(lovable-auth|sessions)\.json$/, "credenciais do painel"],
  [/\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)$/i, "chave privada"],
  [/\.log(\.\d+)?$/, "log de execução"],
  [/\.exe$/i, "executável compilado"],
];

// Formatos estritos: os valores de teste do projeto (github_pat_teste…,
// sk-ant-api03-abc…) são curtos demais para casar.
const FORMATOS = [
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g, "token clássico do GitHub"],
  [/\bgithub_pat_[A-Za-z0-9_]{70,}/g, "token fine-grained do GitHub"],
  [/\bsk-ant-[a-z0-9]+-[A-Za-z0-9_-]{80,}/g, "chave da Anthropic"],
  [/\bsk-(proj-)?[A-Za-z0-9]{40,}/g, "chave da OpenAI"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "chave de API do Google"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "chave da AWS"],
  [/\bxox[baprs]-[0-9A-Za-z-]{20,}/g, "token do Slack"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "chave privada PEM"],
  [/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{20,}/g, "JWT completo"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`${}]+:[^\s/@'"`${}]{6,}@[^\s/'"`]+/gi, "senha embutida em URL"],
  [/[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/gi, "e-mail de service account"],
];

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

function jsonsEm(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return jsonsEm(caminho);
    return nome.endsWith(".json") ? [caminho] : [];
  });
}

/** Cada segredo desta máquina, como { rótulo → valor }. */
function segredosConhecidos() {
  const segredos = new Map();
  const env = lerEnv(join(RAIZ, ".env"));
  for (const [chave, valor] of Object.entries(env)) {
    if (CHAVES_PUBLICAS.has(chave) || valor.length < 6 || /^\d+$/.test(valor)) continue;
    segredos.set(`.env:${chave}`, valor);
  }

  const chaves = readdirSync(RAIZ)
    .filter((n) => /^g-suite-.*\.json$|service-account.*\.json$/i.test(n))
    .map((n) => join(RAIZ, n));
  if (env.GOOGLE_CREDENTIALS_PATH) chaves.push(resolve(RAIZ, env.GOOGLE_CREDENTIALS_PATH));
  const dados = resolve(RAIZ, env.PANEL_DATA_DIR || "server/data");

  const visitar = (valor, caminho) => {
    if (Array.isArray(valor)) valor.forEach((v, i) => visitar(v, `${caminho}[${i}]`));
    else if (valor && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor)) visitar(v, `${caminho}.${k}`);
    } else if (typeof valor === "string" && valor.length >= 16) {
      const campo = caminho.split(".").pop();
      if (CAMPO_SENSIVEL.test(caminho) && !CAMPO_PUBLICO.test(campo)) segredos.set(caminho, valor);
    }
  };
  for (const arquivo of new Set([...chaves, ...jsonsEm(dados)])) {
    if (!existsSync(arquivo)) continue;
    try {
      visitar(JSON.parse(readFileSync(arquivo, "utf8")), basename(arquivo));
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
  const segredos = [...segredosConhecidos()].map(([r, v]) => [r, Buffer.from(v, "utf8").toString("latin1")]);
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
