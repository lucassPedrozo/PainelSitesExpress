import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenerationBlockedError, GenerationGuard } from "./generation-guard.js";

describe("GenerationGuard", () => {
  it("recusa uma segunda geração do mesmo projeto enquanto a primeira roda", () => {
    const guard = new GenerationGuard();
    const release = guard.acquire("projeto-a");

    assert.throws(
      () => guard.acquire("projeto-a"),
      (err) => err instanceof GenerationBlockedError && err.status === 409,
    );

    release();
    assert.doesNotThrow(() => guard.acquire("projeto-a")());
  });

  it("não impede gerar projetos diferentes ao mesmo tempo", () => {
    const guard = new GenerationGuard();
    guard.acquire("projeto-a");
    assert.doesNotThrow(() => guard.acquire("projeto-b"));
  });

  it("liberar duas vezes não solta a reserva de outra geração", () => {
    const guard = new GenerationGuard();
    const primeira = guard.acquire("projeto-a");
    primeira();
    guard.acquire("projeto-a");
    primeira();

    assert.throws(() => guard.acquire("projeto-a"), GenerationBlockedError);
  });

  it("segura o projeto depois de um resultado incerto e libera no prazo", () => {
    let now = 0;
    const guard = new GenerationGuard({ holdMs: 10 * 60_000, now: () => now });

    guard.acquire("projeto-a")();
    guard.markUncertain("projeto-a");

    now = 9 * 60_000;
    assert.throws(
      () => guard.acquire("projeto-a"),
      (err) => /confira/i.test(err.message) && /1 min/.test(err.message),
    );

    now = 10 * 60_000 + 1;
    assert.doesNotThrow(() => guard.acquire("projeto-a"));
  });
});
