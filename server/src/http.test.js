import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { httpError, INTERNAL_ERROR_MESSAGE, publicMessageOf, statusOf } from "./http.js";

describe("statusOf", () => {
  it("usa o status do erro, ou o 404 do googleapis em `code`", () => {
    assert.equal(statusOf(httpError(409, "conflito")), 409);
    assert.equal(statusOf({ code: 404, message: "File not found" }), 404);
    assert.equal(statusOf(new Error("qualquer")), 500);
  });

  it("status fora da faixa de erro vira 500", () => {
    assert.equal(statusOf({ status: 200 }), 500);
    assert.equal(statusOf({ status: "abc" }), 500);
  });
});

describe("publicMessageOf", () => {
  it("devolve mensagem escrita para a interface, mesmo em 5xx", () => {
    const err = httpError(502, "O Lovable recusou o token");
    assert.equal(publicMessageOf(err, 502), "O Lovable recusou o token");
  });

  it("devolve a mensagem de erro de cliente (4xx)", () => {
    assert.equal(publicMessageOf({ message: "JSON inválido" }, 400), "JSON inválido");
  });

  it("esconde o detalhe de falha interna, que pode conter caminho ou id", () => {
    const err = new Error("ENOENT: no such file, open C:\painel\server\data\painel.json");
    assert.equal(publicMessageOf(err, 500), INTERNAL_ERROR_MESSAGE);
  });
});
