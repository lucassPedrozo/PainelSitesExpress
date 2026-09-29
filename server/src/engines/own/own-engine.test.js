import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAnthropicKey } from "../../ai/providers.js";
import { OwnGenerationError, runOwnGeneration } from "./generate.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { runTool, TOOLS } from "./tools.js";
import { safePath, Workspace } from "./workspace.js";

/*
 * O motor próprio ainda não é chamado por nenhuma rota. Estes testes cobrem as
 * peças que já existem, sem rede e sem custo: o cliente do SDK é falso.
 */

/** Classes de erro com a mesma hierarquia do SDK. */
class APIError extends Error {}
class AuthenticationError extends APIError {}
class PermissionDeniedError extends APIError {}
class RateLimitError extends APIError {}
class APIConnectionError extends APIError {}
const FakeAnthropic = { APIError, AuthenticationError, PermissionDeniedError, RateLimitError, APIConnectionError };

describe("workspace", () => {
  it("o modelo só escreve conteúdo do site", () => {
    assert.equal(safePath("./src/App.tsx"), "src/App.tsx");
    assert.equal(safePath("index.html"), "index.html");
    for (const ruim of [
      "package.json",
      "vite.config.ts",
      ".github/workflows/x.yml",
      "../fora.txt",
      "src/../package.json",
      "/etc/passwd",
      "C:/x",
      "src\\App.tsx",
      "src//App.tsx",
    ]) {
      assert.throws(() => safePath(ruim), undefined, ruim);
    }
  });

  it("lê a configuração do modelo de projeto, mas não a altera", () => {
    const ws = new Workspace({ "package.json": '{"dependencies":{}}' });
    assert.equal(runTool(ws, "read_file", { path: "package.json" }).isError, false);
    assert.equal(runTool(ws, "write_file", { path: "package.json", contents: "{}" }).isError, true);
    assert.equal(ws.read("package.json"), '{"dependencies":{}}');
  });

  it("marca o que o modelo mexeu — é o que vai no commit", () => {
    const ws = new Workspace({ "src/App.tsx": "antigo" });
    runTool(ws, "write_file", { path: "src/components/Hero.tsx", contents: "export {}" });
    runTool(ws, "delete_file", { path: "src/App.tsx" });
    assert.deepEqual([...ws.touched].sort(), ["src/App.tsx", "src/components/Hero.tsx"]);
    assert.deepEqual(ws.list(), ["src/components/Hero.tsx"]);
  });
});

describe("tools", () => {
  it("recusa entrada truncada ou com campo sobrando antes de executar", () => {
    const ws = new Workspace();
    assert.equal(runTool(ws, "write_file", { path: "src/a.tsx" }).isError, true);
    assert.equal(runTool(ws, "write_file", { path: "src/a.tsx", contents: "x", extra: 1 }).isError, true);
    assert.equal(runTool(ws, "desconhecida", {}).isError, true);
    assert.equal(ws.list().length, 0);
  });

  it("a ferramenta de escrita recebe a entrada em streaming", () => {
    assert.equal(TOOLS.find((t) => t.name === "write_file")?.eager_input_streaming, true);
  });
});

describe("prompt", () => {
  it("o prompt de sistema é fixo — nada do cliente nele, para o cache valer", () => {
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(SYSTEM_PROMPT), false);
    const msg = buildUserPrompt({ brief: "Padaria do Zé", notes: "tons de azul", assets: ["src/assets/logo.png"] });
    assert.match(msg, /<briefing>\nPadaria do Zé\n<\/briefing>/);
    assert.match(msg, /tons de azul/);
    assert.match(msg, /src\/assets\/logo\.png/);
  });
});

/** Um cliente falso que devolve as mensagens da fila, uma por rodada. */
function fakeClient(respostas) {
  const pedidos = [];
  const stream = (params) => {
    pedidos.push(structuredClone(params));
    const proxima = respostas.shift();
    return {
      on: () => {},
      finalMessage: async () => {
        if (proxima instanceof Error) throw proxima;
        return proxima;
      },
    };
  };
  return { pedidos, client: { messages: { stream }, beta: { messages: { stream } } } };
}

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });

