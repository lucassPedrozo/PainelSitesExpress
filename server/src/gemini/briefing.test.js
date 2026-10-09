import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeBriefing,
  composeUserMessage,
  LIMITS,
  normalizeAnalysis,
  parseAnalysisInput,
} from "./briefing.js";

/**
 * A análise do briefing sem rede: um cliente de mentira devolve o JSON, e o
 * que se prova é a conferência da entrada, os tetos da resposta e o cache
 * que poupa a cota gratuita.
 */

const clienteFalso = (data, chamadas = []) => ({
  async generateJson(pedido) {
    chamadas.push(pedido);
    return { model: "gemini-2.5-flash", data, usage: null };
  },
});

describe("parseAnalysisInput", () => {
  it("apara, limita e recusa o que não serve", () => {
    const r = parseAnalysisInput({
      briefing: "  Clínica\r\n\r\n\r\n\r\nOdonto  ",
      observations: "x",
      projectName: " dentista.com.br ",
      fileNames: ["logo.png", "", 42, "a".repeat(500)],
    });
    assert.equal(r.briefing, "Clínica\n\nOdonto");
    assert.equal(r.projectName, "dentista.com.br");
    assert.deepEqual(r.fileNames.map((n) => n.length), [8, LIMITS.fileNameChars]);

    assert.throws(() => parseAnalysisInput({}), /Não há briefing nem observações/);
    assert.throws(() => parseAnalysisInput({ briefing: 7 }), /Briefing inválido/);
    assert.throws(() => parseAnalysisInput({ briefing: "a".repeat(LIMITS.briefingChars + 1) }), /passa de/);
  });

  it("a mensagem ao modelo separa projeto, arquivos, briefing e observações", () => {
    const texto = composeUserMessage(parseAnalysisInput({ briefing: "Padaria", fileNames: ["foto.jpg"] }));
    assert.match(texto, /# Arquivos na pasta do cliente \(1\)\n- foto\.jpg/);
    assert.match(texto, /# Briefing do cliente\nPadaria/);
    assert.match(texto, /# Observações já escritas pela equipe\n\(nenhuma\)/);
  });
});

describe("normalizeAnalysis", () => {
  it("corta nos tetos, descarta item sem o essencial e repete nenhuma busca", () => {
    const r = normalizeAnalysis({
      summary: "  Padaria   artesanal  ",
      missing: [{ label: "Contato", detail: "Peça o WhatsApp." }, { label: "", detail: "sem rótulo" }],
      suggestions: [
        { title: "", text: "Destaque os pães.\n\n\n\nUse fotos grandes." },
        { title: "Vazia", text: "" },
      ],
      imageQueries: [
        { term: "pão artesanal", section: "Hero", quantity: 99 },
        { term: "Pão Artesanal", section: "hero", quantity: 2 },
        { term: "", section: "sobre", quantity: 2 },
        { term: "padeiro trabalhando", section: "sobre", quantity: "não" },
      ],
    });
    assert.equal(r.summary, "Padaria artesanal");
    assert.deepEqual(r.missing, [{ label: "Contato", detail: "Peça o WhatsApp." }]);
    assert.deepEqual(r.suggestions, [{ title: "Sugestão", text: "Destaque os pães.\n\nUse fotos grandes." }]);
    assert.deepEqual(r.imageQueries, [
      { term: "pão artesanal", section: "hero", quantity: LIMITS.maxQuantity, reason: null },
      { term: "padeiro trabalhando", section: "sobre", quantity: LIMITS.defaultQuantity, reason: null },
    ]);
  });

  it("resposta fora do formato vira análise vazia, não erro", () => {
    assert.deepEqual(normalizeAnalysis(null), { summary: "", missing: [], suggestions: [], imageQueries: [] });
  });
});

describe("analyzeBriefing", () => {
  it("a mesma entrada volta do cache, e o limitador só roda na chamada real", async () => {
    const chamadas = [];
    let limitadas = 0;
    const client = clienteFalso({ summary: "Padaria", missing: [], suggestions: [], imageQueries: [] }, chamadas);
    const input = parseAnalysisInput({ briefing: `Padaria de teste ${Math.random()}` });

    const primeira = await analyzeBriefing(input, { client, beforeCall: () => (limitadas += 1) });
    const segunda = await analyzeBriefing(input, { client, beforeCall: () => (limitadas += 1) });

    assert.equal(chamadas.length, 1);
    assert.equal(limitadas, 1);
    assert.equal(primeira.cached, false);
    assert.equal(segunda.cached, true);
    assert.equal(segunda.model, "gemini-2.5-flash");
    assert.equal(segunda.summary, "Padaria");
    assert.match(chamadas[0].user, /Padaria de teste/);
    assert.equal(chamadas[0].schema.required.length, 4);
  });

  it("falha na chamada não fica no cache", async () => {
    let tentativas = 0;
    const client = {
      async generateJson() {
        tentativas += 1;
        if (tentativas === 1) throw new Error("cota");
        return { model: "gemini-2.0-flash", data: { summary: "ok", missing: [], suggestions: [], imageQueries: [] } };
      },
    };
    const input = parseAnalysisInput({ briefing: `Falha e volta ${Math.random()}` });
    await assert.rejects(analyzeBriefing(input, { client }), /cota/);
    const r = await analyzeBriefing(input, { client });
    assert.equal(r.summary, "ok");
    assert.equal(tentativas, 2);
  });
});
