import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mimeOfName } from "../../archive/entry-type.js";
import { entryContent, readZipDirectory, unreadableReason } from "../../archive/zip-reader.js";
import { renameWithRetry } from "../../atomic-write.js";
import { loadBrief } from "../../brief.js";
import { GOOGLE_NATIVE_PDF, kindOf, streamFile, walkProjectFiles } from "../../drive.js";
import { httpError } from "../../http.js";
import { localFileId, readRange, walkFiles } from "../../local/storage.js";
import { isLocalProjectId } from "../../store/local-projects.js";
import { abrirEscritorio, ESCRITORIO_ABERTO } from "./office.js";

/**
 * O material do cliente, do projeto do painel para a pasta de trabalho do
 * motor.
 *
 * O motor escreve o briefing lendo os arquivos de `clientes/<pasta>/`. No
 * painel antigo alguém punha os arquivos lá pelo Explorer; aqui eles vêm do
 * próprio projeto — a pasta de coleta no Drive, ou o que foi enviado ao painel
 * — e são copiados a cada pedido de briefing, só o que a pessoa marcou:
 *
 *   clientes/<pasta>/material/
 *     informacoes-do-site.txt     o texto do formulário de coleta
 *     <pastas e arquivos>         como estão no projeto (nativos do Google em PDF)
 *     <nome-do-zip>/              o conteúdo de cada .zip, já aberto
 *     <documento>.docx.txt        o texto de cada Word, Excel ou PowerPoint
 *     <documento>-imagens/        as imagens embutidas nele
 *     fotos-de-banco/             as fotos escolhidas no painel (Pixabay)
 *
 * A cópia nova troca a anterior por inteiro: o que foi desmarcado deixa de
 * existir para o agente. A pasta `briefing/`, ao lado, não é tocada.
 *
 * Tudo aqui é conteúdo do cliente — não confiável. O painel só copia bytes e
 * escolhe os nomes em disco; nada do que está nos arquivos é interpretado.
 */

const MB = 1024 * 1024;

export const LIMITES_DO_MATERIAL = Object.freeze({
  /** A instrução do briefing lista no máximo isto. */
  maxArquivos: 300,
  maxBytesPorArquivo: 100 * MB,
  maxBytesTotal: 500 * MB,
  // O corpo de uma requisição do painel vai até 64 KB: o texto cabe com folga.
  maxCaracteresDoTexto: 40_000,
  maxCaracteresDasObservacoes: 2_000,
});

export const ARQUIVO_DAS_INFORMACOES = "informacoes-do-site.txt";
const PASTA_DAS_FOTOS_DE_BANCO = "fotos-de-banco";

const megas = (bytes) => `${Math.round(bytes / MB)} MB`;

/** Formatos de escritório em binário: a leitura de arquivos do agente não os abre. */
const ESCRITORIO = /\.(docx?|xlsx?|pptx?|rtf|od[tsp])$/i;
/** Assinatura antiga guardada na pasta do cliente ("Rodapé Escuro.png"). */
const ASSINATURA_ANTIGA = /^rodap[eé](?![a-z])/i;
/** As fotos que o site aceita; o resto das imagens (HEIC, TIFF) o navegador não desenha. */
const FOTO = /\.(png|jpe?g|webp|avif|gif|svg)$/i;

const NOMES = {
  video: "O Claude não lê vídeo.",
  audio: "O Claude não lê áudio.",
};

/**
 * @typedef {{
 *   id: string, name: string, trail: string[], mimeType: string, size: number | null,
 *   modifiedTime: string | null, webViewLink: string | null, hasThumbnail: boolean,
 *   isBrief: boolean, abrir: () => Promise<import("node:stream").Readable>,
 * }} ArquivoDeOrigem
 * @typedef {ReturnType<typeof descrever>} ArquivoDoMaterial
 */

/**
 * O arquivo como a tela de geração o mostra — os mesmos campos da lista de
 * anexos do Lovable, para a tela ser uma só.
 *
 * @param {ArquivoDeOrigem} arquivo
 */
