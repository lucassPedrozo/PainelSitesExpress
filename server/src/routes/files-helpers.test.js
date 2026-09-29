import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headerOf, singleByteRange, thumbnailSize } from "./files-helpers.js";

describe("thumbnailSize", () => {
  it("usa 400 quando ausente ou inválido", () => {
    assert.equal(thumbnailSize(undefined), 400);
    assert.equal(thumbnailSize("abc"), 400);
  });

  it("arredonda e limita à faixa útil", () => {
    assert.equal(thumbnailSize("80"), 80);
    assert.equal(thumbnailSize("80.6"), 81);
    assert.equal(thumbnailSize("1"), 32);
    assert.equal(thumbnailSize("99999"), 1600);
  });
});

describe("singleByteRange", () => {
  it("aceita a faixa simples que o <video> pede", () => {
    assert.equal(singleByteRange("bytes=0-"), "bytes=0-");
    assert.equal(singleByteRange("bytes=100-199"), "bytes=100-199");
  });

  it("ignora faixa múltipla, sufixo e lixo", () => {
    assert.equal(singleByteRange("bytes=0-1,5-9"), undefined);
    assert.equal(singleByteRange("bytes=-500"), undefined);
    assert.equal(singleByteRange("items=0-1"), undefined);
    assert.equal(singleByteRange(undefined), undefined);
  });
});

describe("headerOf", () => {
  it("lê cabeçalho de objeto simples e de Headers", () => {
    assert.equal(headerOf({ "content-length": 10 }, "content-length"), "10");
    assert.equal(
      headerOf(new Headers({ "Content-Range": "bytes 0-9/100" }), "content-range"),
      "bytes 0-9/100",
    );
    assert.equal(headerOf(undefined, "x"), undefined);
  });
});
