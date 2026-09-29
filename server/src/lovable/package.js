import { config } from "../config.js";
import { loadBrief } from "../brief.js";
import { GOOGLE_NATIVE_PDF, kindOf, walkProjectFiles } from "../drive.js";
import { httpError } from "../http.js";
import { listSignatureFiles, SIGNATURE_VARIANTS } from "./signature.js";

/**
 * O que seria enviado ao Lovable: o prompt do briefing, os arquivos do projeto
 * classificados e a validação da seleção. Só lê o Drive — nada aqui chama o
 * Lovable nem consome crédito.
 */

/** Limite do `initial_message` no schema do Lovable. */
const MAX_PROMPT_CHARS = 100_000;

/**
 * Só a pasta é impossível de anexar — ela não tem bytes para subir.
 *
 * Vídeo, áudio e compactado estavam nesta lista por decisão do painel, não por
 * limite da API. Medido contra o Lovable: `get_file_upload_url` emite URL
 * assinada para `video/mp4`, `video/quicktime`, `application/zip`,
 * `application/vnd.rar` e `audio/mpeg`, o PUT do conteúdo devolve 200 nos três
 * testados, e o schema de `files` em `create_project` não restringe
 * `mime_type`. Então o transporte funciona e a escolha volta a ser do operador.
 */
const NEVER_ATTACH = new Set(["folder"]);

/**
 * Marcados de saída: o material visual. O compactado entra porque é como se
 * mandam mais imagens do que o limite de anexos — as fotos do cliente
 * costumam vir num `.zip`, e sem ele o site nasceria sem nenhuma.
 */
const PRESELECT = new Set(["image", "archive"]);

/**
 * Tipos que sobem, mas com ressalva. O que **não** foi possível verificar sem
 * gastar crédito é se o modelo do Lovable extrai algo de um vídeo ou abre um
 * compactado — só que o upload é aceito. O aviso diz isso em vez de prometer.
 */
const ATTACH_WARNINGS = {
  video:
    "O upload é aceito, mas não há garantia de que o Lovable aproveite o conteúdo do vídeo — e ele consome boa parte do limite de anexos.",
  audio:
    "O upload é aceito, mas não há garantia de que o Lovable aproveite o conteúdo do áudio.",
  archive:
    "Vai como está: é o caminho para mandar mais imagens que o limite de anexos. O painel não confere o que há dentro.",
};

const kindNames = {
  video: "Vídeo",
  audio: "Áudio",
  archive: "Arquivo compactado",
  folder: "Pasta",
};

export const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

/** Como o arquivo chega no Lovable — nativos do Google viram PDF na exportação. */
export function uploadShape(file) {
  if (GOOGLE_NATIVE_PDF.has(file.mimeType)) {
    return { name: `${file.name}.pdf`, contentType: "application/pdf" };
  }
  return { name: file.name, contentType: file.mimeType };
}

/**
 * Assinatura antiga guardada na pasta do cliente ("Rodapé Escuro.png",
 * "Rodapé Joinvix.png"). O painel já anexa a oficial, do joinvix-footer, em
 * todo site; marcada junto, o Lovable recebia duas artes diferentes com o
 * mesmo papel.
 *
 * @param {string} name
 */
export const isOldSignatureFile = (name) =>
  /^rodap[eé](?![a-z])/i.test(name.normalize("NFC").trim());

function describe(file, briefId) {
  const kind = kindOf(file.mimeType, file.name);
  const isBrief = file.id === briefId;
  const upload = uploadShape(file);

  // Nativo do Google: o `size` do Drive é do documento, não do PDF exportado —
  // num caso real, 15 KB de Doc viraram 160 KB de PDF. Mostrar aquele número
  // seria mentir sobre o que vai subir, então fica sem tamanho até exportar.
  const size = upload.name !== file.name
    ? null
    : file.size
      ? Number(file.size)
      : null;

  let blockedReason = null;
  if (NEVER_ATTACH.has(kind)) {
    blockedReason = `${kindNames[kind] ?? "Este tipo"} não serve como anexo de prompt`;
  } else if (size && size > config.lovable.maxAttachmentBytes) {
    blockedReason = `Acima do limite de ${formatBytes(config.lovable.maxAttachmentBytes)}`;
  }

  return {
    id: file.id,
    name: file.name,
    folder: file.trail.join(" / ") || null,
    mimeType: file.mimeType,
    kind,
    size,
    // Ressalva, não impedimento: o arquivo pode ser anexado.
    attachWarning: blockedReason
      ? null
      : isOldSignatureFile(file.name)
        ? "Assinatura antiga da pasta: a oficial já vai em todo site. Marque só se quiser mandar as duas."
        : (ATTACH_WARNINGS[kind] ?? null),
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
    hasThumbnail: Boolean(file.thumbnailLink),
    uploadName: upload.name,
    exportedToPdf: upload.name !== file.name,
    isBrief,
    blockedReason,
    // O briefing já vai por inteiro no texto do prompt: anexá-lo seria repetir.
    recommended:
      !blockedReason && !isBrief && PRESELECT.has(kind) && !isOldSignatureFile(file.name),
  };
}

