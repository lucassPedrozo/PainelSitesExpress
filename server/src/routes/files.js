import { pipeline } from "node:stream";
import { Router } from "express";
import { entryPreviewKind, mimeOfName } from "../archive/entry-type.js";
import { entryContent, readZipDirectory, unreadableReason } from "../archive/zip-reader.js";
import { cached, invalidate } from "../cache.js";
import {
  GOOGLE_NATIVE_PDF,
  getAccessToken,
  getFileMeta,
  kindOf,
  listFolderChildren,
  previewKindOf,
  readFileRange,
  rememberInsideDriveRoot,
  streamFile,
} from "../drive.js";
import { httpError } from "../http.js";
import {
  allowSameOriginFraming,
  safeInlineContentType,
} from "../security/embedded-asset.js";
import { driveScoped } from "../security/project-scope.js";
import { headerOf, singleByteRange, thumbnailSize } from "./files-helpers.js";

/** Pastas e arquivos do Drive, sempre dentro da pasta raiz das coletas. */
export const filesRouter = Router();

/** Conteúdo de uma pasta (projeto ou subpasta). */
filesRouter.get("/folders/:id/files", driveScoped, async (req, res) => {
  const { id } = req.params;
  if (req.query.refresh === "1") invalidate(`folder:${id}`);

  const files = await cached(`folder:${id}`, async () => {
    const children = await listFolderChildren(id);
    return children.map((file) => {
      const kind = kindOf(file.mimeType, file.name);
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        kind,
        previewKind: previewKindOf(file.mimeType, kind),
        size: file.size ? Number(file.size) : null,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        webViewLink: file.webViewLink,
        webContentLink: file.webContentLink ?? null,
        hasThumbnail: Boolean(file.thumbnailLink),
        width:
          file.imageMediaMetadata?.width ??
          file.videoMediaMetadata?.width ??
          null,
        height:
          file.imageMediaMetadata?.height ??
          file.videoMediaMetadata?.height ??
          null,
      };
    });
  });

  rememberInsideDriveRoot(files.map((file) => file.id));
  res.json({ files });
});

/** Miniatura do arquivo — proxy autenticado (o link do Drive exige token). */
filesRouter.get("/files/:id/thumbnail", driveScoped, async (req, res) => {
  const size = thumbnailSize(req.query.size);
  const meta = await cached(`meta:${req.params.id}`, () =>
    getFileMeta(req.params.id),
  );

  if (!meta.thumbnailLink) return res.status(404).end();

  const url = meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });

  if (!upstream.ok) return res.status(upstream.status).end();

  allowSameOriginFraming(res);
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") ?? "image/jpeg",
  );
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(Buffer.from(await upstream.arrayBuffer()));
});

/** Conteúdo bruto do arquivo — usado no preview (imagem, pdf, vídeo). */
filesRouter.get("/files/:id/raw", driveScoped, async (req, res) => {
  const id = String(req.params.id);
  const meta = await cached(`meta:${id}`, () => getFileMeta(id));
  const isNative = GOOGLE_NATIVE_PDF.has(meta.mimeType);
  const range = isNative ? undefined : singleByteRange(req.headers.range);
  const upstream = await streamFile(id, meta.mimeType, { range });
  const fileName = isNative ? `${meta.name}.pdf` : meta.name;
  const download = req.query.download === "1";

  allowSameOriginFraming(res);
  res.setHeader(
    "Content-Type",
    isNative
      ? "application/pdf"
      : safeInlineContentType(meta.mimeType, { download }),
  );
  res.setHeader("Cache-Control", "private, max-age=600");
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );

  // Sem `Accept-Ranges` e sem o 206, o `<video>` não conseguia avançar: cada
  // salto recomeçava do zero e baixava o arquivo inteiro de novo.
  if (!isNative) {
    res.setHeader("Accept-Ranges", "bytes");
    const contentLength = headerOf(upstream.headers, "content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const contentRange = headerOf(upstream.headers, "content-range");
    if (range && upstream.status === 206 && contentRange) {
      res.status(206).setHeader("Content-Range", contentRange);
    }
  }

  upstream.data.on("error", () => res.destroy()).pipe(res);
});

/* ------------------------------------------------------------------ *
 * Dentro de um .zip
 *
 * As fotos do cliente costumam vir compactadas, e o painel só mostrava o
 * arquivo fechado. Aqui ele lista o conteúdo e abre cada item lendo do Drive
 * apenas o índice e o trecho pedido — ver `archive/zip-reader.js`.
 * ------------------------------------------------------------------ */

/** O índice do zip, guardado pelo mesmo prazo das pastas. */
const zipDirectoryOf = (id) =>
  cached(`zip:${id}`, async () => {
    const meta = await cached(`meta:${id}`, () => getFileMeta(id));
    const directory = await readZipDirectory(Number(meta.size ?? 0), (start, end) =>
      readFileRange(id, start, end),
    );
    return { ...directory, mimeType: meta.mimeType };
  });

/** O que há dentro do zip: caminho, tamanho, data e como cada item abre. */
filesRouter.get("/files/:id/archive", driveScoped, async (req, res) => {
  const id = String(req.params.id);
  if (req.query.refresh === "1") {
    invalidate(`zip:${id}`);
    invalidate(`meta:${id}`);
  }

  const { entries, total, truncated } = await zipDirectoryOf(id);
  res.json({
    total,
    truncated,
    entries: entries.map((entry, index) => {
      const mimeType = mimeOfName(entry.path);
      const blocked = unreadableReason(entry);
      return {
        index,
        path: entry.path,
        size: entry.size,
        modifiedTime: entry.modifiedTime,
        mimeType,
        kind: kindOf(mimeType, entry.path),
        previewKind: blocked ? "none" : entryPreviewKind(mimeType),
        // Com senha ou compressão que o painel não lê: nem o download sai.
        blocked,
      };
    }),
  });
});

/** Um arquivo de dentro do zip, descomprimido conforme sai do Drive. */
filesRouter.get("/files/:id/archive/:index", driveScoped, async (req, res) => {
  const id = String(req.params.id);
  const directory = await zipDirectoryOf(id);
  const entry = /^\d+$/.test(String(req.params.index))
    ? directory.entries[Number(req.params.index)]
    : undefined;
  if (!entry) throw httpError(404, "Arquivo não encontrado dentro do compactado.");

  const blocked = unreadableReason(entry);
  if (blocked) throw httpError(422, blocked);

  const upstream = await streamFile(id, directory.mimeType, {
    range: `bytes=${entry.offset}-${entry.end - 1}`,
  });
  const download = req.query.download === "1";
  const fileName = entry.path.split("/").pop() ?? "arquivo";

  // O mesmo cuidado do conteúdo solto do Drive: é arquivo de terceiro servido
  // na origem do painel.
  allowSameOriginFraming(res);
  res.setHeader(
    "Content-Type",
    safeInlineContentType(mimeOfName(entry.path), { download }),
  );
  res.setHeader("Cache-Control", "private, max-age=600");
  res.setHeader("Content-Length", String(entry.size));
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );

  // Uma falha no meio (zip corrompido, Drive caiu) já pegou a resposta em
  // curso: resta derrubá-la, para o navegador não tomar o pedaço por inteiro.
  pipeline(entryContent(upstream.data, entry), res, (err) => {
    if (err) res.destroy();
  });
});
