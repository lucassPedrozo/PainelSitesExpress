import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeFolderFiles } from "./drive.js";

/**
 * As métricas de uma coleta do Drive: o que conta como arquivo, como o volume
 * soma, quando foi a última atividade e onde mora o briefing.
 */

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";

const item = (name, mimeType, { size, created, modified } = {}) => ({
  id: `id-${name}`,
  name,
  mimeType,
  size: size === undefined ? undefined : String(size),
  createdTime: created,
  modifiedTime: modified ?? created,
});

describe("métricas da coleta", () => {
  it("conta os arquivos das subpastas, e não só os da raiz", () => {
    const raiz = [
      item("Fotos", FOLDER, { created: "2026-10-10T10:00:00.000Z" }),
      item("logo.png", "image/png", { size: 1000, created: "2026-10-10T10:01:00.000Z" }),
    ];
    const dentro = [
      item("Fachada", FOLDER, { created: "2026-10-10T10:02:00.000Z" }),
      item("a.jpg", "image/jpeg", { size: 2000, created: "2026-10-10T10:03:00.000Z" }),
      item("b.jpg", "image/jpeg", { size: 3000, created: "2026-10-10T10:04:00.000Z" }),
      item("cardapio.pdf", "application/pdf", { size: 500, created: "2026-10-10T10:05:00.000Z" }),
    ];
    const stats = summarizeFolderFiles(raiz, dentro);
    assert.equal(stats.fileCount, 4);
    assert.equal(stats.folderCount, 2);
    assert.equal(stats.size, 6500);
    assert.deepEqual(stats.kinds, { image: 3, pdf: 1 });
  });

  it("coleta com tudo dentro de uma subpasta não é pasta vazia", () => {
    const stats = summarizeFolderFiles(
      [item("Material", FOLDER, { created: "2026-10-10T10:00:00.000Z" })],
      [item("foto.jpg", "image/jpeg", { size: 10, created: "2026-10-10T10:01:00.000Z" })],
    );
    assert.equal(stats.fileCount, 1);
  });

  it("a última atividade é quando o arquivo entrou, não a data dele no computador do cliente", () => {
    const stats = summarizeFolderFiles([
      // Enviado hoje, com a data do arquivo de três anos atrás…
      item("antiga.jpg", "image/jpeg", { size: 1, created: "2026-10-14T09:00:00.000Z", modified: "2023-05-02T12:00:00.000Z" }),
      // …e outro com o relógio do computador do cliente adiantado.
      item("adiantada.jpg", "image/jpeg", { size: 1, created: "2026-10-13T09:00:00.000Z", modified: "2027-01-01T00:00:00.000Z" }),
    ]);
    assert.equal(stats.lastActivity, "2026-10-14T09:00:00.000Z");
    assert.equal(stats.lastAdded, "2026-10-14T09:00:00.000Z");
  });

  it("um documento do Google editado no Drive conta pela edição", () => {
    const stats = summarizeFolderFiles([
      item("Informações do Site - aurora.eng.br", DOC, { created: "2026-10-10T10:00:00.000Z", modified: "2026-10-12T15:30:00.000Z" }),
      item("foto.jpg", "image/jpeg", { size: 1, created: "2026-10-11T10:00:00.000Z" }),
    ]);
    assert.equal(stats.lastActivity, "2026-10-12T15:30:00.000Z");
    // Entrar na pasta é outra coisa: o último item a chegar foi a foto.
    assert.equal(stats.lastAdded, "2026-10-11T10:00:00.000Z");
  });

  it("o briefing é o da raiz; um homônimo numa subpasta não conta", () => {
    const stats = summarizeFolderFiles(
      [item("Informações do Site - aurora.eng.br", DOC, { created: "2026-10-10T10:00:00.000Z" })],
      [item("Informações do Site - rascunho", DOC, { created: "2026-10-11T10:00:00.000Z" })],
    );
    assert.equal(stats.brief?.name, "Informações do Site - aurora.eng.br");
    assert.equal(stats.brief?.count, 1);
  });

  it("pasta vazia: zeros e nenhuma data", () => {
    const stats = summarizeFolderFiles([]);
    assert.deepEqual(
      [stats.fileCount, stats.folderCount, stats.size, stats.lastActivity, stats.lastAdded, stats.brief],
      [0, 0, 0, null, null, null],
    );
  });
});