describe("runOwnGeneration", () => {
  it("executa as ferramentas, devolve os resultados juntos e termina no fim da resposta", async () => {
    const { client, pedidos } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("t1", "write_file", { path: "src/App.tsx", contents: "app" }),
          toolUse("t2", "write_file", { path: "package.json", contents: "{}" }),
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Site pronto." }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 } },
    ]);
    const ws = new Workspace();
    const r = await runOwnGeneration({ client, Anthropic: FakeAnthropic, model: "claude-opus-5", workspace: ws, userPrompt: "oi" });

    assert.equal(r.summary, "Site pronto.");
    assert.deepEqual(r.touched, ["src/App.tsx"]);
    assert.deepEqual(r.usage, { input: 110, output: 55, cacheRead: 90 });

    // Os dois resultados numa mensagem só; o recusado marcado como erro.
    const resultados = pedidos[1].messages.at(-1).content;
    assert.equal(resultados.length, 2);
    assert.equal(resultados[1].is_error, true);

    // Opus 5: fallback do servidor, adaptive thinking e cache do prefixo.
    assert.equal(pedidos[0].fallbacks, "default");
    assert.deepEqual(pedidos[0].thinking, { type: "adaptive" });
    assert.deepEqual(pedidos[0].cache_control, { type: "ephemeral" });
  });

  it("não executa a ferramenta cortada no limite de tokens", async () => {
    const { client } = fakeClient([
      { stop_reason: "max_tokens", content: [toolUse("t1", "write_file", { path: "src/A.tsx", contents: "pela met" })], usage: {} },
    ]);
    const ws = new Workspace();
    await assert.rejects(
      runOwnGeneration({ client, Anthropic: FakeAnthropic, model: "claude-opus-5", workspace: ws, userPrompt: "x" }),
      OwnGenerationError,
    );
    assert.equal(ws.list().length, 0);
  });

  it("recusa do modelo para o laço; erro da API sobe; JSON inválido é repetido", async () => {
    const recusa = fakeClient([{ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [], usage: {} }]);
    await assert.rejects(
      runOwnGeneration({ client: recusa.client, Anthropic: FakeAnthropic, model: "claude-opus-5", workspace: new Workspace(), userPrompt: "x" }),
      /recusou.*cyber/,
    );

    const api = fakeClient([new AuthenticationError("401")]);
    await assert.rejects(
      runOwnGeneration({ client: api.client, Anthropic: FakeAnthropic, model: "claude-sonnet-5", workspace: new Workspace(), userPrompt: "x" }),
      AuthenticationError,
    );

    const json = fakeClient([new SyntaxError("json"), { stop_reason: "end_turn", content: [], usage: {} }]);
    const r = await runOwnGeneration({ client: json.client, Anthropic: FakeAnthropic, model: "claude-sonnet-5", workspace: new Workspace(), userPrompt: "x" });
    assert.equal(r.turns, 2);
    // Sem fallback do servidor fora do Opus 5 e do Fable 5.1.
    assert.equal("fallbacks" in json.pedidos[0], false);
  });
});

describe("verifyAnthropicKey", () => {
  const fabrica = (comportamento) => async () => ({
    Anthropic: FakeAnthropic,
    client: {
      models: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            if (comportamento instanceof Error) throw comportamento;
            for (const id of comportamento) yield { id };
          },
        }),
      },
    },
  });

  it("chave boa devolve os modelos", async () => {
    assert.deepEqual(await verifyAnthropicKey("sk-ant-x", fabrica(["claude-opus-5", "claude-sonnet-5"])), {
      ok: true,
      models: ["claude-opus-5", "claude-sonnet-5"],
    });
  });

  it("cada falha diz o que fazer", async () => {
    const recusada = await verifyAnthropicKey("sk-ant-x", fabrica(new AuthenticationError("401")));
    assert.equal(recusada.ok, false);
    assert.match(recusada.reason, /recusada/);
    const rede = await verifyAnthropicKey("sk-ant-x", fabrica(new APIConnectionError("net")));
    assert.match(rede.reason, /alcançar/);
  });
});
