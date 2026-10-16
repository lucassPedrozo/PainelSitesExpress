import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { httpError } from "../../http.js";
import { walkFiles } from "../../local/storage.js";

/**
 * Um site feito na ferramenta antiga (o Joinvixable), trazido para o motor
 * Claude do painel.
 *
 * Quem tem um site assim costuma tê-lo como uma pasta enviada a um projeto do
 * painel: o código (`src/`, `public/`, `content.json`) e a sessão de trabalho
 * dele (`.session/session.json`, com as etapas e os hashes dos arquivos
 * travados). É a sessão que diz ao motor que aquilo é um projeto dele.
 *
 * Trazido, o site vira um site do motor como os gerados aqui: é validado, vai
 * ao GitHub com a configuração do template (o `package.json` de um site
 * antigo não declara dependência nenhuma — todos usavam as da ferramenta — e
 * por isso não constrói no GitHub) e aceita pedido de ajuste pelo painel.
 *
 * Tudo aqui é conteúdo enviado por alguém: nada é interpretado além do JSON da
 * sessão, e o nome da pasta de trabalho é o painel que escolhe.
 */

const LIMITES_DA_ADOCAO = { maxArquivos: 6000, maxBytes: 600 * 1024 * 1024 };

const SESSAO = ".session/session.json";
const HISTORICO = ".session/headless.json";
/** O que não vem junto: dependências, build, git, workflows e segredos de ambiente. */
const PASTAS_DE_FORA = new Set(["node_modules", "dist", ".git", ".github", ".cache"]);
const ARQUIVO_DE_FORA = /^\.env(\..+)?$/i;

/**
 * As pastas do projeto do painel em que há um site do motor: têm a sessão, o
 * `content.json` e o `package.json`. `path` é relativo ao projeto ("" = raiz).
 *
 * @param {string} projectId
 * @param {{ listar?: typeof walkFiles }} [deps]
 * @returns {Promise<Array<{ path: string, files: number, bytes: number }>>}
 */
export async function sitesDoMotorNoProjeto(projectId, { listar = walkFiles } = {}) {
  const todos = await listar(projectId);
  const nomes = new Set(todos.map((file) => file.path));
  const raizes = todos
    .filter((file) => file.path === SESSAO || file.path.endsWith(`/${SESSAO}`))
    .map((file) => file.path.slice(0, -SESSAO.length).replace(/\/$/, ""))
    // Uma sessão dentro de node_modules ou de um build não é um site.
    .filter((raiz) => !raiz.split("/").some((parte) => PASTAS_DE_FORA.has(parte)))
    .filter((raiz) => ["content.json", "package.json"].every((nome) => nomes.has(raiz ? `${raiz}/${nome}` : nome)));

  return raizes
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .map((raiz) => {
      const dele = arquivosDoSite(todos, raiz);
      return { path: raiz, files: dele.length, bytes: dele.reduce((soma, file) => soma + file.size, 0) };
    });
}

/** Os arquivos de uma raiz que vêm junto, com o caminho relativo a ela. */
function arquivosDoSite(todos, raiz) {
  const prefixo = raiz ? `${raiz}/` : "";
  return todos
    .filter((file) => file.path.startsWith(prefixo))
    .map((file) => ({ ...file, relativo: file.path.slice(prefixo.length) }))
    .filter((file) => {
      const partes = file.relativo.split("/");
      return !partes.slice(0, -1).some((parte) => PASTAS_DE_FORA.has(parte)) && !ARQUIVO_DE_FORA.test(/** @type {string} */ (partes.at(-1)));
    });
}

/**
 * Confere a sessão do site e devolve-a com o slug novo. Uma sessão que não é
 * a do motor é recusada: sem ela o motor não saberia validar nem ajustar.
 *
 * @param {string} texto o conteúdo de `.session/session.json`
 * @param {string} slug a pasta de trabalho que o painel escolheu
 */