function descrever(arquivo) {
  const kind = kindOf(arquivo.mimeType, arquivo.name);
  const exportado = GOOGLE_NATIVE_PDF.has(arquivo.mimeType);
  const uploadName = exportado ? `${arquivo.name}.pdf` : arquivo.name;
  // Nativo do Google: o tamanho do Drive é o do documento, não o do PDF.
  const size = exportado ? null : arquivo.size;

  let blockedReason = null;
  if (NOMES[kind]) blockedReason = NOMES[kind];
  else if (kind === "archive" && !/\.zip$/i.test(arquivo.name)) {
    blockedReason = "Só arquivos .zip são abertos pelo painel.";
  } else if (size && size > LIMITES_DO_MATERIAL.maxBytesPorArquivo) {
    blockedReason = `Acima do limite de ${megas(LIMITES_DO_MATERIAL.maxBytesPorArquivo)}`;
  }

  const assinaturaAntiga = ASSINATURA_ANTIGA.test(arquivo.name.normalize("NFC").trim());
  // Word, Excel e PowerPoint o painel abre e entrega como texto; os formatos antigos, não.
  const convertido = !exportado && ESCRITORIO_ABERTO.test(arquivo.name);
  const escritorio = !exportado && !convertido && ESCRITORIO.test(arquivo.name);
  let attachWarning = null;
  if (!blockedReason) {
    if (assinaturaAntiga) {
      attachWarning = "Assinatura antiga da pasta: a oficial já entra em todo site.";
    } else if (escritorio) {
      attachWarning = "O Claude não abre este formato. Salve como .docx, PDF ou texto.";
    } else if (convertido) {
      attachWarning = "O painel entrega ao Claude o texto e as imagens do documento, sem a formatação.";
    } else if (kind === "archive") {
      attachWarning = "O painel abre o .zip: as fotos e os textos de dentro entram como material.";
    }
  }

  return {
    id: arquivo.id,
    name: arquivo.name,
    folder: arquivo.trail.join(" / ") || null,
    mimeType: arquivo.mimeType,
    kind,
    size,
    attachWarning,
    modifiedTime: arquivo.modifiedTime,
    webViewLink: arquivo.webViewLink,
    hasThumbnail: arquivo.hasThumbnail,
    uploadName,
    exportedToPdf: exportado,
    isBrief: arquivo.isBrief,
    blockedReason,
    // O texto das informações já vai num arquivo próprio: copiar o original seria repetir.
    recommended: !blockedReason && !arquivo.isBrief && !assinaturaAntiga && !escritorio,
    convertedToText: convertido,
  };
}

/* ------------------------------------------------------------------ *
 * De onde o material vem
 * ------------------------------------------------------------------ */

/**
 * @typedef {{ found: boolean, text?: string, file?: any, others?: number }} Informacoes
 * @typedef {{
 *   listar: (projectId: string) => Promise<ArquivoDeOrigem[]>,
 *   informacoes: (projectId: string, opcoes?: { refresh?: boolean }) => Promise<Informacoes>,
 * }} Fonte
 */

/** @type {Informacoes} */
const SEM_INFORMACOES = { found: false };

/** A pasta de coleta no Drive. @type {Fonte} */
const doDrive = {
  async listar(projectId) {
    /** @type {Informacoes} */
    const brief = await loadBrief(projectId).catch(() => SEM_INFORMACOES);
    const briefId = brief.found ? brief.file.id : null;
    return (await walkProjectFiles(projectId)).map((file) => ({
      id: file.id,
      name: file.name,
      trail: file.trail,
      mimeType: file.mimeType,
      size: file.size ? Number(file.size) : null,
      modifiedTime: file.modifiedTime ?? null,
      webViewLink: file.webViewLink ?? null,
      hasThumbnail: Boolean(file.thumbnailLink),
      isBrief: file.id === briefId,
      abrir: async () => (await streamFile(file.id, file.mimeType)).data,
    }));
  },
  informacoes: (projectId, opcoes) => loadBrief(projectId, opcoes),
};

