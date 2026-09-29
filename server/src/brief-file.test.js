import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBriefFile, pickBrief } from "./brief-file.js";

const arquivo = (name, modifiedTime, mimeType = "application/pdf") => ({
  name,
  modifiedTime,
  mimeType,
});

describe("briefing da pasta", () => {
  it("reconhece o nome com e sem acento, e nunca uma pasta", () => {
    assert.ok(isBriefFile(arquivo("Informações do Site - [a.com.br].pdf")));
    assert.ok(isBriefFile(arquivo("INFORMACOES DO SITE - NAO TENHO")));
    assert.ok(
      !isBriefFile(
        arquivo("Informações do Site", "", "application/vnd.google-apps.folder"),
      ),
    );
    assert.ok(!isBriefFile(arquivo("Analise do Brifing.pdf")));
  });

  it("com dois briefings, vale o mais recente — e a contagem avisa", () => {
    const { file, count } = pickBrief([
      arquivo("Informações do Site - [www.a.com.br].pdf", "2026-09-22T14:49:00Z"),
      arquivo("Analise do Brifing.pdf", "2026-09-22T15:00:00Z"),
      arquivo("Informações do Site - [a.com.br].pdf", "2026-09-22T14:50:00Z"),
    ]);
    assert.equal(file?.name, "Informações do Site - [a.com.br].pdf");
    assert.equal(count, 2);
  });

  it("sem briefing, nada", () => {
    assert.deepEqual(pickBrief([arquivo("logo.png", "")]), { file: null, count: 0 });
  });
});
