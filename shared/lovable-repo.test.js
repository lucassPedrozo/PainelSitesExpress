import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidRepoName } from "./lovable-repo.js";

describe("nome de repositório novo", () => {
  it("aceita letras, números, ponto, hífen e sublinhado, até 100 caracteres", () => {
    for (const nome of ["site", "meu-site.com.br", "Site_2", "a".repeat(100)]) {
      assert.equal(isValidRepoName(nome), true, nome);
    }
  });

  it("recusa o que a API do GitHub recusaria, inclusive o sufixo .git", () => {
    for (const nome of ["site.git", ".oculto", "-traço", "com espaço", "a".repeat(101), ""]) {
      assert.equal(isValidRepoName(nome), false, nome);
    }
  });
});
