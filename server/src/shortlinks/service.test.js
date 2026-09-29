import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShortlinkConfirmationRequired } from "./mcp.js";
import {
  chooseShortLink,
  linksFromListResponse,
  shortLinkPath,
  slugifyShortlink,
  updateWithConfirmation,
} from "./service.js";

describe("slugifyShortlink", () => {
  it("transforma o domínio do projeto no slug do link", () => {
    assert.equal(slugifyShortlink("www.aurora.eng.br"), "aurora-eng-br");
    assert.equal(slugifyShortlink("https://meu-site.com.br/"), "meu-site-com-br");
  });

  it("resolve acentos, porque o nome da pasta vem do cliente", () => {
    assert.equal(slugifyShortlink("Espaço Nutri Vida"), "espaco-nutri-vida");
    assert.equal(slugifyShortlink("ÁÉÍÓÚ ção"), "aeiou-cao");
  });

  it("não deixa hífen sobrando nas pontas", () => {
    assert.equal(slugifyShortlink("  --oi--  "), "oi");
    assert.equal(slugifyShortlink("!!!"), "");
  });

  it("corta em 60 caracteres sem terminar em hífen", () => {
    const slug = slugifyShortlink("a".repeat(50) + " " + "b".repeat(30));
    assert.ok(slug.length <= 60, `slug tem ${slug.length}`);
    assert.ok(!slug.endsWith("-"), `slug termina em hífen: ${slug}`);
  });

  it("aceita entrada vazia sem quebrar", () => {
    assert.equal(slugifyShortlink(""), "");
    assert.equal(slugifyShortlink(null), "");
    assert.equal(slugifyShortlink(undefined), "");
  });
});

describe("chooseShortLink", () => {
  const link = (ID, link_slug) => ({ ID, link_slug });

  it("cria com o slug do projeto quando ele está livre", () => {
    assert.deepEqual(
      chooseShortLink({ links: [link(1, "outro-site")], slug: "aurora-eng-br" }),
      { action: "create", slug: "aurora-eng-br" },
    );
  });

  it("reaproveita o link que já pertence ao projeto, mesmo com slug diferente", () => {
    const escolha = chooseShortLink({
      links: [link(7, "aurora-eng-br"), link(9, "aurora-antigo")],
      slug: "aurora-eng-br",
      ownIds: [null, "9"],
    });
    assert.equal(escolha.action, "reuse");
    assert.equal(escolha.link.ID, 9);
  });

  it("nunca reponta um link de mesmo slug que é de outro projeto", () => {
    // O defeito: este link era de outro cliente e passava a abrir este site.
    const escolha = chooseShortLink({
      links: [link(3, "site")],
      slug: "site",
      ownIds: [],
    });
    assert.deepEqual(escolha, { action: "create", slug: "site-2" });
  });

  it("procura o próximo sufixo livre", () => {
    const escolha = chooseShortLink({
      links: [link(1, "site"), link(2, "site-2"), link(3, "site-3")],
      slug: "site",
    });
    assert.deepEqual(escolha, { action: "create", slug: "site-4" });
  });

  it("mantém o limite de 60 caracteres com o sufixo", () => {
    const slug = "a".repeat(60);
    const escolha = chooseShortLink({ links: [link(1, slug)], slug });
    assert.equal(escolha.slug.length, 60);
    assert.ok(escolha.slug.endsWith("-2"));
  });

  it("recusa quando não há sufixo livre, em vez de sequestrar um link", () => {
    const links = [link(1, "site")];
    for (let n = 2; n <= 20; n += 1) links.push(link(n, `site-${n}`));
    assert.throws(
      () => chooseShortLink({ links, slug: "site" }),
      (err) => err.status === 409,
    );
  });
});

describe("formato do BetterLinks", () => {
  it("lê a lista no formato atual, paginado", () => {
    const links = linksFromListResponse({
      total: 2,
      has_more: false,
      results: [{ ID: "1" }, { ID: "2" }],
      by_category: { 1: { lists: [{ ID: "1" }] } },
    });
    assert.deepEqual(links.map((l) => l.ID), ["1", "2"]);
  });

  it("continua lendo o formato antigo, por categoria", () => {
    const links = linksFromListResponse({
      1: { lists: [{ ID: "1" }] },
      2: { lists: [{ ID: "2" }] },
    });
    assert.deepEqual(links.map((l) => l.ID), ["1", "2"]);
  });

  it("o endereço vem do caminho real, com o prefixo — não do slug", () => {
    // Links criados depois do prefixo respondem em "siteprofissional/…";
    // montar pelo slug dava 404 para o cliente.
    assert.equal(
      shortLinkPath({ link_slug: "sorria-com-br", short_url: "siteprofissional/sorria-com-br" }),
      "siteprofissional/sorria-com-br",
    );
    // Os anteriores ao prefixo continuam na raiz.
    assert.equal(shortLinkPath({ link_slug: "aurora-eng-br", short_url: "aurora-eng-br" }), "aurora-eng-br");
    assert.equal(shortLinkPath({ link_slug: "so-slug" }), "so-slug");
  });
});

describe("confirmação do BetterLinks", () => {
  it("confirma sozinho quando só muda o que foi pedido", async () => {
    const chamadas = [];
    const call = async (args) => {
      chamadas.push(args);
      if (!args.confirm) {
        throw new ShortlinkConfirmationRequired("Overwrite 1 field(s)", { target_url: "a → b" });
      }
      return { ID: "52" };
    };
    assert.deepEqual(await updateWithConfirmation(call, { ID: 52, target_url: "b" }), { ID: "52" });
    assert.deepEqual(chamadas.at(-1), { ID: 52, target_url: "b", confirm: true });
  });

  it("para quando o BetterLinks mudaria outro campo", async () => {
    let confirmou = false;
    const call = async (args) => {
      if (args.confirm) confirmou = true;
      throw new ShortlinkConfirmationRequired("Overwrite 1 field(s)", { cat_id: "(empty) → 1" });
    };
    await assert.rejects(updateWithConfirmation(call, { ID: 52 }), (err) => err.status === 409);
    assert.equal(confirmou, false);
  });
});
