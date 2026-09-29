import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findDomain, normalizeDomain, parseCollectionName } from "./domain.js";

describe("domínio da coleta", () => {
  it("limpa o que o cliente digitou em volta do domínio", () => {
    for (const typed of [
      "www.site.com.br",
      "Https://site.com.br",
      "https://www.site.com.br/",
      "*site.com.br*",
      "- site.com.br",
      "SITE.COM.BR",
    ]) {
      assert.deepEqual(findDomain(typed), { domain: "site.com.br", exact: true }, typed);
    }
  });

  it("e-mail e texto sem ponto não são domínio", () => {
    assert.equal(findDomain("fulano@gmail.com"), null);
    assert.equal(findDomain("Cliente Sem Dominio"), null);
    assert.equal(findDomain("Abcreformasepinturascombr"), null);
  });

  it("acha o primeiro domínio, mas não reescreve o texto com mais coisa", () => {
    assert.deepEqual(
      findDomain("tresmares.com.br (principal) e www.3mares.com.br"),
      { domain: "tresmares.com.br", exact: false },
    );
  });

  it("com e sem www casam na comparação", () => {
    assert.equal(normalizeDomain("www.pergolado.com.br"), normalizeDomain("pergolado.com.br"));
  });

  it("separa data, domínio e o nome a exibir", () => {
    assert.deepEqual(parseCollectionName("[08/09/2026] *laranjeira.com.br*"), {
      label: "laranjeira.com.br",
      domain: "laranjeira.com.br",
      collected: { day: 8, month: 9, year: 2026 },
    });
    assert.deepEqual(parseCollectionName("[17/08/2026] Beltrano@gmail.com"), {
      label: "Beltrano@gmail.com",
      domain: null,
      collected: { day: 17, month: 8, year: 2026 },
    });
    assert.equal(parseCollectionName("Pasta solta").collected, null);
  });
});
