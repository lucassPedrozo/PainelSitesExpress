import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configurePublication } from "./publication.js";

const realFetch = globalThis.fetch;

/** GitHub de mentira: registra cada chamada e responde o mínimo. */
const fakeGitHub = () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url) });
    if (String(url).endsWith("/actions/secrets/public-key")) {
      return Response.json({
        key_id: "1",
        // Chave pública X25519 válida (32 bytes em base64).
        key: "hBT5WZEj8ZoOv6TYJsfWq7MxTEQopZO5/IT3ZCVQPzs=",
      });
    }
    if (String(url).includes("/contents/") && method === "GET") {
      return new Response("{}", { status: 404 });
    }
    return new Response(method === "PUT" && String(url).includes("/contents/") ? "{}" : null, {
      status: method === "PUT" && String(url).includes("/contents/") ? 201 : 204,
    });
  };
  return calls;
};

const secretCalls = (calls, name) =>
  calls.filter((call) => call.url.endsWith(`/actions/secrets/${name}`));

const run = (buildEnvValue) =>
  configurePublication({
    config: { token: "github_pat_teste", baseUrl: "https://api.github.test", userAgent: "teste" },
    owner: "org",
    repo: "site",
    workflowBranch: "main",
    workflows: [{ path: ".github/workflows/Build.yml", content: "name: Build\n" }],
    secrets: [
      { name: "FTP_PASSWORD", value: "senha" },
      { name: "BUILD_ENV_FILE", value: buildEnvValue },
    ],
  });

describe("configurePublication — BUILD_ENV_FILE", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("campo vazio (undefined) não grava nem apaga o secret existente", async () => {
    const calls = fakeGitHub();
    await run(undefined);
    assert.deepEqual(secretCalls(calls, "BUILD_ENV_FILE"), []);
    assert.equal(secretCalls(calls, "FTP_PASSWORD")[0]?.method, "PUT");
  });

  it("pedido explícito de remoção (null) apaga o secret", async () => {
    const calls = fakeGitHub();
    await run(null);
    assert.deepEqual(
      secretCalls(calls, "BUILD_ENV_FILE").map((call) => call.method),
      ["DELETE"],
    );
  });

  it("variáveis informadas gravam o secret", async () => {
    const calls = fakeGitHub();
    await run("VITE_A=1");
    assert.deepEqual(
      secretCalls(calls, "BUILD_ENV_FILE").map((call) => call.method),
      ["PUT"],
    );
  });
});

describe("configurePublication — cliente HTTP compartilhado", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("tenta de novo quando a leitura da chave pública falha por instabilidade", async () => {
    const calls = fakeGitHub();
    const fake = globalThis.fetch;
    let publicKeyAttempts = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/actions/secrets/public-key")) {
        publicKeyAttempts += 1;
        if (publicKeyAttempts === 1) return new Response("", { status: 502 });
      }
      return fake(url, init);
    };

    await run("VITE_A=1");

    assert.equal(publicKeyAttempts, 2);
    assert.equal(secretCalls(calls, "BUILD_ENV_FILE")[0]?.method, "PUT");
  });
});
