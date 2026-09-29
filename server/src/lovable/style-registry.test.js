import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractStyleLine,
  insertStyleEntry,
  KNOWLEDGE_LIMIT,
} from "./style-registry.js";

const base = (entries = "") =>
  `# Base\n\n**Já usado**:\n<!-- ja-usado:inicio -->\n${entries}<!-- ja-usado:fim -->\n\n## 5. Hero`;

describe("registro do já usado", () => {
  it("acha a última linha da resposta, com entidades e crases", () => {
    const resposta =
      '<lov-tool-use data="Já usado: <cliente>: …"></lov-tool-use>\n' +
      "Pronto.\n`Já usado: D&amp;A: grafite, laranja · Archivo · hero 4 · rota contínua`";
    assert.equal(
      extractStyleLine(resposta),
      "D&A: grafite, laranja · Archivo · hero 4 · rota contínua",
    );
  });

  it("sem a linha, ou só o modelo do formato, não registra", () => {
    assert.equal(extractStyleLine("Site construído."), null);
    assert.equal(extractStyleLine("Já usado: <cliente>: <paleta>"), null);
    assert.equal(extractStyleLine(null), null);
    // Dentro do JSON de uma ferramenta do Lovable: o fim do JSON não entra.
    assert.equal(
      extractStyleLine('data="{\\"message\\":\\"Pronto. Já usado: Tresmares: Aço · Archivo · hero 3 · malha\\"}">'),
      "Tresmares: Aço · Archivo · hero 3 · malha",
    );
  });

  it("entra no topo, sem repetir, e guarda só as cinco últimas", () => {
    const antigas = ["a", "b", "c", "d", "e"].map((x) => `- ${x}\n`).join("");
    const nova = insertStyleEntry(base(antigas), "f");
    assert.match(nova, /inicio -->\n- f\n- a\n- b\n- c\n- d\n<!-- ja-usado:fim/);
    // O resto da Knowledge não muda.
    assert.ok(nova.startsWith("# Base") && nova.endsWith("## 5. Hero"));

    const repetida = insertStyleEntry(nova, "a");
    assert.match(repetida, /inicio -->\n- a\n- f\n- b\n/);
  });

  it("descarta as mais antigas para caber no limite do Lovable", () => {
    // Preenchida para caber exatamente uma entrada "nova".
    const vazia = base();
    const folga = KNOWLEDGE_LIMIT - vazia.length - "- nova\n".length;
    const cheia = vazia
      .replace("# Base", "# Base" + "x".repeat(folga))
      .replace("<!-- ja-usado:fim", "- antiga\n<!-- ja-usado:fim");
    const nova = insertStyleEntry(cheia, "nova");
    assert.ok(nova.length <= KNOWLEDGE_LIMIT);
    assert.match(nova, /- nova\n/);
    assert.doesNotMatch(nova, /antiga/);
  });

  it("sem os marcadores, não toca na Knowledge", () => {
    assert.equal(insertStyleEntry("# Base sem bloco", "x"), null);
  });
});