/** Os arquivos enviados a um projeto criado no painel. @type {Fonte} */
const doPainel = {
  async listar(projectId) {
    return (await walkFiles(projectId)).map((file) => {
      const partes = file.path.split("/");
      const name = /** @type {string} */ (partes.pop());
      return {
        id: localFileId(projectId, file.path),
        name,
        trail: partes,
        mimeType: mimeOfName(name),
        size: file.size,
        modifiedTime: file.modifiedTime,
        webViewLink: null,
        hasThumbnail: false,
        isBrief: false,
        abrir: async () => createReadStream(file.absolute),
      };
    });
  },
  // Não há formulário de coleta: o texto, se houver, é um arquivo como os outros.
  informacoes: async () => SEM_INFORMACOES,
};

/** @param {string} projectId @returns {Fonte} */
const fonteDoProjeto = (projectId) => (isLocalProjectId(projectId) ? doPainel : doDrive);

/**
 * Tudo o que a tela de geração precisa para o motor Claude: o texto das
 * informações do site e os arquivos do projeto, classificados. Só lê.
 *
 * @param {string} projectId
 * @param {{ refresh?: boolean, fonte?: Fonte }} [opcoes]
 */
export async function pacoteDoMaterial(projectId, { refresh = false, fonte = fonteDoProjeto(projectId) } = {}) {
  const [informacoes, origem] = await Promise.all([
    fonte.informacoes(projectId, { refresh }).catch(() => SEM_INFORMACOES),
    fonte.listar(projectId),
  ]);

  const porId = new Map(origem.map((arquivo) => [arquivo.id, arquivo]));
  const files = origem
    .map(descrever)
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
    );

  return {
    prompt: informacoes.found
      ? { found: true, text: informacoes.text ?? "", file: informacoes.file ?? null, others: informacoes.others ?? 0 }
      : { found: false, text: "", file: null, others: 0 },
    files,
    limits: LIMITES_DO_MATERIAL,
    /** Para a cópia: o arquivo de origem de cada item. Não vai ao navegador. */
    origem: porId,
  };
}

/**
 * Confere o que a pessoa marcou contra o projeto e devolve o plano da cópia.
 *
 * @param {Awaited<ReturnType<typeof pacoteDoMaterial>>} pacote
 * @param {{ fileIds?: unknown, texto?: unknown, observacoes?: unknown }} entrada
 *   `fileIds` ausente: os recomendados. `texto` ausente: o das informações do
 *   site, quando o projeto tem.
 */
export function planoDoMaterial(pacote, { fileIds, texto, observacoes } = {}) {
  if (fileIds !== undefined && !Array.isArray(fileIds)) {
    throw httpError(400, "Lista de arquivos inválida.");
  }
  const porId = new Map(pacote.files.map((file) => [file.id, file]));
  const ids =
    fileIds === undefined
      ? pacote.files.filter((file) => file.recommended).map((file) => file.id)
      : [...new Set(/** @type {unknown[]} */ (fileIds))];

  const arquivos = ids.map((id) => {
    const file = porId.get(/** @type {string} */ (id));
    // Só aceita id que veio da varredura deste projeto: o painel não vira
    // ponte para um arquivo qualquer do Drive.
    if (!file) throw httpError(400, "Arquivo selecionado não é deste projeto");
    if (file.blockedReason) throw httpError(400, `"${file.name}": ${file.blockedReason}`);
    return file;
  });
  if (arquivos.length > LIMITES_DO_MATERIAL.maxArquivos) {
    throw httpError(400, `Selecione no máximo ${LIMITES_DO_MATERIAL.maxArquivos} arquivos.`);
  }
  const conhecidos = arquivos.reduce((soma, file) => soma + (file.size ?? 0), 0);
  if (conhecidos > LIMITES_DO_MATERIAL.maxBytesTotal) {
    throw httpError(
      400,
      `A seleção soma ${megas(conhecidos)} — o limite do material é ${megas(LIMITES_DO_MATERIAL.maxBytesTotal)}.`,
    );
  }

  if (texto !== undefined && typeof texto !== "string") throw httpError(400, "Texto das informações inválido.");
  const informacoes = (texto === undefined ? pacote.prompt.text : /** @type {string} */ (texto)).trim();
  if (informacoes.length > LIMITES_DO_MATERIAL.maxCaracteresDoTexto) {
    throw httpError(
      400,
      `O texto das informações tem ${informacoes.length.toLocaleString("pt-BR")} caracteres — o limite é ${LIMITES_DO_MATERIAL.maxCaracteresDoTexto.toLocaleString("pt-BR")}.`,
    );
  }

  if (observacoes !== undefined && typeof observacoes !== "string") throw httpError(400, "Observações inválidas.");
  // Uma linha só: as observações vão dentro do pedido digitado ao claude.
  const notas = String(observacoes ?? "").replace(/\s+/g, " ").trim();
  if (notas.length > LIMITES_DO_MATERIAL.maxCaracteresDasObservacoes) {
    throw httpError(
      400,
      `As observações têm ${notas.length.toLocaleString("pt-BR")} caracteres — o limite é ${LIMITES_DO_MATERIAL.maxCaracteresDasObservacoes.toLocaleString("pt-BR")}.`,
    );
  }

  return { arquivos, informacoes, observacoes: notas };
}

