import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../../atomic-write.js";
import { HttpError } from "../../http.js";

/**
 * A pasta de trabalho do motor Claude, dentro da pasta de dados do painel.
 *
 *   <dados>/joinvixable/
 *     trabalho/        a raiz que o agente enxerga (é o diretório do claude -p)
 *       clientes/<pasta>/     o material copiado do projeto e o briefing
 *       projects/<slug>/      o site: código, dist e a sessão das etapas
 *       .history/  .cache/    layouts já usados e as buscas de fotos
 *       package.json          encaminha os comandos do runbook para o pacote do motor
 *       node_modules          junção para as dependências do motor
 *     execucoes/<id>.jsonl    o stream bruto de cada execução
 *     runbook.md              o runbook, gerado das fontes a cada execução
 *     atual/<id>.txt          o projeto em que as ferramentas de cada execução agem
 *
 * O agente roda de `trabalho/`, e não da pasta do pacote: os caminhos que o
 * runbook cita (`projects/<slug>/`, `clientes/<pasta>/`) continuam valendo, e
 * ele deixa de enxergar o código do motor, as seções, o template e os prompts
 * — que o runbook já mandava não ler. O stream e a fila ficam um nível acima,
 * fora do alcance dele.
 */

/**
 * @param {{ dataDir: string, dirMotor: string }} params
 */
export function caminhosDoMotor({ dataDir, dirMotor }) {
  const dados = path.join(dataDir, "joinvixable");
  return {
    motor: dirMotor,
    dados,
    trabalho: path.join(dados, "trabalho"),
    execucoes: path.join(dados, "execucoes"),
    runbook: path.join(dados, "runbook.md"),
    configuracoes: path.join(dados, "configuracoes-do-agente.json"),
    trava: path.join(dados, "rodando.lock"),
    /** O projeto em que as ferramentas de cada execução agem: um arquivo por execução. */
    atual: path.join(dados, "atual"),
  };
}

/** @typedef {ReturnType<typeof caminhosDoMotor>} Caminhos */

/** Os quatro comandos do runbook: o protocolo do agente com o motor. */
export const COMANDOS_DO_RUNBOOK = ["cliente", "new-project", "step", "tool"];

const barras = (caminho) => caminho.replace(/\\/g, "/");

/**
 * O `package.json` da pasta de trabalho. Não tem dependência nenhuma: só faz
 * `npm run -s step`, digitado de lá, rodar o `scripts/step.ts` do pacote.
 *
 * O comando começa por `node`, sem caminho: no Windows o npm entrega o script
 * ao `cmd`, que desmonta uma linha que começa com aspas — com o Node em
 * `C:/Program Files`, o agente recebia "'C:/Program' não é reconhecido" e não
 * conseguia rodar nenhum comando do runbook. O Node certo chega pelo PATH, que
 * o ambiente do motor põe na frente (`ambienteDoFilho`).
 *
 * @param {string} dirMotor
 */
export function pacoteDaRaiz(dirMotor) {
  const tsx = barras(path.join(dirMotor, "node_modules", "tsx", "dist", "cli.mjs"));
  const script = (nome) => `node "${tsx}" "${barras(path.join(dirMotor, "scripts", `${nome}.ts`))}"`;
  return {
    name: "joinvixable-trabalho",
    private: true,
    description:
      "Gerado pelo Painel Sites Express: encaminha os comandos do runbook para o pacote do motor. Não edite.",
    scripts: Object.fromEntries(COMANDOS_DO_RUNBOOK.map((nome) => [nome, script(nome)])),
  };
}

/**
 * Deixa a pasta de trabalho pronta para uma execução: as pastas, o
 * `package.json` que encaminha os comandos e a junção das dependências.
 *
 * O build de um site acha React, Vite e Tailwind subindo a árvore a partir da
 * pasta do projeto. Com os projetos na pasta de dados, o `node_modules` do
 * motor não está mais acima deles — a junção o põe lá, sem instalar nada duas
 * vezes. (Junção, e não link simbólico: no Windows ela não pede privilégio.)
 *
 * @param {Caminhos} caminhos
 */
