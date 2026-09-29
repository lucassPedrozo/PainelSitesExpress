import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowSameOriginFraming,
  safeInlineContentType,
} from "./embedded-asset.js";

const fakeRes = () => {
  const headers = {};
  return {
    headers,
    setHeader: (name, value) => {
      headers[name] = value;
    },
  };
};

describe("allowSameOriginFraming", () => {
  it("troca a proibição global de enquadramento por permissão à própria origem", () => {
    const res = fakeRes();
    allowSameOriginFraming(res);

    assert.equal(res.headers["X-Frame-Options"], "SAMEORIGIN");
    assert.match(
      res.headers["Content-Security-Policy"],
      /frame-ancestors 'self'/,
    );
    assert.doesNotMatch(
      res.headers["Content-Security-Policy"],
      /frame-ancestors 'none'/,
    );
  });

  it("mantém script e plugin bloqueados no conteúdo enquadrado", () => {
    const res = fakeRes();
    allowSameOriginFraming(res);
    const policy = res.headers["Content-Security-Policy"];

    assert.match(policy, /script-src 'none'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /default-src 'none'/);
  });
});

describe("safeInlineContentType", () => {
  it("preserva os tipos que o preview precisa renderizar", () => {
    assert.equal(safeInlineContentType("application/pdf"), "application/pdf");
    assert.equal(safeInlineContentType("image/png"), "image/png");
    assert.equal(safeInlineContentType("video/mp4"), "video/mp4");
    assert.equal(
      safeInlineContentType("text/plain; charset=utf-8"),
      "text/plain; charset=utf-8",
    );
  });

  it("serve como texto o que o navegador executaria como página", () => {
    for (const type of [
      "text/html",
      "text/html; charset=utf-8",
      "TEXT/HTML",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/xml",
    ]) {
      assert.equal(
        safeInlineContentType(type),
        "text/plain; charset=utf-8",
        `${type} deveria virar texto puro`,
      );
    }
  });

  it("no download entrega o arquivo com o tipo original", () => {
    assert.equal(
      safeInlineContentType("text/html", { download: true }),
      "text/html",
    );
  });

  it("aceita metadado ausente sem quebrar", () => {
    assert.equal(safeInlineContentType(undefined), undefined);
    assert.equal(safeInlineContentType(""), "");
  });
});
