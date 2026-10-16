import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { siteOfOtherCollections } from "./projects-helpers.js";

describe("siteOfOtherCollections", () => {
  const pastas = [
    { id: "antiga", name: "[04/09/2026] cliente.com.br" },
    { id: "nova", name: "[08/09/2026] cliente.com.br" },
    { id: "outra", name: "[10/09/2026] outro.com.br" },
    { id: "sem-dominio", name: "Pasta solta" },
  ];
  const dominios = ["cliente.com.br", "cliente.com.br", "outro.com.br", null];

  it("a coleta sem site recebe o site da outra coleta do mesmo domínio", () => {
    const site = { id: "lov-1", createdAt: "2026-09-08T10:00:00.000Z" };
    const r = siteOfOtherCollections(pastas, dominios, { nova: [site] });
    assert.deepEqual(r[0], { projectId: "nova", projectName: pastas[1].name, site });
    // A que tem o site não aponta para si mesma; domínios sem site, nada.
    assert.deepEqual(r.slice(1), [null, null, null]);
  });

  it("com site nas duas, nenhuma aponta para a outra", () => {
    const r = siteOfOtherCollections(pastas, dominios, {
      antiga: [{ id: "a", createdAt: "2026-09-04" }],
      nova: [{ id: "b", createdAt: "2026-09-08" }],
    });
    assert.deepEqual(r, [null, null, null, null]);
  });

  it("entre várias coletas com site, vale o site mais recente", () => {
    const tres = [...pastas.slice(0, 2), { id: "terceira", name: "[12/09/2026] cliente.com.br" }];
    const r = siteOfOtherCollections(tres, ["cliente.com.br", "cliente.com.br", "cliente.com.br"], {
      nova: [{ id: "velho", createdAt: "2026-09-08" }],
      terceira: [{ id: "recente", createdAt: "2026-09-12" }],
    });
    assert.equal(r[0]?.site.id, "recente");
  });
});
