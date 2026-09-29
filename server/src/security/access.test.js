import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import {
  configureSessionPersistence,
  countSessions,
  createSession,
  credentialFingerprint,
  dropSession,
  dropSessionsOfUser,
  flushSessions,
  generateAccessKey,
  hashAccessKey,
  newSalt,
  readSession,
  resetSessions,
  sameHash,
} from "./access.js";

describe("chaves de acesso", () => {
  it("gera chave longa e sempre diferente", () => {
    const a = generateAccessKey();
    const b = generateAccessKey();
    assert.notEqual(a, b);
    assert.ok(a.length >= 40, `chave curta: ${a.length}`);
    // base64url: nada que precise de escape em URL ou header.
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });

  it("o hash depende do sal — duas pessoas com a mesma chave não colidem", () => {
    const chave = generateAccessKey();
    assert.notEqual(hashAccessKey(chave, newSalt()), hashAccessKey(chave, newSalt()));
  });

  it("o mesmo par chave+sal dá sempre o mesmo hash", () => {
    const chave = generateAccessKey();
    const sal = newSalt();
    assert.equal(hashAccessKey(chave, sal), hashAccessKey(chave, sal));
  });

  it("sameHash compara sem vazar por tamanho ou tipo", () => {
    const h = hashAccessKey("x", "sal");
    assert.equal(sameHash(h, h), true);
    assert.equal(sameHash(h, hashAccessKey("y", "sal")), false);
    assert.equal(sameHash(h, "curto"), false);
    assert.equal(sameHash(h, undefined), false);
    assert.equal(sameHash(null, null), false);
  });
});

describe("sessões", () => {
  beforeEach(() => resetSessions());

  it("cria, lê e encerra", () => {
    const id = createSession("user-1");
    assert.equal(readSession(id)?.userId, "user-1");

    dropSession(id);
    assert.equal(readSession(id), null);
  });

  it("id de sessão não é a chave e não repete", () => {
    const a = createSession("user-1");
    const b = createSession("user-1");
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });

  it("id desconhecido ou vazio não autentica", () => {
    assert.equal(readSession("inventado"), null);
    assert.equal(readSession(""), null);
    assert.equal(readSession(undefined), null);
  });

  it("revogar a chave encerra todas as sessões daquela pessoa", () => {
    createSession("ana");
    createSession("ana");
    const doBruno = createSession("bruno");

    assert.equal(dropSessionsOfUser("ana"), 2);
    // A de outra pessoa continua valendo — revogar é isolado, e é o ponto
    // inteiro de ter uma chave por pessoa.
    assert.equal(readSession(doBruno)?.userId, "bruno");
    assert.equal(countSessions(), 1);
  });

  it("revogar quem não tem sessão aberta não é erro", () => {
    assert.equal(dropSessionsOfUser("ninguem"), 0);
  });
});

describe("sessões persistidas", () => {
  beforeEach(() => resetSessions());

  const withTempFile = async (fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "painel-sessoes-"));
    try {
      await fn(path.join(dir, "sessions.json"));
    } finally {
      resetSessions();
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  it("sobrevivem ao reinício da API", () =>
    withTempFile(async (file) => {
      configureSessionPersistence({ file });
      const id = createSession("ana", { credential: "marca" });
      await flushSessions();

      // Reinício: memória zerada, arquivo relido.
      resetSessions();
      assert.equal(configureSessionPersistence({ file }), 1);
      const session = readSession(id);
      assert.equal(session?.userId, "ana");
      assert.equal(session?.credential, "marca");
    }));

  it("o arquivo guarda só o hash — o id do cookie não aparece em disco", () =>
    withTempFile(async (file) => {
      configureSessionPersistence({ file });
      const id = createSession("ana");
      await flushSessions();

      const conteudo = await fs.readFile(file, "utf8");
      assert.ok(!conteudo.includes(id), "o id da sessão foi gravado em claro");
      assert.match(Object.keys(JSON.parse(conteudo).sessions)[0], /^[a-f0-9]{64}$/);
    }));

  it("sessão encerrada ou revogada não volta depois do reinício", () =>
    withTempFile(async (file) => {
      configureSessionPersistence({ file });
      const saiu = createSession("ana");
      createSession("bruno");
      const fica = createSession("carla");
      dropSession(saiu);
      dropSessionsOfUser("bruno");
      await flushSessions();

      resetSessions();
      assert.equal(configureSessionPersistence({ file }), 1);
      assert.equal(readSession(saiu), null);
      assert.equal(readSession(fica)?.userId, "carla");
    }));

  it("arquivo ilegível só descarta as sessões, sem derrubar a subida", () =>
    withTempFile(async (file) => {
      await fs.writeFile(file, "{ isto não é json");
      const original = console.error;
      console.error = () => {};
      try {
        assert.equal(configureSessionPersistence({ file }), 0);
      } finally {
        console.error = original;
      }
    }));

  it("sessão vencida não é carregada", () =>
    withTempFile(async (file) => {
      const antiga = Date.now() - 13 * 60 * 60 * 1000;
      await fs.writeFile(
        file,
        JSON.stringify({
          sessions: {
            ["a".repeat(64)]: { userId: "ana", createdAt: antiga, seenAt: antiga },
          },
        }),
      );
      assert.equal(configureSessionPersistence({ file }), 0);
    }));
});

describe("credentialFingerprint", () => {
  it("muda quando a chave muda, e não expõe a chave", () => {
    const antiga = credentialFingerprint("chave-mestra-antiga");
    assert.notEqual(antiga, credentialFingerprint("chave-mestra-nova"));
    assert.equal(antiga, credentialFingerprint("chave-mestra-antiga"));
    assert.ok(!antiga.includes("chave"));
    assert.equal(credentialFingerprint(""), null);
  });
});
