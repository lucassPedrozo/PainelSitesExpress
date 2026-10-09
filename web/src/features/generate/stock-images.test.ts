import { describe, expect, it } from "vitest";
import type { StockCandidate, StockSearchResult } from "@/lib/api";
import { stockImageName, stockImagesBlock, stockZipPath } from "@shared/stock-images.js";
import { composePrompt, summarizeSelection } from "./generation-prompt";
import { nextStockSelection, rowsFromQueries, termsToSearch, toggleStockPick } from "./stock-images";

const foto = (id: number): StockCandidate => ({
  id,
  width: 1920,
  height: 1280,
  tags: "",
  user: "autor",
  pageUrl: null,
});

const resultado = (
  term: string,
  quantity: number,
  ids: number[],
  section: string | null = null,
): StockSearchResult => ({ term, quantity, section, images: ids.map(foto) });

describe("termsToSearch", () => {
  it("ignora linha sem termo e corrige a quantidade", () => {
    const rows = [
      { key: 1, term: " padaria ", section: "hero", quantity: "3" },
      { key: 2, term: "", section: "sobre", quantity: "2" },
      { key: 3, term: "pão", section: "", quantity: "abc" },
      { key: 4, term: "café", section: "", quantity: "99" },
    ];
    expect(termsToSearch(rows, 5, 10)).toEqual([
      { term: "padaria", section: "hero", quantity: 3 },
      { term: "pão", section: null, quantity: 5 },
      { term: "café", section: null, quantity: 10 },
    ]);
  });
});

describe("rowsFromQueries", () => {
  it("as buscas do assistente viram linhas do formulário, nos tetos, com chaves novas", () => {
    let chave = 100;
    const rows = rowsFromQueries(
      [
        { term: " dentista atendendo ", section: "hero", quantity: 3 },
        { term: "", section: "sobre", quantity: 2 },
        { term: "consultório", section: "sobre", quantity: 99 },
        { term: "equipe sorrindo", section: "equipe", quantity: 2 },
      ],
      { maxTerms: 2, maxQuantity: 10, defaultQuantity: 5 },
      () => ++chave,
    );
    expect(rows).toEqual([
      { key: 101, term: "dentista atendendo", section: "hero", quantity: "3" },
      { key: 102, term: "consultório", section: "sobre", quantity: "10" },
    ]);
  });
});

describe("nextStockSelection", () => {
  it("marca as primeiras de cada grupo novo, na quantidade pedida", () => {
    const sel = nextStockSelection(new Map(), [
      resultado("padaria", 2, [1, 2, 3, 4], "hero"),
      resultado("pão", 1, [5, 6]),
    ]);
    expect([...sel.keys()]).toEqual([1, 2, 5]);
    expect(sel.get(1)?.section).toBe("hero");
  });

  it("numa busca repetida, mantém o que a pessoa escolheu no mesmo grupo", () => {
    let sel = nextStockSelection(new Map(), [resultado("padaria", 2, [1, 2, 3, 4])]);
    sel = toggleStockPick(sel, foto(1), { term: "padaria", section: null });
    sel = toggleStockPick(sel, foto(4), { term: "padaria", section: null });

    const depois = nextStockSelection(sel, [
      resultado("padaria", 2, [1, 2, 3, 4]),
      resultado("café", 1, [9]),
    ]);
    expect([...depois.keys()]).toEqual([2, 4, 9]);
  });

  it("grupo que saiu da busca sai da seleção, e foto repetida fica no primeiro grupo", () => {
    const antes = nextStockSelection(new Map(), [resultado("padaria", 1, [1])]);
    const depois = nextStockSelection(antes, [
      resultado("pão", 2, [7, 8], "hero"),
      resultado("pão francês", 2, [8, 10]),
    ]);
    expect([...depois.keys()]).toEqual([7, 8, 10]);
    expect(depois.get(8)?.term).toBe("pão");
  });
});

describe("prompt com imagens de banco", () => {
  it("o bloco cita o zip e os caminhos que a API grava dentro dele", () => {
    const fotos = [
      { id: 11, term: "escritório moderno", section: "Hero" },
      { id: 12, term: "escritório moderno", section: "Hero" },
      { id: 13, term: "Café", section: null },
    ];
    const bloco = stockImagesBlock(fotos);

    expect(stockImageName(fotos[0])).toBe("pixabay-hero-11.jpg");
    expect(stockZipPath(fotos[2])).toBe("cafe/pixabay-cafe-13.jpg");
    expect(bloco).toContain("“imagens-pixabay.zip” traz 3 fotos");
    expect(bloco).toContain(
      "Seção “Hero” (busca: “escritório moderno”): hero/pixabay-hero-11.jpg, hero/pixabay-hero-12.jpg",
    );
    expect(bloco).toContain("Fotos de “Café”: cafe/pixabay-cafe-13.jpg");
  });

  it("vai depois das observações, e não existe sem foto", () => {
    expect(composePrompt("Briefing", "Use azul", stockImagesBlock([]))).toBe(
      "Briefing\n\n## Observações adicionais\nUse azul",
    );
    const final = composePrompt("Briefing", "", stockImagesBlock([{ id: 1, term: "pão" }]));
    expect(final.startsWith("Briefing\n\n## Imagens de banco (Pixabay)")).toBe(true);
  });

  it("só fotos, sem briefing nem observações, não viram prompt", () => {
    expect(composePrompt("", "", stockImagesBlock([{ id: 1, term: "pão" }]))).toBe("");
  });
});

describe("teto de anexos com imagens de banco", () => {
  it("o zip ocupa uma vaga, qualquer que seja a quantidade de fotos", () => {
    const pkg = {
      prompt: { found: true, text: "b", file: null, others: 0 },
      files: [],
      limits: { maxPromptChars: 100, maxAttachments: 3, maxAttachmentBytes: 1000 },
      generation: { enabled: true, reason: null },
      signature: { files: [], missing: [] },
    };
    const resumo = summarizeSelection(pkg, new Set(["a", "b"]), "b", 40);
    expect(resumo.attachmentCount).toBe(3);
    expect(resumo.overLimit).toBe(false);
    expect(summarizeSelection(pkg, new Set(["a", "b"]), "b", 0).attachmentCount).toBe(2);
  });
});