function sessaoAdotada(texto, slug) {
  /** @type {any} */
  let sessao;
  try {
    sessao = JSON.parse(texto);
  } catch {
    throw httpError(422, "A sessão do site (.session/session.json) não é um JSON válido.");
  }
  const etapasOk = Array.isArray(sessao?.etapas) && sessao.etapas.every((etapa) => etapa && typeof etapa.etapa === "string" && typeof etapa.status === "string");
  const travadosOk = sessao?.travados && typeof sessao.travados === "object" && !Array.isArray(sessao.travados);
  if (!sessao || typeof sessao !== "object" || !etapasOk || !travadosOk) {
    throw httpError(422, "A sessão do site (.session/session.json) não tem o formato da ferramenta: faltam as etapas ou os arquivos travados.");
  }
  // O motor grava a sessão na pasta que o campo `slug` diz: tem de ser a nova.
  return { ...sessao, slug };
}

/**
 * O histórico das execuções da ferramenta antiga, sem sessão a retomar.
 *
 * Um ajuste retoma a última conversa do Claude Code registrada no projeto. As
 * conversas de um site trazido são as da ferramenta antiga: outra pasta de
 * trabalho, outro modo de permissão (lá a edição direta era aceita) e todo o
 * histórico da geração. Retomar uma delas faz o agente agir como antes — sem
 * o runbook de hoje, com a edição negada — e reler centenas de milhares de
 * tokens. O registro continua (datas, duração, estimativa), mas o primeiro
 * ajuste pelo painel abre uma conversa nova.
 *
 * @param {string} texto o conteúdo de `.session/headless.json`
 */
function historicoAdotado(texto) {
  /** @type {any} */
  let historico;
  try {
    historico = JSON.parse(texto);
  } catch {
    return `${JSON.stringify({ execucoes: [] }, null, 2)}
`;
  }
  const execucoes = (Array.isArray(historico?.execucoes) ? historico.execucoes : [])
    .filter((item) => item && typeof item === "object")
    .map(({ session_id, retomou, ...resto }) => ({
      ...resto,
      ...(session_id ? { sessao_da_ferramenta_antiga: session_id } : {}),
    }));
  return `${JSON.stringify({ execucoes }, null, 2)}
`;
}

/**
 * Copia o site para a pasta de trabalho do motor. Monta ao lado e troca de uma
 * vez: uma cópia interrompida não deixa um projeto pela metade.
 *
 * @param {{ projectId: string, origem: string, destino: string, slug: string, entrada: string,
 *   limites?: typeof LIMITES_DA_ADOCAO, listar?: typeof walkFiles }} params
 *   `origem`: a pasta do site dentro do projeto; `destino`: `projects/<slug>` na
 *   pasta de trabalho; `entrada`: onde montar a cópia antes da troca.
 * @returns {Promise<{ files: number, bytes: number, etapas: number }>}
 */
export async function copiarSiteAdotado({ projectId, origem, destino, slug, entrada, limites = LIMITES_DA_ADOCAO, listar = walkFiles }) {
  const arquivos = arquivosDoSite(await listar(projectId), origem);
  const bytes = arquivos.reduce((soma, file) => soma + file.size, 0);
  if (!arquivos.some((file) => file.relativo === SESSAO)) {
    throw httpError(422, "Esta pasta não tem a sessão do site (.session/session.json).");
  }
  if (arquivos.length > limites.maxArquivos || bytes > limites.maxBytes) {
    throw httpError(422, `O site tem ${arquivos.length} arquivos — mais do que o painel traz de uma vez.`);
  }

  const montagem = path.join(entrada, `adocao-${randomBytes(6).toString("hex")}`);
  try {
    let etapas = 0;
    for (const file of arquivos) {
      const alvo = path.join(montagem, ...file.relativo.split("/"));
      await fs.mkdir(path.dirname(alvo), { recursive: true });
      if (file.relativo === SESSAO) {
        const sessao = sessaoAdotada(await fs.readFile(file.absolute, "utf8"), slug);
        etapas = sessao.etapas.length;
        await fs.writeFile(alvo, JSON.stringify(sessao, null, 2));
      } else if (file.relativo === HISTORICO) {
        await fs.writeFile(alvo, historicoAdotado(await fs.readFile(file.absolute, "utf8")));
      } else {
        await fs.copyFile(file.absolute, alvo);
      }
    }
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.rename(montagem, destino);
    return { files: arquivos.length, bytes, etapas };
  } finally {
    await fs.rm(montagem, { recursive: true, force: true }).catch(() => undefined);
  }
}
