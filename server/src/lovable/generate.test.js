import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSiteGenerator } from "./generate.js";
import { GenerationGuard } from "./generation-guard.js";

/**
 * O caminho que gasta crédito do Lovable, com dublês no lugar de Drive, MCP e
 * store. O que se prova aqui é o que evita cobrança em dobro — e isso não dá
 * para descobrir em produção sem pagar por cada tentativa.
 */

const quiet = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

const input = {
  prompt: "Site para a padaria",
  fileIds: ["logo"],
  workspaceId: "ws-1",
  workspaceName: "Agência",
};

/** Gerador com dublês; cada dependência pode ser trocada pelo teste. */
const setup = (overrides = {}) => {
  const calls = { upload: 0, create: 0, record: 0 };
  let now = 0;
  const guard = new GenerationGuard({ now: () => now });

  const generateSite = createSiteGenerator({
    plan: async () => ({
      text: "Site para a padaria",
      attachments: [{ id: "logo", uploadName: "logo.png" }],
    }),
    upload: async () => {
      calls.upload += 1;
      return { fileId: "up-1", name: "logo.png", mimeType: "image/png", bytes: 10 };
    },
    call: async (tool, args) => {
      assert.equal(tool, "create_project");
      calls.create += 1;
      return {
        id: "lov-1",
        url: "https://lovable.dev/projects/lov-1",
        preview_url: "https://id-preview--lov-1.lovable.app",
        workspace_id: args.workspace_id,
      };
    },
    record: async (_projectId, generation) => {
      calls.record += 1;
      return { ...generation, createdAt: "2026-09-17T12:00:00.000Z" };
    },
    gate: () => ({ enabled: true, reason: null }),
    guard,
    signatures: async () => [],
    uploadLocal: async () => {
      throw new Error("sem assinatura nos testes");
    },
    ...overrides,
  });

  return { generateSite, calls, guard, advance: (ms) => (now += ms) };
};

describe("createSiteGenerator", () => {
  it("sobe os anexos, cria o projeto e grava a geração", async () => {
    const { generateSite, calls } = setup();
    const result = await generateSite("pasta-1", input);

    assert.equal(result.generation.id, "lov-1");
    assert.deepEqual(result.attachments, [{ name: "logo.png", bytes: 10 }]);
    assert.deepEqual(calls, { upload: 1, create: 1, record: 1 });
  });

  it("a assinatura Joinvix vai junto com os anexos, com o nome que a Knowledge reconhece", async () => {
    let enviados = [];
    const { generateSite } = setup({
      signatures: async () => [
        { variant: "Claro", path: "x", name: "Rodapé Claro.png", contentType: "image/png" },
      ],
      uploadLocal: async (file) => ({
        fileId: "up-assinatura",
        name: file.name,
        mimeType: file.contentType,
        bytes: 5,
      }),
      call: async (_tool, args) => {
        enviados = args.files.map((file) => file.file_name);
        return { id: "lov-1", workspace_id: args.workspace_id };
      },
    });

    await generateSite("pasta-1", input);
    assert.deepEqual(enviados, ["logo.png", "Rodapé Claro.png"]);
  });

  it("geração desligada no .env não sobe nada nem chama o Lovable", async () => {
    const { generateSite, calls } = setup({
      gate: () => ({ enabled: false, reason: "desligada" }),
    });
    await assert.rejects(generateSite("pasta-1", input), (err) => err.status === 423);
    assert.deepEqual(calls, { upload: 0, create: 0, record: 0 });
  });

  it("sem workspace, recusa antes de gastar", async () => {
    const { generateSite, calls } = setup();
    await assert.rejects(
      generateSite("pasta-1", { ...input, workspaceId: "" }),
      (err) => err.status === 400,
    );
    assert.equal(calls.create, 0);
  });

  it("segundo clique enquanto a primeira geração roda é recusado sem chamar o Lovable", async () => {
    let liberar;
    const { generateSite, calls } = setup({
      upload: () =>
        new Promise((resolve) => {
          liberar = () =>
            resolve({ fileId: "up-1", name: "logo.png", mimeType: "image/png", bytes: 10 });
        }),
    });

    const primeira = generateSite("pasta-1", input);
    await new Promise((done) => setImmediate(done));

    await assert.rejects(generateSite("pasta-1", input), (err) => err.status === 409);

    liberar();
    await primeira;
    assert.equal(calls.create, 1);
  });

  it("sem resposta do Lovable, o projeto fica bloqueado: o site pode ter sido criado", async () => {
    const { generateSite, calls, advance } = setup({
      call: async () => {
        calls.create += 1;
        throw Object.assign(new Error("O Lovable não respondeu dentro do tempo limite."), {
          status: 504,
        });
      },
    });

    await assert.rejects(generateSite("pasta-1", input), (err) =>
      /pode ter sido criado/.test(err.message),
    );
    await assert.rejects(generateSite("pasta-1", input), (err) =>
      err.status === 409 && /confira/i.test(err.message),
    );
    assert.equal(calls.create, 1);

    // Outros projetos continuam liberados, e o bloqueio passa com o tempo.
    advance(11 * 60_000);
    await assert.rejects(generateSite("pasta-1", input), (err) => err.status === 504);
    assert.equal(calls.create, 2);
  });

  it("recusa explícita do Lovable não bloqueia: nada foi criado", async () => {
    let tentativa = 0;
    const { generateSite, calls } = setup({
      call: async () => {
        calls.create += 1;
        tentativa += 1;
        if (tentativa === 1) {
          throw Object.assign(new Error("Workspace sem créditos"), {
            status: 502,
            notProcessed: true,
          });
        }
        return { id: "lov-2", url: "https://lovable.dev/projects/lov-2" };
      },
    });

    await assert.rejects(generateSite("pasta-1", input), /sem créditos/);
    const result = await generateSite("pasta-1", input);
    assert.equal(result.generation.id, "lov-2");
    assert.equal(calls.create, 2);
  });

  it("site criado mas não gravado: mostra o link e bloqueia nova geração", async () => {
    const { generateSite } = setup({
      record: async () => {
        throw new Error("disco cheio");
      },
    });

    await quiet(() =>
      assert.rejects(generateSite("pasta-1", input), (err) =>
        err.status === 500 &&
        err.message.includes("https://lovable.dev/projects/lov-1") &&
        /Não gere de novo/.test(err.message),
      ),
    );
    await assert.rejects(generateSite("pasta-1", input), (err) => err.status === 409);
  });
});
