import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { httpError } from "../../http.js";

/**
 * As imagens que acompanham um pedido de ajuste.
 *
 * A tela sobe cada imagem antes de pedir o ajuste; elas ficam em
 * `projects/<slug>/.session/anexos/<rascunho>/`, dentro da pasta de trabalho
 * do motor — que o agente pode ler e que nunca vai ao GitHub. Ao pedir o
 * ajuste, a lista escolhida vira `.session/anexos/pendente.json`, e é o motor
 * que a consome quando o agente abre a etapa: mostra as imagens a ele e copia
 * para `public/img/` as que a pessoa marcou para usar no site.
 *
 * Só imagem que o agente consegue abrir, conferida pelo conteúdo e não pelo
 * nome: PNG, JPEG, WebP e GIF.
 */

export const MAX_ANEXOS = 6;
export const MAX_BYTES_DO_ANEXO = 8 * 1024 * 1024;
/** Rascunhos guardados por site: o do pedido atual e os dos ajustes recentes. */
const RASCUNHOS_GUARDADOS = 8;

const RASCUNHO = /^[a-f0-9]{16}$/;
const ARQUIVO = /^\d{2}-[a-z0-9][a-z0-9-]{0,59}\.(png|jpg|webp|gif)$/;

/**
 * O tipo da imagem, lido dos primeiros bytes.
 * @param {Buffer} corpo
 * @returns {"png" | "jpg" | "webp" | "gif" | null}
 */
