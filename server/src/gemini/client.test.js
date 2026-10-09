import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateModels,
  createGeminiClient,
  describeFailure,
  flashTextModels,
  isFlashModel,
  thinkingFor,
} from "./client.js";

/**
 * O cliente do Gemini com `fetch` de mentira: nada sai para a rede. O que se
 * prova é o que mantém a chave no nível gratuito e fora do alcance de quem
 * usa o painel — só modelos Flash, fallback entre eles (inclusive quando os
 * ids envelhecem), e a chave nunca numa URL ou numa mensagem.
 */

// Curta demais para casar com o formato real: a varredura de segredos não a vê.
const KEY = "AIzaTeste-de-mentira-curta.0123456789";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const resposta = (data) =>
  json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }],
    usageMetadata: { totalTokenCount: 10 },
  });

const erroApi = (code, status, message) => json({ error: { code, status, message } }, code);

const catalogo = (...nomes) =>
  json({ models: nomes.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ["generateContent"] })) });

const setup = (respond, { key = KEY, preferred = "" } = {}) => {
  const calls = [];
  const client = createGeminiClient({
    apiKey: () => key,
    preferredModel: () => preferred,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return respond(String(url), init);
    },
  });
  return { client, calls };
};

const pedido = { system: "s", user: "u", schema: { type: "object" } };

describe("candidateModels e flashTextModels", () => {
  it("o preferido vem primeiro e os apelidos continuam atrás, sem repetir", () => {
    assert.deepEqual(candidateModels("gemini-3.8-flash"), [
      "gemini-3.8-flash",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
    ]);
    assert.deepEqual(candidateModels("gemini-flash-latest"), ["gemini-flash-latest", "gemini-flash-lite-latest"]);
  });

  it("só Flash é do nível gratuito", () => {
    assert.ok(isFlashModel("gemini-3.5-flash-lite"));
    assert.ok(!isFlashModel("gemini-2.5-pro"));
  });

  it("o pensamento fica desligado no 2.5, baixo nos 3.x e no Flash completo, e intocado nos Lite", () => {
    assert.deepEqual(thinkingFor("gemini-2.5-flash"), { thinkingBudget: 0 });
    assert.deepEqual(thinkingFor("gemini-3.8-flash"), { thinkingLevel: "low" });
    assert.deepEqual(thinkingFor("gemini-flash-latest"), { thinkingLevel: "low" });
    assert.equal(thinkingFor("gemini-flash-lite-latest"), null);
    assert.equal(thinkingFor("gemini-3.5-flash-lite"), null);
  });

  it("do catálogo saem só os Flash de texto, do mais novo ao mais antigo", () => {
    const ordem = flashTextModels([
      "gemini-2.5-flash",
      "gemini-3.8-flash-tts",
      "gemini-3.1-flash-image",
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash",
      "gemini-3-flash-preview",
      "gemini-3.5-flash",
      "gemini-flash-lite-latest",
      "gemini-2.5-pro",
      "gemini-omni-1.1-flash",
      "gemini-flash-latest",
    ]);
    assert.deepEqual(ordem, [
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
    ]);
  });
});