/* ------------------------------------------------------------------ *
 * Nomes em disco
 * ------------------------------------------------------------------ */

// Caracteres que o Windows recusa em nome de arquivo, e os de controle.
// eslint-disable-next-line no-control-regex
const PROIBIDOS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVADOS = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Um nome que qualquer sistema de arquivos aceita. O nome original vem do
 * cliente (Drive, zip): nunca vira caminho sem passar por aqui.
 *
 * @param {string} nome
 */
export function nomeSeguro(nome) {
  let limpo = String(nome ?? "")
    .normalize("NFC")
    .replace(PROIBIDOS, "-")
    .replace(/\s+/g, " ")
    // O Windows descarta ponto e espaço finais; e nome que começa com ponto some das listagens.
    .replace(/[. ]+$/, "")
    .replace(/^[. ]+/, "");
  if (limpo.length > 120) {
    const extensao = path.extname(limpo).slice(0, 12);
    limpo = `${limpo.slice(0, 120 - extensao.length).replace(/[. ]+$/, "")}${extensao}`;
  }
  if (!limpo) limpo = "arquivo";
  if (RESERVADOS.test(limpo)) limpo = `_${limpo}`;
  return limpo;
}

/**
 * O nome de uma foto como vai parar no site (`public/img/<nome>`): minúsculas,
 * sem acento nem espaço. "Fachada da Loja (1).JPG" vira "fachada-da-loja-1.jpg".
 *
 * @param {string} nome
 */
export function nomeDeFoto(nome) {
  const extensao = path.extname(nome).toLowerCase();
  const base =
    path
      .basename(nome, path.extname(nome))
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "foto";
  return `${base}${extensao === ".jpeg" ? ".jpg" : extensao}`;
}

/** Acrescenta `-2`, `-3`… antes da extensão até o nome ser único no conjunto. */
function unico(nome, usados) {
  const extensao = path.extname(nome);
  const base = nome.slice(0, nome.length - extensao.length);
  let candidato = nome;
  for (let n = 2; usados.has(candidato.toLowerCase()); n += 1) candidato = `${base}-${n}${extensao}`;
  usados.add(candidato.toLowerCase());
  return candidato;
}

/* ------------------------------------------------------------------ *
 * A cópia
 * ------------------------------------------------------------------ */

/**
 * Copia o material para a pasta do cliente na pasta de trabalho do motor.
 *
 * @param {{
 *   pastaDoCliente: string, entrada: string,
 *   arquivos: ArquivoDoMaterial[], origem: Map<string, ArquivoDeOrigem>,
 *   informacoes?: string, fotosDeBanco?: Array<{ path: string, bytes: Buffer }>,
 *   limites?: { maxArquivos: number, maxBytesPorArquivo: number, maxBytesTotal: number },
 * }} params
 *   `pastaDoCliente`: `<trabalho>/clientes/<pasta>`.
 *   `entrada`: pasta fora do alcance do agente onde a cópia é montada antes
 *   de tomar o lugar da anterior.
 * @returns {Promise<{ arquivos: number, bytes: number, pulados: string[] }>}
 */
