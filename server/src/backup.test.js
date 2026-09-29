import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupsParaRemover, MAX_BACKUPS, nomeDoDia } from "./backup.js";

describe("backupsParaRemover", () => {
  const nome = (data) => `tags-${data}.json`;

  it("não remove nada enquanto cabe no limite", () => {
    const nomes = ["2026-09-01", "2026-09-02"].map(nome);
    assert.deepEqual(backupsParaRemover(nomes), []);
  });

  it("remove as cópias mais antigas quando passa do limite", () => {
    const nomes = Array.from({ length: MAX_BACKUPS + 3 }, (_, i) =>
      nome(`2026-09-${String(i + 1).padStart(2, "0")}`),
    );
    const remover = backupsParaRemover(nomes);

    assert.equal(remover.length, 3);
    // As três mais antigas, e nessa ordem.
    assert.deepEqual(remover, [
      nome("2026-09-01"),
      nome("2026-09-02"),
      nome("2026-09-03"),
    ]);
  });

  it("ignora arquivo que não é backup — não apaga o que não reconhece", () => {
    const nomes = [
      nome("2026-09-01"),
      "tags.json",
      "anotacao.txt",
      "tags-rascunho.json",
    ];
    assert.deepEqual(backupsParaRemover(nomes, 0), [nome("2026-09-01")]);
  });

  it("ordena por data, não pela ordem que o disco devolveu", () => {
    const nomes = [nome("2026-09-10"), nome("2026-09-02"), nome("2026-09-07")];
    assert.deepEqual(backupsParaRemover(nomes, 1), [
      nome("2026-09-02"),
      nome("2026-09-07"),
    ]);
  });

  it("lista vazia não quebra", () => {
    assert.deepEqual(backupsParaRemover([]), []);
  });
});

describe("nomeDoDia", () => {
  it("usa a data local, não a de Greenwich", () => {
    // 22h30 do dia 15 no horário local — em UTC-3 já seria dia 16 em Greenwich.
    const noite = new Date(2026, 8, 15, 22, 30);
    assert.equal(nomeDoDia(noite), "painel-2026-09-15.json");
  });

  it("gera nome que a limpeza reconhece como backup", () => {
    const nome = nomeDoDia(new Date(2026, 0, 5, 8, 0));
    assert.equal(nome, "painel-2026-01-05.json");
    assert.deepEqual(backupsParaRemover([nome], 0), [nome]);
  });
});

describe("cópias com o nome antigo do banco", () => {
  it("entram na rotação junto das novas, ordenadas pela data", () => {
    const nomes = [
      "painel-2026-09-18.json",
      "tags-2026-09-16.json",
      "painel-2026-09-17.json",
      "tags-2026-09-15.json",
    ];
    assert.deepEqual(backupsParaRemover(nomes, 2), [
      "tags-2026-09-15.json",
      "tags-2026-09-16.json",
    ]);
  });
});
