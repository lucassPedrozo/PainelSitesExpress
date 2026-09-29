import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createSerialQueue,
  renameWithRetry,
  writeFileAtomic,
} from "./atomic-write.js";

const fsError = (code) => Object.assign(new Error(code), { code });

describe("createSerialQueue", () => {
  it("roda as tarefas em ordem, uma de cada vez", async () => {
    const enqueue = createSerialQueue();
    const log = [];

    await Promise.all([
      enqueue(async () => {
        await new Promise((done) => setTimeout(done, 20));
        log.push("primeira");
      }),
      enqueue(async () => log.push("segunda")),
    ]);

    assert.deepEqual(log, ["primeira", "segunda"]);
  });

  it("uma tarefa que falha não impede as seguintes", async () => {
    const enqueue = createSerialQueue();

    await assert.rejects(
      enqueue(async () => {
        throw new Error("disco ocupado");
      }),
      /disco ocupado/,
    );

    // Era aqui que o store antigo travava para sempre.
    assert.equal(await enqueue(async () => "gravou"), "gravou");
  });
});

describe("renameWithRetry", () => {
  it("tenta de novo quando o Windows segura o arquivo por um instante", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      if (calls < 3) throw fsError("EPERM");
    };

    await renameWithRetry("a", "b", { rename, delays: [0, 0, 0] });
    assert.equal(calls, 3);
  });

  it("desiste depois das tentativas e devolve o erro original", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      throw fsError("EBUSY");
    };

    await assert.rejects(
      renameWithRetry("a", "b", { rename, delays: [0, 0] }),
      (err) => err.code === "EBUSY",
    );
    assert.equal(calls, 3);
  });

  it("não insiste em erro que não é bloqueio passageiro", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      throw fsError("ENOENT");
    };

    await assert.rejects(
      renameWithRetry("a", "b", { rename, delays: [0, 0] }),
      (err) => err.code === "ENOENT",
    );
    assert.equal(calls, 1);
  });
});

describe("writeFileAtomic", () => {
  it("grava o conteúdo e não deixa temporário para trás", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "painel-atomic-"));
    try {
      const file = path.join(dir, "estado.json");
      await writeFileAtomic(file, '{"a":1}');
      await writeFileAtomic(file, '{"a":2}');

      assert.equal(await fs.readFile(file, "utf8"), '{"a":2}');
      assert.deepEqual(await fs.readdir(dir), ["estado.json"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