export async function copiarMaterial({
  pastaDoCliente,
  entrada,
  arquivos,
  origem,
  informacoes = "",
  fotosDeBanco = [],
  limites = LIMITES_DO_MATERIAL,
}) {
  await fs.mkdir(entrada, { recursive: true });
  const montagem = path.join(entrada, randomBytes(6).toString("hex"));
  await fs.mkdir(montagem, { recursive: true });

  let total = 0;
  let quantos = 0;
  /** @type {string[]} */
  const pulados = [];
  /** Nomes já usados, por pasta — e os das fotos, no material inteiro. */
  const usadosPorPasta = new Map();
  const fotosUsadas = new Set();

  /** O caminho em disco de um item, sempre dentro da montagem. */
  const destinoDe = (pastas, nome) => {
    const dir = pastas.map(nomeSeguro);
    const chave = dir.join("/").toLowerCase();
    if (!usadosPorPasta.has(chave)) usadosPorPasta.set(chave, new Set());
    const usados = usadosPorPasta.get(chave);
    // Duas fotos não podem ter o mesmo nome, nem em pastas diferentes: no site todas vão para a mesma.
    let arquivo = FOTO.test(nome) ? unico(nomeDeFoto(nome), fotosUsadas) : nomeSeguro(nome);
    arquivo = unico(arquivo, usados);
    const absoluto = path.resolve(montagem, ...dir, arquivo);
    if (!absoluto.startsWith(montagem + path.sep)) throw httpError(400, "Caminho fora do material.");
    return absoluto;
  };

  /**
   * Grava um fluxo no destino, contando os bytes contra os dois tetos.
   * @param {import("node:stream").Readable} fonte
   * @param {string} absoluto
   * @param {string} rotulo
   * @param {{ material?: boolean }} [opcoes] `material: false`: um temporário
   *   (o .zip antes de ser aberto), que não conta como arquivo do material
   */
  const gravar = async (fonte, absoluto, rotulo, { material = true } = {}) => {
    await fs.mkdir(path.dirname(absoluto), { recursive: true });
    let doArquivo = 0;
    const teto = new Transform({
      transform(pedaco, _codificacao, pronto) {
        doArquivo += pedaco.length;
        if (material) total += pedaco.length;
        if (doArquivo > limites.maxBytesPorArquivo) {
          pronto(httpError(413, `"${rotulo}" passa de ${megas(limites.maxBytesPorArquivo)}.`));
        } else if (total > limites.maxBytesTotal) {
          pronto(httpError(413, `O material passa de ${megas(limites.maxBytesTotal)}. Desmarque alguns arquivos.`));
        } else pronto(null, pedaco);
      },
    });
    await pipeline(fonte, teto, createWriteStream(absoluto));
    if (!material) return;
    quantos += 1;
    if (quantos > limites.maxArquivos) {
      throw httpError(
        413,
        `O material passa de ${limites.maxArquivos} arquivos (contando o que há dentro dos .zip). Desmarque alguns.`,
      );
    }
  };

  /**
   * Um Word, Excel ou PowerPoint já em disco: grava o texto dele num .txt e
   * as imagens embutidas numa pasta ao lado. O agente não abre o original.
   * Devolve `false` quando não deu para abrir o documento.
   */
  const gravarEscritorio = async (documento, pastas, nome, rotulo) => {
    let aberto;
    try {
      aberto = await abrirEscritorio(documento, nome);
    } catch {
      return false;
    }
    if (!aberto.texto && !aberto.imagens.length) {
      pulados.push(`${rotulo}: o documento está vazio, ou o painel não achou texto nele.`);
      return true;
    }
    if (aberto.texto) {
      await gravar(
        Readable.from([Buffer.from(`Texto extraído pelo painel de "${nome}".

${aberto.texto}
`, "utf8")]),
        destinoDe(pastas, `${nome}.txt`),
        rotulo,
      );
    }
    const pastaDasImagens = `${path.basename(nome, path.extname(nome))}-imagens`;
    for (const imagem of aberto.imagens) {
      if (imagem.size > limites.maxBytesPorArquivo) continue;
      await gravar(imagem.abrir(), destinoDe([...pastas, pastaDasImagens], imagem.nome), `${rotulo} › ${imagem.nome}`);
    }
    return true;
  };

  /** Desce um fluxo para um temporário, que não conta como material, e o entrega à função. */
  const comTemporario = async (fonte, rotulo, usar) => {
    const temporario = path.join(entrada, `tmp-${randomBytes(6).toString("hex")}`);
    try {
      await gravar(fonte, temporario, rotulo, { material: false });
      return await usar(temporario);
    } finally {
      await fs.rm(temporario, { force: true });
    }
  };

  /** Abre um .zip já em disco e grava o que o agente consegue ler. */
  const abrirZip = async (zip, pastas, nomeDoZip) => {
    const { size } = await fs.stat(zip);
    const { entries, truncated } = await readZipDirectory(size, (inicio, fim) => readRange(zip, inicio, fim));
    if (truncated) pulados.push(`${nomeDoZip}: tem arquivos demais; só os primeiros foram abertos.`);
    const raiz = [...pastas, path.basename(nomeDoZip, path.extname(nomeDoZip))];
    for (const item of entries) {
      const partes = item.path.split("/");
      const nome = /** @type {string} */ (partes.pop());
      const tipo = kindOf(mimeOfName(nome), nome);
      const motivo =
        unreadableReason(item) ??
        (NOMES[tipo] ? NOMES[tipo] : null) ??
        (tipo === "archive" ? "Compactado dentro de compactado não é aberto." : null) ??
        (item.size > limites.maxBytesPorArquivo
          ? `Acima do limite de ${megas(limites.maxBytesPorArquivo)}.`
          : null);
      if (motivo) {
        pulados.push(`${nomeDoZip} › ${item.path}: ${motivo}`);
        continue;
      }
      const abrirItem = () => entryContent(createReadStream(zip, { start: item.offset, end: item.end - 1 }), item);
      const rotulo = `${nomeDoZip} › ${item.path}`;
      if (
        ESCRITORIO_ABERTO.test(nome) &&
        (await comTemporario(abrirItem(), rotulo, (documento) => gravarEscritorio(documento, [...raiz, ...partes], nome, rotulo)))
      ) {
        continue;
      }
      await gravar(abrirItem(), destinoDe([...raiz, ...partes], nome), rotulo);
    }
  };

  try {
    if (informacoes.trim()) {
      await gravar(
        Readable.from([Buffer.from(`${informacoes.trim()}\n`, "utf8")]),
        destinoDe([], ARQUIVO_DAS_INFORMACOES),
        ARQUIVO_DAS_INFORMACOES,
      );
    }

    for (const arquivo of arquivos) {
      const fonte = origem.get(arquivo.id);
      if (!fonte) throw httpError(400, "Arquivo selecionado não é deste projeto");
      if (arquivo.kind === "archive") {
        // O zip desce inteiro para um temporário, é aberto e sai. O compactado
        // em si não é material: só o que há dentro dele conta.
        const temporario = path.join(entrada, `zip-${randomBytes(6).toString("hex")}`);
        try {
          await gravar(await fonte.abrir(), temporario, arquivo.name, { material: false });
          await abrirZip(temporario, fonte.trail, arquivo.name);
        } finally {
          await fs.rm(temporario, { force: true });
        }
        continue;
      }
      if (
        !arquivo.exportedToPdf &&
        ESCRITORIO_ABERTO.test(arquivo.name) &&
        (await comTemporario(await fonte.abrir(), arquivo.name, (documento) =>
          gravarEscritorio(documento, fonte.trail, arquivo.name, arquivo.name),
        ))
      ) {
        continue;
      }
      // Documento que o painel não conseguiu abrir segue como está, e o original fica para a pessoa conferir.
      await gravar(await fonte.abrir(), destinoDe(fonte.trail, arquivo.uploadName), arquivo.name);
    }

    for (const foto of fotosDeBanco) {
      const partes = foto.path.split("/");
      const nome = /** @type {string} */ (partes.pop());
      await gravar(
        Readable.from([foto.bytes]),
        destinoDe([PASTA_DAS_FOTOS_DE_BANCO, ...partes], nome),
        nome,
      );
    }

    await fs.mkdir(pastaDoCliente, { recursive: true });
    const material = path.join(pastaDoCliente, "material");
    await fs.rm(material, { recursive: true, force: true, maxRetries: 3 });
    await renameWithRetry(montagem, material);
  } catch (erro) {
    await fs.rm(montagem, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    throw erro;
  }

  return { arquivos: quantos, bytes: total, pulados };
}
