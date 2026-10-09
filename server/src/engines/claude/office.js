import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { entryContent, readZipDirectory, unreadableReason } from "../../archive/zip-reader.js";
import { readRange } from "../../local/storage.js";

/**
 * Documentos de escritório, abertos para o agente.
 *
 * A leitura de arquivos do Claude Code não abre .docx, .xlsx nem .pptx, e o
 * contrato do painel não deixa o agente rodar `unzip` ou um script para
 * extrair o texto. Sem isto, um Word com a lista de serviços do cliente
 * chegava à pasta de trabalho como um arquivo que ninguém conseguia ler, e o
 * briefing não saía.
 *
 * Esses formatos são um .zip com XML dentro. O painel tira dali o texto, que
 * vira um .txt no material, e as imagens embutidas, que entram como fotos. A
 * formatação se perde; parágrafos, tabelas e a ordem do conteúdo ficam.
 *
 * O conteúdo é do cliente — não confiável. Nada do XML é interpretado além de
 * virar texto, e cada parte lida tem teto de tamanho.
 */

/** Os formatos que o painel abre. Os binários antigos (.doc, .xls, .ppt) e o .rtf ficam de fora. */
export const ESCRITORIO_ABERTO = /\.(docx|xlsx|pptx|od[tsp])$/i;

const MAX_BYTES_DO_XML = 30 * 1024 * 1024;
const MAX_CARACTERES = 400_000;
const MAX_PARTES = 200;
/** Abaixo disso a imagem embutida é ícone, marcador ou enfeite. */
const MIN_BYTES_DA_IMAGEM = 8 * 1024;
const IMAGEM = /^(?:word|ppt|xl)\/media\/[^/]+\.(?:png|jpe?g|webp|gif)$|^Pictures\/[^/]+\.(?:png|jpe?g|webp|gif)$/i;

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Tira as marcações que sobraram e desfaz as entidades do XML. */
const semMarcacao = (xml) =>
  xml
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_tudo, nome) => {
      if (nome[0] !== "#") return ENTIDADES[nome.toLowerCase()];
      const codigo = nome[1].toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : "";
    });

/** Linhas sem espaço sobrando, e no máximo uma linha em branco entre blocos. */
const arrumar = (texto) =>
  texto
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+$/g, "").replace(/\t+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Word: parágrafos em linhas; cada linha de tabela em uma linha, com as células separadas por tabulação. */
function textoDoWord(xml) {
  const corpo = xml
    .replace(/<w:tc[ >][\s\S]*?<\/w:tc>/g, (celula) => `${celula.replace(/<\/w:p>/g, " ").replace(/<w:(?:br|cr)\b[^>]*\/>/g, " ")}\t`)
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  // O fim do último parágrafo de uma célula não deixa espaço antes da tabulação.
  return semMarcacao(corpo).replace(/ +\t/g, "\t");
}

/** PowerPoint: o texto de um slide, um parágrafo por linha. */
const textoDoSlide = (xml) => semMarcacao(xml.replace(/<a:br\b[^>]*\/>/g, "\n").replace(/<\/a:p>/g, "\n"));

/** OpenDocument (texto, planilha ou apresentação): tudo está em content.xml. */
const textoDoOpenDocument = (xml) =>
  semMarcacao(
    xml
      .replace(/<text:tab\b[^>]*\/>/g, "\t")
      .replace(/<text:line-break\b[^>]*\/>/g, "\n")
      .replace(/<\/table:table-cell>/g, "\t")
      .replace(/<\/table:table-row>/g, "\n")
      .replace(/<\/text:(?:p|h)>/g, "\n"),
  );

/** Excel: os textos repetidos ficam numa tabela à parte, e as células apontam para ela. */
const textosDoExcel = (xml) =>
  [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    // O <rPh> é a leitura fonética de textos em japonês: não é conteúdo da célula.
    semMarcacao(item.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<\/t>/g, "</t>")),
  );

