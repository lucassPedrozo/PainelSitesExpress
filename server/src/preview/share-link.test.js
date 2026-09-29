import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProbe,
  classifyShortLinkProbe,
  parseSharePreviewUrl,
} from "./share-link.js";

describe("parseSharePreviewUrl", () => {
  it("aceita o link do Share preview como o Lovable o entrega", () => {
    const { url, token } = parseSharePreviewUrl(
      "https://lovable.dev/preview/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    );
    assert.equal(url, "https://lovable.dev/preview/AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    assert.equal(token, "AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it("limpa o que vem junto num link colado", () => {
    for (const entrada of [
      "  https://lovable.dev/preview/abc12345  ",
      "lovable.dev/preview/abc12345",
      "http://lovable.dev/preview/abc12345",
      "https://lovable.dev/preview/abc12345/",
      "https://lovable.dev/preview/abc12345?utm_source=x",
      "https://lovable.dev/preview/abc12345#topo",
    ]) {
      assert.equal(
        parseSharePreviewUrl(entrada).url,
        "https://lovable.dev/preview/abc12345",
        `falhou para ${entrada}`,
      );
    }
  });

  it("recusa o preview interno, que exige sessão do Lovable", () => {
    assert.throws(
      () =>
        parseSharePreviewUrl(
          "https://id-preview--0a1b2c3d-0000-4000-8000-000000000000.lovable.app",
        ),
      /Share preview/,
    );
  });

  it("recusa o editor e o que não é link", () => {
    for (const entrada of [
      "https://lovable.dev/projects/0a1b2c3d",
      "https://exemplo.com/preview/abc12345",
      "qualquer coisa",
      "",
      null,
    ]) {
      assert.throws(() => parseSharePreviewUrl(entrada));
    }
  });
});

describe("classifyProbe", () => {
  it("trata o 307 para o host de preview como vivo", () => {
    // Sem barra depois do host: é como o Lovable devolve o token.
    assert.equal(
      classifyProbe({
        status: 307,
        location:
          "https://id-preview--0a1b2c3d.lovable.app?__lovable_token=eyJhbGci",
      }).state,
      "alive",
    );
    assert.equal(
      classifyProbe({
        status: 302,
        location: "https://id-preview--0a1b2c3d.lovable.app/",
      }).state,
      "alive",
    );
  });

  it("trata redirecionamento para outro destino como morto", () => {
    assert.equal(
      classifyProbe({ status: 307, location: "https://lovable.dev/login" }).state,
      "dead",
    );
    assert.equal(classifyProbe({ status: 307, location: "" }).state, "dead");
  });

  it("trata link excluído como morto", () => {
    assert.equal(classifyProbe({ status: 404 }).state, "dead");
    assert.equal(classifyProbe({ status: 410 }).state, "dead");
  });

  it("trata resposta autenticada como morta — não serve ao cliente", () => {
    assert.equal(classifyProbe({ status: 401 }).state, "dead");
    assert.equal(classifyProbe({ status: 403 }).state, "dead");
  });

  it("não condena o link quando a resposta é inconclusiva", () => {
    // 5xx e 200 são do Lovable, não do link: derrubar o link do cliente por
    // uma instabilidade lá seria pior que admitir que não sabemos.
    assert.equal(classifyProbe({ status: 500 }).state, "unknown");
    assert.equal(classifyProbe({ status: 200 }).state, "unknown");
  });

  it("explica o motivo em toda classificação", () => {
    for (const entrada of [
      { status: 307, location: "https://x.lovable.app/" },
      { status: 404 },
      { status: 500 },
    ]) {
      const { detail } = classifyProbe(entrada);
      assert.ok(detail && detail.length > 10, "faltou explicação");
    }
  });
});

describe("classifyShortLinkProbe", () => {
  const targetUrl = "https://lovable.dev/preview/abc";

  it("aberto quando redireciona para a prévia registrada", () => {
    assert.equal(
      classifyShortLinkProbe({ status: 307, location: targetUrl, targetUrl }).ok,
      true,
    );
  });

  it("404 no encurtador reprova — era o caso do prefixo", () => {
    const r = classifyShortLinkProbe({ status: 404, location: null, targetUrl });
    assert.equal(r.ok, false);
    assert.match(r.detail, /404/);
  });

  it("redirecionar para outra prévia reprova", () => {
    const r = classifyShortLinkProbe({
      status: 307,
      location: "https://lovable.dev/preview/outra",
      targetUrl,
    });
    assert.equal(r.ok, false);
  });

  it("resposta estranha não condena", () => {
    assert.equal(classifyShortLinkProbe({ status: 500, location: null, targetUrl }).ok, null);
  });
});
