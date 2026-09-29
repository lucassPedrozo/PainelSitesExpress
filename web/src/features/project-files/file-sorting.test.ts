import { describe, expect, it } from "vitest";
import type { DriveFile } from "@/lib/api";
import { sortFiles, totalBytes } from "./file-sorting";

const arquivo = (over: Partial<DriveFile> & { name: string }): DriveFile =>
  ({
    id: over.name,
    mimeType: "image/png",
    kind: "image",
    previewKind: "image",
    size: 100,
    createdTime: "2026-09-01T00:00:00.000Z",
    modifiedTime: "2026-09-01T00:00:00.000Z",
    webViewLink: "",
    webContentLink: null,
    hasThumbnail: false,
    width: null,
    height: null,
    ...over,
  }) as DriveFile;

const nomes = (files: DriveFile[]) => files.map((file) => file.name);

describe("sortFiles", () => {
  const pasta = arquivo({ name: "subpasta", kind: "folder", size: null });
  const arquivos = [
    arquivo({ name: "foto 10.png", size: 300, modifiedTime: "2026-09-03T00:00:00.000Z" }),
    arquivo({ name: "foto 2.png", size: 100, modifiedTime: "2026-09-05T00:00:00.000Z" }),
    pasta,
    arquivo({ name: "contrato.pdf", kind: "pdf", size: 200, modifiedTime: "2026-09-01T00:00:00.000Z" }),
  ];

  it("põe pastas antes de tudo, em qualquer ordenação", () => {
    for (const sort of ["name", "size", "modified", "kind"] as const) {
      expect(nomes(sortFiles(arquivos, { query: "", sort, asc: true }))[0]).toBe(
        "subpasta",
      );
      expect(
        nomes(sortFiles(arquivos, { query: "", sort, asc: false }))[0],
      ).toBe("subpasta");
    }
  });

  it("ordena nome por número, não por texto", () => {
    // "foto 10" depois de "foto 2": comparação textual inverteria.
    expect(nomes(sortFiles(arquivos, { query: "", sort: "name", asc: true }))).toEqual([
      "subpasta",
      "contrato.pdf",
      "foto 2.png",
      "foto 10.png",
    ]);
  });

  it("ordena por tamanho e por modificação, nos dois sentidos", () => {
    expect(
      nomes(sortFiles(arquivos, { query: "", sort: "size", asc: false })),
    ).toEqual(["subpasta", "foto 10.png", "contrato.pdf", "foto 2.png"]);

    expect(
      nomes(sortFiles(arquivos, { query: "", sort: "modified", asc: true })),
    ).toEqual(["subpasta", "contrato.pdf", "foto 10.png", "foto 2.png"]);
  });

  it("busca por parte do nome, sem diferenciar maiúsculas", () => {
    expect(nomes(sortFiles(arquivos, { query: "FOTO", sort: "name", asc: true }))).toEqual([
      "foto 2.png",
      "foto 10.png",
    ]);
    expect(sortFiles(arquivos, { query: "  ", sort: "name", asc: true })).toHaveLength(4);
  });

  it("não altera a lista recebida", () => {
    const original = [...arquivos];
    sortFiles(arquivos, { query: "", sort: "size", asc: false });
    expect(arquivos).toEqual(original);
  });
});

describe("totalBytes", () => {
  it("soma ignorando o que não tem tamanho", () => {
    expect(
      totalBytes([
        arquivo({ name: "a", size: 100 }),
        arquivo({ name: "b", size: null }),
        arquivo({ name: "c", size: 50 }),
      ]),
    ).toBe(150);
  });
});
