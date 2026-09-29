import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { createSerialQueue, writeFileAtomic } from "../atomic-write.js";
import { guardarCopia, recuperarDoBackup } from "../backup.js";

/*
 * Leitura e gravação do banco do painel. Cada tipo de dado tem o seu módulo
 * ao lado (tags, nomes, gerações, publicações, acessos); todos compartilham
 * o estado em memória e a fila de escrita daqui.
 */

const DATA_DIR = config.dataDir;
/**
 * O banco do painel. Começou guardando só tags e por isso se chamava
 * `tags.json`; hoje guarda também apelidos, gerações do Lovable, links de
 * cliente, chaves de acesso e o histórico de publicação. O arquivo antigo é
 * renomeado na primeira leitura.
 */
const DATA_FILE = path.join(DATA_DIR, "painel.json");
const LEGACY_DATA_FILE = path.join(DATA_DIR, "tags.json");

/** Etiqueta que tira o projeto do painel principal. */
const FINISHED_TAG_NAME = "Finalizado";

/**
 * Etiquetas criadas na primeira execução. São só exceções: a etapa do projeto
 * (gerado, entregue, no ar…) é calculada pelo painel e mora no selo do card.
 */
const SEED_TAGS = [
  { name: "Material incompleto", color: "red" },
  { name: "Aguardando cliente", color: "amber" },
  { name: FINISHED_TAG_NAME, color: "slate" },
];

/**
 * Etiquetas de etapa dos primeiros meses. Repetiam à mão o que o selo já
 * calcula — "A avaliar" chegou a 77 de 80 projetos, e "Entregue" divergia do
 * selo. São removidas uma vez, na primeira leitura depois desta versão.
 */
const RETIRED_TAG_NAMES = ["A avaliar", "Aprovado", "Em produção", "Entregue", "Produzido"];


const empty = () => ({
  tags: [],
  projectTags: {},
  finishedTagId: null,
  stageTagsRetired: true,
  generations: {},
  names: {},
  accessUsers: [],
  publications: {},
});

let state = null;
/** Carga em andamento: quem chega durante a primeira leitura espera a mesma. */
let loading = null;
/** Serializa as escritas para que dois requests não sobrescrevam um ao outro. */
const enqueueWrite = createSerialQueue();

/**
 * O estado em memória, lido do disco uma vez.
 *
 * A primeira leitura é compartilhada. Antes, duas requisições chegando juntas
 * na subida liam o arquivo cada uma — e, sem arquivo, cada uma criava as tags
 * iniciais com ids diferentes, e a última gravação vencia.
 */
