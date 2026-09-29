import fs from "node:fs/promises";
import { config } from "../config.js";
import { streamFile } from "../drive.js";
import { httpError } from "../http.js";
import { callTool } from "./mcp.js";
import { formatBytes, uploadShape } from "./package.js";

/** Upload de até 64 MB direto para o storage do Lovable. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** Lê o arquivo do Drive respeitando o teto — nativos do Google saem em PDF. */
async function readBytes(file) {
  const stream = await streamFile(file.id, file.mimeType);
  const limit = config.lovable.maxAttachmentBytes;
  const chunks = [];
  let total = 0;

  for await (const chunk of stream.data) {
    total += chunk.length;
    if (total > limit) {
      stream.data.destroy();
      throw httpError(
        413,
        `"${file.name}" passou de ${formatBytes(limit)} durante a leitura`,
      );
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Põe bytes no storage do Lovable. `get_file_upload_url` é gratuita; o PUT vai
 * direto para o storage, sem passar pelo agente.
 *
 * O outputSchema da tool é `{ file_id, url, headers }` — o campo é `url`, e os
 * `headers` devolvidos precisam ir no PUT junto (a URL pré-assinada é assinada
 * contando com eles).
 */
async function putToLovable({ label, uploadName, contentType, readBytes: read }) {
  const slot = await callTool("get_file_upload_url", {
    file_name: uploadName,
    content_type: contentType,
  });

  const uploadUrl = slot?.url;
  const fileId = slot?.file_id;
  if (!uploadUrl || !fileId) {
    throw httpError(502, `O Lovable não devolveu a URL de upload de "${label}"`);
  }

  const bytes = await read();
  const res = await fetch(uploadUrl, {
    method: "PUT",
    // Os headers assinados vêm depois: se repetirem o Content-Type, o do
    // Lovable é que vale.
    headers: { "Content-Type": contentType, ...(slot.headers ?? {}) },
    body: bytes,
    // Upload falho não custa crédito (acontece antes do `create_project`),
    // mas sem teto uma conexão presa deixava a geração pendurada.
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  }).catch((err) => {
    throw httpError(
      504,
      err?.name === "TimeoutError"
        ? `O upload de "${label}" não terminou dentro do tempo limite`
        : `Não foi possível enviar "${label}" ao Lovable`,
    );
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpError(
      502,
      `Upload de "${label}" falhou (${res.status}) ${detail.slice(0, 200)}`.trim(),
    );
  }

  return { fileId, name: uploadName, mimeType: contentType, bytes: bytes.length };
}

/** Sobe um anexo do Drive. */
export function uploadAttachment(file) {
  const { contentType } = uploadShape(file);
  return putToLovable({
    label: file.name,
    uploadName: file.uploadName,
    contentType,
    readBytes: () => readBytes(file),
  });
}

/** Sobe uma imagem da assinatura Joinvix, guardada no próprio painel. */
export function uploadSignature(file) {
  return putToLovable({
    label: file.name,
    uploadName: file.name,
    contentType: file.contentType,
    readBytes: () => fs.readFile(file.path),
  });
}
