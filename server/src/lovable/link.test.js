import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isExternalSite, parseLovableProject, parseRepository, planLink } from "./link.js";
import { resetRuntimeConfig } from "../config.js";
import { joinsAutomatically } from "../devarea/service.js";

const ID = "00000000-0000-4000-8000-00000000abcd";
let orgAntes;

beforeEach(() => {
  orgAntes = process.env.GITHUB_ORG;
  process.env.GITHUB_ORG = "Sites-profissionais";
  resetRuntimeConfig();
});
afterEach(() => {
  if (orgAntes === undefined) delete process.env.GITHUB_ORG;
  else process.env.GITHUB_ORG = orgAntes;
  resetRuntimeConfig();
});

describe("parseLovableProject", () => {
  it("aceita o editor, o preview e o id puro", () => {
    assert.equal(parseLovableProject(`https://lovable.dev/projects/${ID}`), ID);
    assert.equal(parseLovableProject(`https://lovable.dev/projects/${ID}?tab=code`), ID);
    assert.equal(parseLovableProject(`https://id-preview--${ID}.lovable.app/`), ID);
    assert.equal(parseLovableProject(`  ${ID.toUpperCase()} `), ID);
  });

  it("recusa endereço de outro site, mesmo com um UUID dentro", () => {
    assert.equal(parseLovableProject(`https://exemplo.com/${ID}`), null);
    assert.equal(parseLovableProject("https://lovable.dev/projects/sem-id"), null);
    assert.equal(parseLovableProject(""), null);
  });
});

describe("parseRepository", () => {
  it("exige organização/nome dentro da organização configurada", () => {
    assert.equal(parseRepository(" Sites-profissionais/briv-site "), "Sites-profissionais/briv-site");
    assert.equal(parseRepository(""), null);
    assert.throws(() => parseRepository("briv-site"), /organização\/nome/);
    assert.throws(() => parseRepository("OutraOrg/briv-site"), /Sites-profissionais/);
  });
});

describe("planLink", () => {
  const org = new Set(["sites-profissionais/briv-site"]);

  it("site só com repositório ganha id próprio e não aponta para o Lovable", () => {
    const plano = planLink({ repoFullName: "Sites-profissionais/briv-site" }, org);
    assert.match(plano.id, /^ext-[0-9a-f]{12}$/);
    assert.equal(plano.url, null);
    assert.equal(plano.state, "ready");
    assert.equal(isExternalSite({ id: plano.id }), true);
  });

  it("projeto do Lovable usa o id de lá", () => {
    const plano = planLink({ lovable: `https://lovable.dev/projects/${ID}`, state: "delivered" });
    assert.equal(plano.id, ID);
    assert.equal(plano.url, `https://lovable.dev/projects/${ID}`);
    assert.equal(plano.repoFullName, null);
    assert.equal(isExternalSite({ id: plano.id }), false);
  });

  it("recusa pedido vazio, link que não é do Lovable e repositório que não existe", () => {
    assert.throws(() => planLink({}), /projeto no Lovable, o repositório/);
    assert.throws(() => planLink({ lovable: "https://exemplo.com/x" }), /não é de um projeto do Lovable/);
    assert.throws(() => planLink({ repoFullName: "Sites-profissionais/outro" }, org), /não foi encontrado/);
  });

  it("no ar exige o repositório que publica no domínio", () => {
    assert.throws(() => planLink({ lovable: ID, state: "live" }), /repositório/);
    assert.equal(planLink({ repoFullName: "Sites-profissionais/briv-site", state: "live" }, org).state, "live");
    assert.throws(() => planLink({ repoFullName: "Sites-profissionais/briv-site", state: "qualquer" }, org), /Estado inválido/);
  });
});

describe("área de aprovação", () => {
  it("site vinculado só entra quando alguém pedir", () => {
    const producao = new Set();
    assert.equal(joinsAutomatically({}, "Org/novo", producao), true);
    assert.equal(joinsAutomatically({ origin: "linked" }, "Org/novo", producao), false);
  });
});