/** Excel: uma planilha, linha por linha, com as células separadas por tabulação. */
function textoDaPlanilha(xml, textos) {
  const linhas = [];
  for (const [, linha] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas = [];
    for (const [, atributos, dentro] of linha.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tipo = /\bt="([^"]*)"/.exec(atributos)?.[1];
      const valor = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(dentro ?? "")?.[1];
      if (tipo === "s") celulas.push(textos[Number(valor)] ?? "");
      else if (tipo === "inlineStr") celulas.push(semMarcacao(dentro ?? ""));
      else celulas.push(valor === undefined ? "" : semMarcacao(valor));
    }
    if (celulas.some((celula) => celula.trim())) linhas.push(celulas.join("\t"));
  }
  return linhas.join("\n");
}

const numeroDe = (caminho) => Number(/(\d+)\.xml$/.exec(caminho)?.[1] ?? 0);

/**
 * Abre um documento de escritório já em disco.
 *
 * @param {string} arquivo o .docx, .xlsx, .pptx ou OpenDocument, em disco
 * @param {string} nome o nome original, que diz o formato
 * @returns {Promise<{
 *   texto: string,
 *   imagens: Array<{ nome: string, size: number, abrir: () => import("node:stream").Readable }>,
 * }>} o texto do documento e as imagens embutidas nele
 */
export async function abrirEscritorio(arquivo, nome) {
  const { size } = await fs.stat(arquivo);
  const { entries } = await readZipDirectory(size, (inicio, fim) => readRange(arquivo, inicio, fim));
  const porCaminho = new Map(entries.map((item) => [item.path, item]));
  const conteudo = (item) => entryContent(createReadStream(arquivo, { start: item.offset, end: item.end - 1 }), item);

  /** O XML de uma parte do documento; vazio quando ela não existe ou não dá para ler. */
  const xml = async (caminho) => {
    const item = porCaminho.get(caminho);
    if (!item || unreadableReason(item) || item.size > MAX_BYTES_DO_XML) return "";
    const pedacos = [];
    for await (const pedaco of conteudo(item)) pedacos.push(pedaco);
    return Buffer.concat(pedacos).toString("utf8");
  };
  const partes = (padrao) =>
    [...porCaminho.keys()]
      .filter((caminho) => padrao.test(caminho))
      .sort((a, b) => numeroDe(a) - numeroDe(b))
      .slice(0, MAX_PARTES);

  const extensao = /\.([a-z]+)$/i.exec(nome)?.[1].toLowerCase();
  let texto = "";
  if (extensao === "docx") {
    texto = textoDoWord(await xml("word/document.xml"));
  } else if (extensao === "pptx") {
    const slides = [];
    for (const caminho of partes(/^ppt\/slides\/slide\d+\.xml$/)) {
      const doSlide = arrumar(textoDoSlide(await xml(caminho)));
      if (doSlide) slides.push(`# Slide ${numeroDe(caminho)}\n\n${doSlide}`);
    }
    texto = slides.join("\n\n");
  } else if (extensao === "xlsx") {
    const textos = textosDoExcel(await xml("xl/sharedStrings.xml"));
    const planilhas = [];
    for (const caminho of partes(/^xl\/worksheets\/sheet\d+\.xml$/)) {
      const daPlanilha = arrumar(textoDaPlanilha(await xml(caminho), textos));
      if (daPlanilha) planilhas.push(`# Planilha ${numeroDe(caminho)}\n\n${daPlanilha}`);
    }
    texto = planilhas.join("\n\n");
  } else {
    texto = textoDoOpenDocument(await xml("content.xml"));
  }

  const imagens = entries
    .filter((item) => IMAGEM.test(item.path) && item.size >= MIN_BYTES_DA_IMAGEM && !unreadableReason(item))
    .map((item) => ({
      nome: /** @type {string} */ (item.path.split("/").pop()),
      size: item.size,
      abrir: () => conteudo(item),
    }));

  return { texto: arrumar(texto).slice(0, MAX_CARACTERES), imagens };
}