export function tipoDaImagem(corpo) {
  if (!Buffer.isBuffer(corpo) || corpo.length < 12) return null;
  if (corpo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (corpo[0] === 0xff && corpo[1] === 0xd8 && corpo[2] === 0xff) return "jpg";
  if (corpo.toString("latin1", 0, 4) === "RIFF" && corpo.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(corpo.toString("latin1", 0, 6))) return "gif";
  return null;
}

/** O nome com que a pessoa enviou, sem caminho nem caractere de controle. */
const nomeOriginal = (nome) =>
  String(nome ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .pop()
    .trim()
    .slice(0, 120);

/** A parte do nome que vai para o disco: minúsculas, sem acento, sem extensão. */
const nomeNoDisco = (nome) =>
  nome
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "imagem";

const dirAnexos = (dirDoSite) => path.join(dirDoSite, ".session", "anexos");

/** As imagens já guardadas em um rascunho, em ordem. */
async function arquivosDo(dir) {
  const nomes = await fs.readdir(dir).catch(() => /** @type {string[]} */ ([]));
  return nomes.filter((nome) => ARQUIVO.test(nome)).sort();
}

/**
 * Guarda uma imagem no rascunho do pedido. Sem rascunho, abre um.
 *
 * @param {{ dirDoSite: string, rascunho?: unknown, nome?: unknown, corpo: unknown }} entrada
 * @returns {Promise<{ draft: string, file: string, name: string, size: number }>}
 */
export async function guardarAnexo({ dirDoSite, rascunho, nome, corpo }) {
  if (!Buffer.isBuffer(corpo) || !corpo.length) throw httpError(400, "A imagem chegou vazia.");
  if (corpo.length > MAX_BYTES_DO_ANEXO) throw httpError(413, "A imagem passa de 8 MB.");
  const tipo = tipoDaImagem(corpo);
  if (!tipo) throw httpError(415, "Anexe imagens PNG, JPG, WebP ou GIF.");
  if (rascunho !== undefined && rascunho !== "" && !RASCUNHO.test(String(rascunho))) {
    throw httpError(400, "Rascunho de anexos inválido.");
  }
  const id = rascunho ? String(rascunho) : randomBytes(8).toString("hex");
  const dir = path.join(dirAnexos(dirDoSite), id);
  const guardados = await arquivosDo(dir);
  if (guardados.length >= MAX_ANEXOS) throw httpError(400, `Um pedido leva até ${MAX_ANEXOS} imagens.`);

  const original = nomeOriginal(nome) || `imagem.${tipo}`;
  // O número segue o último usado: tirar uma imagem do meio não repete nome.
  const proximo = guardados.length ? Number(guardados.at(-1)?.slice(0, 2)) + 1 : 1;
  const arquivo = `${String(proximo).padStart(2, "0")}-${nomeNoDisco(original)}.${tipo}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, arquivo), corpo, { flag: "wx" });
  return { draft: id, file: arquivo, name: original, size: corpo.length };
}

/**
 * Tira uma imagem do rascunho. Não reclama se ela já não está lá.
 * @param {{ dirDoSite: string, rascunho: unknown, arquivo: unknown }} entrada
 */
export async function removerAnexo({ dirDoSite, rascunho, arquivo }) {
  if (!RASCUNHO.test(String(rascunho)) || !ARQUIVO.test(String(arquivo))) throw httpError(400, "Anexo inválido.");
  await fs.rm(path.join(dirAnexos(dirDoSite), String(rascunho), String(arquivo)), { force: true });
}

/**
 * Confere os anexos que vieram com o pedido de ajuste contra o que está no
 * disco. Devolve a lista como o motor a espera, ou `null` quando o pedido não
 * tem imagem.
 *
 * @param {{ dirDoSite: string, anexos: unknown }} entrada
 * @returns {Promise<{ pasta: string, itens: Array<{ arquivo: string, nome: string, usar: boolean }> } | null>}
 */
export async function conferirAnexos({ dirDoSite, anexos }) {
  if (anexos === undefined || anexos === null) return null;
  const { draft, items } = /** @type {{ draft?: unknown, items?: unknown }} */ (anexos);
  if (typeof anexos !== "object" || !Array.isArray(items)) throw httpError(400, "Anexos inválidos.");
  if (!items.length) return null;
  if (!RASCUNHO.test(String(draft))) throw httpError(400, "Rascunho de anexos inválido.");
  if (items.length > MAX_ANEXOS) throw httpError(400, `Um pedido leva até ${MAX_ANEXOS} imagens.`);

  const guardados = new Set(await arquivosDo(path.join(dirAnexos(dirDoSite), String(draft))));
  const vistos = new Set();
  const itens = items.map((item) => {
    const arquivo = String(item?.file ?? "");
    if (!guardados.has(arquivo) || vistos.has(arquivo)) {
      throw httpError(400, "Uma das imagens anexadas não está mais no painel. Anexe de novo.");
    }
    vistos.add(arquivo);
    return { arquivo, nome: nomeOriginal(item?.name) || arquivo, usar: item?.use === true };
  });
  return { pasta: String(draft), itens };
}

/**
 * Deixa para o motor a lista do pedido que vai para a fila — ou apaga a de um
 * pedido anterior que não chegou a rodar, quando este não tem imagem. Um site
 * só tem um ajuste pendente por vez, então a lista é uma só.
 *
 * @param {string} dirDoSite
 * @param {Awaited<ReturnType<typeof conferirAnexos>>} lista
 */
export async function gravarPendente(dirDoSite, lista) {
  const dir = dirAnexos(dirDoSite);
  const arquivo = path.join(dir, "pendente.json");
  if (!lista) {
    await fs.rm(arquivo, { force: true });
    return;
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(arquivo, `${JSON.stringify(lista, null, 2)}\n`);
  await limparRascunhos(dir, lista.pasta);
}

/** Apaga os rascunhos mais antigos, menos o do pedido atual. */
async function limparRascunhos(dir, atual) {
  const entradas = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const pastas = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory() || !RASCUNHO.test(entrada.name) || entrada.name === atual) continue;
    const { mtimeMs } = await fs.stat(path.join(dir, entrada.name));
    pastas.push({ nome: entrada.name, mtimeMs });
  }
  pastas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { nome } of pastas.slice(RASCUNHOS_GUARDADOS - 1)) {
    await fs.rm(path.join(dir, nome), { recursive: true, force: true });
  }
}