describe("createGeminiClient", () => {
  it("manda a chave no cabeçalho, nunca na URL, e lê o JSON do primeiro modelo", async () => {
    const { client, calls } = setup(() => resposta({ summary: "ok" }));
    const r = await client.generateJson(pedido);

    assert.equal(r.model, "gemini-flash-lite-latest");
    assert.deepEqual(r.data, { summary: "ok" });
    assert.ok(!calls[0].url.includes(KEY));
    assert.equal(calls[0].init.headers["x-goog-api-key"], KEY);
    const corpo = JSON.parse(calls[0].init.body);
    assert.equal(corpo.generationConfig.responseMimeType, "application/json");
    assert.equal(corpo.generationConfig.thinkingConfig, undefined);
  });

  it("cota esgotada num modelo passa para o próximo, que vai com o pensamento baixo", async () => {
    const { client, calls } = setup((url) =>
      url.includes("gemini-flash-lite-latest:") ? erroApi(429, "RESOURCE_EXHAUSTED", "quota") : resposta({ ok: 1 }),
    );
    const r = await client.generateJson(pedido);
    assert.equal(r.model, "gemini-flash-latest");
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].init.body).generationConfig.thinkingConfig, { thinkingLevel: "low" });
  });

  it("modelo que demora demais passa a vez; o parâmetro de pensamento recusado sai da chamada", async () => {
    const lento = setup((url) => {
      if (url.includes("gemini-flash-lite-latest:")) {
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      }
      return resposta({ ok: 1 });
    });
    const r = await lento.client.generateJson(pedido);
    assert.equal(r.model, "gemini-flash-latest");

    const teimoso = setup((url, init) => {
      if (url.includes("gemini-flash-lite-latest:")) return erroApi(404, "NOT_FOUND", "gone");
      return init.body.includes("thinkingConfig")
        ? erroApi(400, "INVALID_ARGUMENT", "Thinking level LOW is not supported for this model.")
        : resposta({ ok: 2 });
    });
    const r2 = await teimoso.client.generateJson(pedido);
    assert.deepEqual(r2.data, { ok: 2 });
    assert.equal(teimoso.calls.length, 3);
  });

  it("ids que sumiram: procura no catálogo da chave outro Flash de texto", async () => {
    const { client, calls } = setup((url) => {
      if (url.includes("/models?")) return catalogo("gemini-3.8-flash-tts", "gemini-3.8-flash", "gemini-2.5-pro");
      if (url.includes("gemini-3.8-flash:")) return resposta({ ok: 1 });
      return erroApi(404, "NOT_FOUND", "no longer available");
    });
    const r = await client.generateJson(pedido);
    assert.equal(r.model, "gemini-3.8-flash");
    // Dois apelidos (404), a listagem e o modelo descoberto.
    assert.equal(calls.length, 4);
    assert.ok(calls.every((c) => !c.url.includes("flash-tts")));
  });

  it("modelo preferido fora do nível gratuito é pulado, não chamado", async () => {
    const { client, calls } = setup(() => resposta({ ok: 1 }), { preferred: "gemini-2.5-pro" });
    const r = await client.generateJson(pedido);
    assert.equal(r.model, "gemini-flash-lite-latest");
    assert.ok(calls.every((c) => !c.url.includes("gemini-2.5-pro")));
  });

  it("o 2.5 Flash recebe o pensamento desligado; os demais, não", async () => {
    const { client, calls } = setup(() => resposta({ ok: 1 }), { preferred: "gemini-2.5-flash" });
    await client.generateJson(pedido);
    assert.equal(JSON.parse(calls[0].init.body).generationConfig.thinkingConfig.thinkingBudget, 0);
  });

  it("todos sem cota: 429 com os motivos, sem a chave e sem consultar o catálogo", async () => {
    const { client, calls } = setup(() => erroApi(429, "RESOURCE_EXHAUSTED", `quota ${KEY}`));
    await assert.rejects(client.generateJson(pedido), (err) => {
      assert.equal(err.status, 429);
      assert.match(err.message, /Nenhum modelo/);
      assert.ok(!err.message.includes(KEY));
      return true;
    });
    assert.ok(calls.every((c) => !c.url.includes("/models?")));
  });

  it("chave recusada vira mensagem clara, sem a chave", async () => {
    const { client } = setup(() => erroApi(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."));
    await assert.rejects(client.generateJson(pedido), (err) => {
      assert.equal(err.status, 502);
      assert.match(err.message, /recusou a chave/);
      assert.ok(!err.message.includes(KEY));
      return true;
    });
  });

  it("resposta vazia ou fora do JSON é erro legível", async () => {
    const vazia = setup(() => json({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }));
    await assert.rejects(vazia.client.generateJson(pedido), /SAFETY/);
    const torta = setup(() => json({ candidates: [{ content: { parts: [{ text: "{nope" }] } }] }));
    await assert.rejects(torta.client.generateJson(pedido), /formato inesperado/);
  });

  it("sem chave, não chama a API", async () => {
    const { client, calls } = setup(() => resposta({}), { key: "" });
    await assert.rejects(client.generateJson(pedido), (err) => err.status === 409);
    await assert.rejects(client.listModels(), (err) => err.status === 409);
    assert.equal(calls.length, 0);
  });

  it("lista só os modelos que geram texto, sem o prefixo models/, e lembra o catálogo", async () => {
    const { client, calls } = setup(() =>
      json({
        models: [
          { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
        ],
      }),
    );
    assert.deepEqual(await client.listModels(), ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    assert.deepEqual(await client.flashCatalog(), ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
    await client.flashCatalog();
    assert.equal(calls.length, 2);
  });
});

describe("describeFailure", () => {
  it("escreve para quem usa o painel", () => {
    assert.match(describeFailure(403, "PERMISSION_DENIED", ""), /permissão/);
    assert.match(describeFailure(500, "INTERNAL", "boom"), /500 \(INTERNAL\): boom/);
  });
});
