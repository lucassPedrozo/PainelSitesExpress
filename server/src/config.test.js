import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config } from "./config.js";

describe("configuração sob o test runner", () => {
  it("não lê o .env da máquina: os testes valem igual aqui e no CI", () => {
    assert.equal(process.env.NODE_TEST_CONTEXT !== undefined, true);
    assert.equal(config.rootFolderId, "");
  });
});
