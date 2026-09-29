import { Router } from "express";
import { cached, invalidate } from "../cache.js";
import {
  GOOGLE_NATIVE_PDF,
  getAccessToken,
  getFileMeta,
  kindOf,
  listFolderChildren,
  previewKindOf,
  rememberInsideDriveRoot,
  streamFile,
} from "../drive.js";
import {
  allowSameOriginFraming,
  safeInlineContentType,
} from "../security/embedded-asset.js";
import { driveScoped } from "./drive-scoped.js";
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
