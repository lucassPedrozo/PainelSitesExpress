import fs from "node:fs/promises";
import path from "node:path";

/**
 * Cópias do banco do painel.
 *
 * A escrita já era atômica (temporário + `rename`), então uma gravação
 * interrompida não corrompe o arquivo. O que faltava era o resto: se o JSON
 * ficar ilegível por qualquer outro motivo — disco, edição à mão, um bug —, o
 * painel perdia tags, apelidos, gerações e links de cliente de uma vez, e nem
 * subia para avisar. Daí a cópia diária e a recuperação automática.
 */

/** Uma cópia por dia; quinze dias cobrem uma volta de férias. */
export const MAX_BACKUPS = 15;

/**
 * Cópias novas se chamam `painel-AAAA-MM-DD.json`; as anteriores à troca de
 * nome do banco, `tags-AAAA-MM-DD.json`. As duas contam para a rotação e para
 * a recuperação — senão as cópias antigas nunca seriam apagadas, nem usadas.
 */
const NOME = /^(?:painel|tags)-(\d{4}-\d{2}-\d{2})\.json$/;

const dataDaCopia = (nome) => NOME.exec(nome)?.[1] ?? "";

/** Mais antiga primeiro; no mesmo dia, o nome antigo antes do novo. */
const porData = (a, b) =>
  dataDaCopia(a).localeCompare(dataDaCopia(b)) ||
  Number(a.startsWith("painel-")) - Number(b.startsWith("painel-"));

export const backupDir = (dataDir) => path.join(dataDir, "backups");

/**
 * Nome da cópia pela data **local** da máquina. Com `toISOString` a data era a
 * de Greenwich: no Brasil, uma mudança feita depois das 21h caía na cópia "de
 * amanhã", e a do dia seguinte de manhã já não era criada — o estado daquela
 * manhã nunca virava backup.
 */
export const nomeDoDia = (data = new Date()) => {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `painel-${ano}-${mes}-${dia}.json`;
};

/**
 * Decide o que apagar. Separado do disco de propósito: é a regra que define
 * quantos dias de história existem, e regra assim merece teste.
 */
export function backupsParaRemover(nomes, max = MAX_BACKUPS) {
  const validos = nomes.filter((nome) => NOME.test(nome)).sort(porData);
  if (validos.length <= max) return [];
  return validos.slice(0, validos.length - max);
}

/**
 * Copia o arquivo atual para a pasta de backups, uma vez por dia. Chamado
 * *antes* de sobrescrever, então a cópia guarda o estado anterior à mudança.
 */
export async function guardarCopia(dataFile, dataDir) {
  const destinoDir = backupDir(dataDir);
  const destino = path.join(destinoDir, nomeDoDia());

  try {
    // Já existe cópia de hoje: nada a fazer.
    await fs.access(destino);
    return { created: false, reason: "ja-existe" };
  } catch {
    // Segue.
  }

  let conteudo;
  try {
    conteudo = await fs.readFile(dataFile, "utf8");
  } catch (err) {
    // Primeira execução: não há o que copiar.
    if (err.code === "ENOENT") return { created: false, reason: "sem-arquivo" };
    throw err;
  }

  await fs.mkdir(destinoDir, { recursive: true });
  await fs.writeFile(destino, conteudo, "utf8");

  const nomes = await fs.readdir(destinoDir);
  for (const velho of backupsParaRemover(nomes)) {
    await fs.rm(path.join(destinoDir, velho), { force: true });
  }

  return { created: true, file: destino };
}

/**
 * Procura a cópia mais recente que ainda dá para ler. Devolve `null` quando
 * não há nenhuma — aí o chamador começa do zero, que é melhor que não subir.
 */
export async function recuperarDoBackup(dataDir) {
  const dir = backupDir(dataDir);

  let nomes;
  try {
    nomes = await fs.readdir(dir);
  } catch {
    return null;
  }

  const candidatos = nomes
    .filter((nome) => NOME.test(nome))
    .sort(porData)
    .reverse();

  for (const nome of candidatos) {
    const caminho = path.join(dir, nome);
    try {
      const parsed = JSON.parse(await fs.readFile(caminho, "utf8"));
      if (parsed && typeof parsed === "object") {
        return { data: parsed, file: caminho, date: dataDaCopia(nome) };
      }
    } catch {
      // Cópia também ilegível: tenta a anterior.
    }
  }

  return null;
}
