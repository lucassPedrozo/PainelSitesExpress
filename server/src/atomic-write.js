import fs from "node:fs/promises";

/**
 * Gravação dos arquivos de estado do painel (`painel.json`, `sessions.json`,
 * `lovable-auth.json`).
 *
 * Os dois stores serializavam as escritas com `fila = fila.then(tarefa)`. O
 * defeito era silencioso: se uma gravação falhasse, a fila ficava rejeitada, e
 * `.then` sobre promise rejeitada nunca executa a tarefa seguinte. Uma única
 * falha passageira bastava para o painel parar de salvar qualquer coisa até
 * ser reiniciado — com a memória seguindo em frente e o disco parado no tempo.
 */

/**
 * Executa tarefas uma de cada vez. A falha de uma chega a quem a pediu, mas
 * não contamina a fila: a próxima tarefa roda normalmente.
 */
export function createSerialQueue() {
  let tail = Promise.resolve();

  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Erros que, no Windows, costumam ser só um bloqueio momentâneo: antivírus,
 * indexador ou OneDrive abrindo o arquivo no instante do `rename`.
 */
const TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

const RENAME_DELAYS_MS = [50, 150, 400, 1000];

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** `rename` com novas tentativas para os bloqueios passageiros do Windows. */
export async function renameWithRetry(
  from,
  to,
  { rename = fs.rename, delays = RENAME_DELAYS_MS } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (!TRANSIENT_CODES.has(err?.code) || attempt >= delays.length) throw err;
      await wait(delays[attempt]);
    }
  }
}

/**
 * Escrita atômica: grava num temporário e troca o arquivo, então uma gravação
 * interrompida não deixa JSON pela metade. O temporário não fica para trás
 * quando a troca falha de vez.
 *
 * @param {string} file
 * @param {string | Uint8Array} content texto ou bytes (a codificação só vale para texto)
 * @param {import("node:fs").WriteFileOptions} [options]
 */
export async function writeFileAtomic(file, content, options = "utf8") {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, options);
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
