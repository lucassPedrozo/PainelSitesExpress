import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { cached, invalidate, remember } from "./cache.js";

describe("cached", () => {
  beforeEach(() => invalidate());

  it("chamadas simultâneas com o cache vazio fazem uma consulta só", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((done) => setTimeout(done, 20));
      return "projetos";
    };

    const results = await Promise.all([
      cached("k", loader, 1000),
      cached("k", loader, 1000),
      cached("k", loader, 1000),
    ]);

    assert.deepEqual(results, ["projetos", "projetos", "projetos"]);
    assert.equal(calls, 1);
  });

  it("falha não fica guardada: a próxima chamada tenta de novo", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error("cota do Drive");
      return "ok";
    };

    await assert.rejects(cached("k", loader, 1000), /cota/);
    assert.equal(await cached("k", loader, 1000), "ok");
    assert.equal(calls, 2);
  });

  it("respeita o prazo e o invalidate por prefixo", async () => {
    let calls = 0;
    const loader = () => ++calls;

    await cached("folder:a", loader, 1000);
    await cached("folder:a", loader, 1000);
    assert.equal(calls, 1);

    invalidate("folder:");
    await cached("folder:a", loader, 1000);
    assert.equal(calls, 2);

    await cached("expira", loader, 0);
    await new Promise((done) => setTimeout(done, 5));
    await cached("expira", loader, 0);
    assert.equal(calls, 4);
  });

  it("remember grava um valor conhecido", async () => {
    remember("scope:x", true, 1000);
    assert.equal(await cached("scope:x", () => false, 1000), true);
  });
});