export async function prepararRaiz(caminhos) {
  await fs.mkdir(path.join(caminhos.trabalho, "clientes"), { recursive: true });
  await fs.mkdir(path.join(caminhos.trabalho, "projects"), { recursive: true });
  await fs.mkdir(caminhos.execucoes, { recursive: true });

  const pacote = `${JSON.stringify(pacoteDaRaiz(caminhos.motor), null, 2)}\n`;
  const arquivo = path.join(caminhos.trabalho, "package.json");
  const atual = await fs.readFile(arquivo, "utf8").catch(() => null);
  if (atual !== pacote) await writeFileAtomic(arquivo, pacote);

  const alvo = path.join(caminhos.motor, "node_modules");
  const juncao = path.join(caminhos.trabalho, "node_modules");
  const info = await fs.lstat(juncao).catch(() => null);
  if (info?.isSymbolicLink()) {
    const aponta = await fs.readlink(juncao).catch(() => "");
    if (path.resolve(caminhos.trabalho, aponta).toLowerCase() === path.resolve(alvo).toLowerCase()) return;
    // Aponta para outro lugar (a pasta do painel mudou de endereço): refaz.
    await fs.rm(juncao, { force: true });
  } else if (info) {
    throw new HttpError(
      500,
      "Há uma pasta node_modules de verdade na pasta de trabalho do motor, no lugar da junção. Apague-a (server/data/joinvixable/trabalho/node_modules) e tente de novo.",
    );
  }
  await fs.symlink(alvo, juncao, "junction");
}

/* ------------------------------------------------------------------ *
 * Os poucos arquivos do motor que o painel lê direto
 *
 * São lidos várias vezes por execução (a cada evento do stream), e uma
 * consulta ao motor por leitura custaria um processo cada. O formato deles é
 * do motor; o painel só lê, ou grava o registro que o próprio motor espera.
 * ------------------------------------------------------------------ */

const lerJson = (arquivo) => {
  try {
    return JSON.parse(readFileSync(arquivo, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};

/**
 * Os projetos que o motor já criou para um cliente (`clientes/<pasta>/projeto.json`).
 * @param {string} trabalho
 * @param {string} pasta
 * @returns {string[]}
 */
export function projetosDoCliente(trabalho, pasta) {
  const registro = lerJson(path.join(trabalho, "clientes", pasta, "projeto.json"));
  return Array.isArray(registro?.projetos)
    ? registro.projetos.map((item) => item?.slug).filter((slug) => typeof slug === "string")
    : [];
}

/** O projeto do motor existe de fato quando a sessão dele foi criada. */
export const temSessao = (trabalho, slug) =>
  existsSync(path.join(trabalho, "projects", slug, ".session", "session.json"));

const arquivoDoHistorico = (trabalho, slug) =>
  path.join(trabalho, "projects", slug, ".session", "headless.json");

/**
 * As execuções do `claude -p` de um projeto, no arquivo da sessão dele que o
 * motor conhece (`.session/headless.json`): a sessão do Claude Code de cada
 * uma, como terminou e a estimativa de custo que o Claude Code informou. É
 * dele que sai a sessão que a execução seguinte retoma.
 *
 * @param {string} trabalho
 * @param {string} slug
 * @returns {Array<Record<string, any>>}
 */
export function lerHistoricoDoProjeto(trabalho, slug) {
  const lido = lerJson(arquivoDoHistorico(trabalho, slug));
  return Array.isArray(lido?.execucoes) ? lido.execucoes : [];
}

/** Os campos que o motor conhece de uma execução. O resto é do painel e fica no banco dele. */
const CAMPOS_DO_MOTOR = [
  "id",
  "data",
  "tipo",
  "pedido",
  "status",
  "modelo",
  "session_id",
  "retomou",
  "sessao_nova_por_falha",
  "duracao_ms",
  "total_cost_usd",
  "codigo_saida",
  "turnos",
  "mensagem",
];

/**
 * Grava (ou atualiza) uma execução no histórico do projeto.
 * @param {string} trabalho
 * @param {string} slug
 * @param {Record<string, any>} execucao
 */
export async function gravarNoHistorico(trabalho, slug, execucao) {
  if (!temSessao(trabalho, slug)) return;
  const linha = Object.fromEntries(
    CAMPOS_DO_MOTOR.filter((campo) => execucao[campo] !== undefined).map((campo) => [campo, execucao[campo]]),
  );
  const todas = lerHistoricoDoProjeto(trabalho, slug);
  const indice = todas.findIndex((item) => item.id === linha.id);
  if (indice >= 0) todas[indice] = linha;
  else todas.push(linha);
  await writeFileAtomic(arquivoDoHistorico(trabalho, slug), `${JSON.stringify({ execucoes: todas }, null, 2)}\n`);
}

/**
 * A sessão do Claude Code a retomar em um ajuste, uma continuação ou um
 * refino: a da última execução do projeto que abriu ou usou uma, fora as de
 * crítica. Quem critica é uma sessão que não escreveu o site; a dela fica no
 * histórico e nunca passa a ser a sessão do site.
 */
export const ultimaSessao = (trabalho, slug) =>
  [...lerHistoricoDoProjeto(trabalho, slug)].reverse().find((item) => item.session_id && item.tipo !== "criticar")
    ?.session_id ?? null;
