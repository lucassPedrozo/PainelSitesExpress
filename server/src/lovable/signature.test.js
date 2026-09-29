import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { listSignatureFiles } from "./signature.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "painel-assinatura-"));
after(() => fs.rm(root, { recursive: true, force: true }));

const quiet = async (fn) => {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
};

const fakeFetch = (calls, { fail = false } = {}) => async (url) => {
  calls.push(url);
  if (fail) throw new Error("sem rede");
  return new Response(`png de ${url.split("/").at(-1)}`, { status: 200 });
};

describe("assinatura do rodapé", () => {
  it("baixa do repositório e diz ao agente para qual fundo cada uma serve", async () => {
    const calls = [];
    const cacheDir = path.join(root, "a");
    const files = await listSignatureFiles({
      cacheDir,
      assetsUrl: "https://exemplo/assets",
      fetchImpl: fakeFetch(calls),
    });

    assert.deepEqual(calls, [
      "https://exemplo/assets/logo-dark.png",
      "https://exemplo/assets/logo-light.png",
    ]);
    // logo-dark tem texto escuro: é a do rodapé de fundo claro.
    assert.deepEqual(
      files.map(({ variant, name }) => [variant, name]),
      [
        ["Claro", "Rodapé Claro - para rodapé de fundo claro.png"],
        ["Escuro", "Rodapé Escuro - para rodapé de fundo escuro.png"],
      ],
    );
    assert.equal(
      await fs.readFile(files[0].path, "utf8"),
      "png de logo-dark.png",
    );
  });

  it("com a cópia recente, não vai ao GitHub", async () => {
    const calls = [];
    await listSignatureFiles({
      cacheDir: path.join(root, "a"),
      assetsUrl: "https://exemplo/assets",
      fetchImpl: fakeFetch(calls),
    });
    assert.deepEqual(calls, []);
  });

  it("sem rede, usa a cópia local; sem cópia, não inventa arquivo", async () => {
    const velha = path.join(root, "b");
    await fs.mkdir(velha, { recursive: true });
    await fs.writeFile(path.join(velha, "logo-dark.png"), "antiga");
    const antigo = new Date(Date.now() - 24 * 60 * 60_000);
    await fs.utimes(path.join(velha, "logo-dark.png"), antigo, antigo);

    const files = await quiet(() =>
      listSignatureFiles({
        cacheDir: velha,
        assetsUrl: "https://exemplo/assets",
        fetchImpl: fakeFetch([], { fail: true }),
      }),
    );
    assert.deepEqual(files.map((f) => f.variant), ["Claro"]);
  });
});

describe("assinatura antiga na pasta do cliente", async () => {
  const { isOldSignatureFile } = await import("./package.js");
  it("reconhece os arquivos de rodapé antigos, e só eles", () => {
    assert.equal(isOldSignatureFile("Rodapé Escuro.png"), true);
    assert.equal(isOldSignatureFile("rodape joinvix.png"), true);
    assert.equal(isOldSignatureFile("Rodapé Claro.png"), true);
    assert.equal(isOldSignatureFile("foto-rodape-loja.jpg"), false);
    assert.equal(isOldSignatureFile("logo.png"), false);
  });
});