/** Por que a geração está (ou não está) liberada neste servidor. */
export function generationGate() {
  if (config.lovable.enableGeneration) {
    return { enabled: true, reason: null };
  }
  return {
    enabled: false,
    reason:
      "A geração está desligada. Ligue “Liberar gasto de crédito no Lovable” em " +
      "Configurações → Geração de sites e reinicie o painel (ela gasta crédito do Lovable).",
  };
}

/**
 * Tudo que a tela de geração precisa: o prompt do briefing e os arquivos do
 * projeto já classificados. Lê apenas o Drive — nunca chama o Lovable.
 */
export async function buildPackage(projectId, { refresh = false } = {}) {
  const [brief, files, signature] = await Promise.all([
    loadBrief(projectId, { refresh }),
    walkProjectFiles(projectId),
    listSignatureFiles(),
  ]);

  const briefId = brief.found ? brief.file.id : null;
  const described = files
    .map((file) => describe(file, briefId))
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
    );

  return {
    prompt: brief.found
      ? { found: true, text: brief.text, file: brief.file, others: brief.others }
      : { found: false, text: "", file: null, others: 0 },
    files: described,
    limits: {
      maxPromptChars: MAX_PROMPT_CHARS,
      maxAttachments: config.lovable.maxAttachments,
      maxAttachmentBytes: config.lovable.maxAttachmentBytes,
    },
    generation: generationGate(),
    // Vai em toda geração, fora da seleção: a tela só mostra o que falta.
    signature: {
      files: signature.map((file) => file.name),
      missing: SIGNATURE_VARIANTS.map(({ variant }) => variant).filter(
        (variant) => !signature.some((file) => file.variant === variant),
      ),
    },
  };
}

/** Valida a seleção contra o projeto e devolve o plano do que seria enviado. */
export async function planFor(projectId, prompt, fileIds) {
  const pkg = await buildPackage(projectId);
  const text = String(prompt ?? "").trim();

  if (!text) throw httpError(400, "O prompt está vazio");
  if (text.length > MAX_PROMPT_CHARS) {
    throw httpError(
      400,
      `O prompt tem ${text.length.toLocaleString("pt-BR")} caracteres — o limite do Lovable é ${MAX_PROMPT_CHARS.toLocaleString("pt-BR")}`,
    );
  }

  const byId = new Map(pkg.files.map((file) => [file.id, file]));
  const unique = [...new Set(fileIds ?? [])];

  if (unique.length > config.lovable.maxAttachments) {
    throw httpError(
      400,
      `Selecione no máximo ${config.lovable.maxAttachments} anexos`,
    );
  }

  const attachments = unique.map((id) => {
    const file = byId.get(id);
    // Só aceita id que veio da varredura deste projeto: fecha a porta para
    // usar o painel como ponte para qualquer arquivo do Drive.
    if (!file) throw httpError(400, "Arquivo selecionado não é deste projeto");
    if (file.blockedReason) {
      throw httpError(400, `"${file.name}": ${file.blockedReason}`);
    }
    return file;
  });

  return {
    pkg,
    text,
    attachments,
    plan: {
      promptChars: text.length,
      promptSource: pkg.prompt.file?.name ?? null,
      attachments: attachments.map((file) => ({
        id: file.id,
        name: file.uploadName,
        kind: file.kind,
        size: file.size,
        exportedToPdf: file.exportedToPdf,
      })),
      // Nativos do Google não informam tamanho antes da exportação.
      totalBytes: attachments.reduce((sum, file) => sum + (file.size ?? 0), 0),
      unknownSizes: attachments.filter((file) => file.size === null).length,
    },
  };
}

/**
 * Ensaio: valida a seleção e mostra exatamente o que seria enviado, sem tocar
 * no Lovable. Nenhum crédito é consumido aqui.
 */
export async function previewGeneration(projectId, { prompt, fileIds }) {
  const { plan, pkg } = await planFor(projectId, prompt, fileIds);
  return { dryRun: true, plan, generation: pkg.generation };
}