export function read() {
  if (state) return Promise.resolve(state);
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

/** Renomeia `tags.json` para `painel.json`, se ainda não foi feito. */
async function migrateLegacyFileName() {
  try {
    await fs.access(DATA_FILE);
    return;
  } catch {
    // Não há arquivo novo: vale conferir o antigo.
  }
  try {
    await fs.rename(LEGACY_DATA_FILE, DATA_FILE);
    console.log(`[store] ${LEGACY_DATA_FILE} renomeado para ${DATA_FILE}.`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function load() {
  await migrateLegacyFileName();

  let parsed;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    try {
      parsed = JSON.parse(raw);
    } catch (erroDeParse) {
      // Arquivo ilegível. Derrubar o painel aqui perderia tudo em silêncio;
      // a cópia mais recente que abre é melhor que nada, e o aviso é alto
      // porque o operador precisa saber que voltou no tempo.
      const copia = await recuperarDoBackup(DATA_DIR);
      if (!copia) {
        throw new Error(
          `${DATA_FILE} está corrompido e não há backup utilizável: ${erroDeParse.message}`,
        );
      }
      console.error(
        `[store] ${DATA_FILE} corrompido (${erroDeParse.message}).`,
      );
      console.error(`[store] recuperado do backup de ${copia.date}.`);
      parsed = copia.data;
    }
    state = {
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      projectTags: parsed.projectTags ?? {},
      finishedTagId: parsed.finishedTagId ?? null,
      stageTagsRetired: parsed.stageTagsRetired === true,
      // Ausentes nos arquivos gravados antes da geração existir.
      generations: parsed.generations ?? {},
      names: parsed.names ?? {},
      // Nasceu depois: arquivos antigos não têm a lista.
      accessUsers: Array.isArray(parsed.accessUsers) ? parsed.accessUsers : [],
      publications: parsed.publications ?? {},
    };

    // A etiqueta de finalizado nasceu depois das outras: adota a existente pelo
    // nome, ou cria. `null` explícito continua significando "foi excluída".
    if (parsed.finishedTagId === undefined) {
      const existente = state.tags.find(
        (tag) => normalize(tag.name) === normalize(FINISHED_TAG_NAME),
      );
      if (existente) {
        state.finishedTagId = existente.id;
      } else {
        const tag = {
          id: randomUUID(),
          name: FINISHED_TAG_NAME,
          color: "slate",
          createdAt: new Date().toISOString(),
        };
        state.tags.push(tag);
        state.finishedTagId = tag.id;
        console.log(`[tags] etiqueta "${FINISHED_TAG_NAME}" criada`);
      }
      await flush();
    }

    if (!state.stageTagsRetired) {
      retireStageTags(state);
      await flush();
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    state = empty();
    state.tags = SEED_TAGS.map((tag) => ({
      id: randomUUID(),
      name: tag.name,
      color: tag.color,
      createdAt: new Date().toISOString(),
    }));
    state.finishedTagId =
      state.tags.find((tag) => tag.name === FINISHED_TAG_NAME)?.id ?? null;
    await flush();
  }

  return state;
}

/**
 * Tira as etiquetas de etapa, de todos os projetos inclusive, e cria
 * "Aguardando cliente" se ainda não existir.
 */
function retireStageTags(data) {
  const aposentadas = new Set(RETIRED_TAG_NAMES.map(normalize));
  const removidas = new Set(
    data.tags.filter((tag) => aposentadas.has(normalize(tag.name))).map((tag) => tag.id),
  );
  data.tags = data.tags.filter((tag) => !removidas.has(tag.id));
  for (const [projectId, ids] of Object.entries(data.projectTags)) {
    const restantes = ids.filter((id) => !removidas.has(id));
    if (restantes.length) data.projectTags[projectId] = restantes;
    else delete data.projectTags[projectId];
  }

  const aguardando = SEED_TAGS[1];
  if (!data.tags.some((tag) => normalize(tag.name) === normalize(aguardando.name))) {
    data.tags.push({
      id: randomUUID(),
      name: aguardando.name,
      color: aguardando.color,
      createdAt: new Date().toISOString(),
    });
  }

  delete data.defaultTagId;
  data.stageTagsRetired = true;
  console.log(`[tags] ${removidas.size} etiqueta(s) de etapa removida(s)`);
}

/**
 * Escrita atômica: grava num temporário e troca o arquivo — uma gravação
 * interrompida não deixa JSON pela metade. Antes de sobrescrever, guarda a
 * cópia do dia, então o backup registra o estado *anterior* à mudança.
 */
export async function flush() {
  const snapshot = JSON.stringify(state, null, 2);
  return enqueueWrite(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      const copia = await guardarCopia(DATA_FILE, DATA_DIR);
      if (copia.created) console.log(`[store] backup do dia em ${copia.file}`);
    } catch (err) {
      // Falhar o backup não pode impedir a gravação: o dado novo vale mais
      // que a cópia. Mas o aviso fica, senão a falha passa meses sem ser vista.
      console.error(`[store] não foi possível gravar o backup: ${err.message}`);
    }

    // Uma gravação que falha não se perde de vez: o estado continua na
    // memória, e a próxima gravação bem-sucedida leva o arquivo inteiro.
    await writeFileAtomic(DATA_FILE, snapshot);
  });
}

export const normalize = (value) => value.trim().toLocaleLowerCase("pt-BR");

/**
 * Esquece o estado em memória, como se o processo tivesse reiniciado: a
 * próxima leitura volta ao disco. Só os testes precisam disto.
 */
export function resetStoreForTests() {
  state = null;
  loading = null;
}
