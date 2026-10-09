import { describe, expect, it } from "vitest";
import type { ArchiveEntry } from "@/lib/api";
import { fileContentUrl, fileThumbnailUrl } from "@/lib/api";
import { archiveChildren, archivePath, isZipFile } from "./archive-entries";

const entrada = (index: number, path: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  index,
  path,
  size: 1000,
  modifiedTime: "2026-09-17T14:30:00.000Z",
  mimeType: "image/jpeg",
  kind: "image",
  previewKind: "image",
  blocked: null,
  ...over,
});

const zip = [
  entrada(0, "logo.png"),
  entrada(1, "fotos/fachada.jpg", { modifiedTime: "2026-09-10T10:00:00.000Z" }),
  entrada(2, "fotos/equipe/ana.jpg", { modifiedTime: "2026-09-20T10:00:00.000Z" }),
  entrada(3, "fotos/equipe/rui.jpg"),
  entrada(4, "textos/sobre.txt", { mimeType: "text/plain", kind: "doc", previewKind: "text" }),
];

describe("archiveChildren", () => {
  it("na raiz, mostra as pastas deduzidas dos caminhos e os arquivos soltos", () => {
    const itens = archiveChildren("zip1", zip, "");

    expect(itens.map((item) => [item.name, item.kind])).toEqual([
      ["fotos", "folder"],
      ["textos", "folder"],
      ["logo.png", "image"],
    ]);
    // Cada pasta aparece uma vez, com a data do item mais recente dentro dela.
    expect(itens[0].modifiedTime).toBe("2026-09-20T10:00:00.000Z");
  });

  it("dentro de uma pasta, mostra só o nível dela", () => {
    expect(archiveChildren("zip1", zip, "fotos").map((item) => item.name)).toEqual([
      "equipe",
      "fachada.jpg",
    ]);
    expect(
      archiveChildren("zip1", zip, archivePath("fotos", "equipe")).map((item) => item.name),
    ).toEqual(["ana.jpg", "rui.jpg"]);
  });

  it("uma pasta de nome parecido não entra na outra", () => {
    const itens = archiveChildren(
      "zip1",
      [entrada(0, "fotos/a.jpg"), entrada(1, "fotos-antigas/b.jpg")],
      "fotos",
    );
    expect(itens.map((item) => item.name)).toEqual(["a.jpg"]);
  });

  it("o conteúdo e a miniatura do item vêm da rota do zip", () => {
    const [foto] = archiveChildren("zip1", [entrada(7, "foto.jpg")], "");

    expect(foto.hasThumbnail).toBe(true);
    expect(fileContentUrl(foto)).toBe("/api/files/zip1/archive/7");
    expect(fileContentUrl(foto, true)).toBe("/api/files/zip1/archive/7?download=1");
    expect(fileThumbnailUrl(foto)).toBe("/api/files/zip1/archive/7");
  });

  it("imagem pesada e arquivo que não abre ficam sem miniatura", () => {
    const [pesada, heic] = archiveChildren(
      "zip1",
      [
        entrada(0, "banner.jpg", { size: 9 * 1024 * 1024 }),
        entrada(1, "celular.heic", { mimeType: "image/heic", previewKind: "none" }),
      ],
      "",
    );
    expect(pesada.hasThumbnail).toBe(false);
    expect(heic.hasThumbnail).toBe(false);
  });
});

describe("isZipFile", () => {
  it("reconhece pelo nome ou pelo tipo, e só fora de outro zip", () => {
    expect(isZipFile({ name: "Fotos.ZIP", mimeType: "application/octet-stream" })).toBe(true);
    expect(isZipFile({ name: "fotos", mimeType: "application/x-zip-compressed" })).toBe(true);
    expect(isZipFile({ name: "fotos.rar", mimeType: "application/vnd.rar" })).toBe(false);
    expect(
      isZipFile({
        name: "dentro.zip",
        mimeType: "application/octet-stream",
        archive: { fileId: "zip1", index: 0 },
      }),
    ).toBe(false);
  });
});
