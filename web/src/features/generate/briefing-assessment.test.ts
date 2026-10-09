import { describe, expect, it } from "vitest";
import type { BuildFile, BuildPackage } from "@/lib/api";
import { assessBriefing, looksLikeLogo, SHORT_BRIEF_CHARS } from "./briefing-assessment";

const arquivo = (over: Partial<BuildFile> & { id: string }): BuildFile =>
  ({
    name: `${over.id}.png`,
    folder: null,
    mimeType: "image/png",
    kind: "image",
    size: 100,
    modifiedTime: "2026-09-01T00:00:00.000Z",
    webViewLink: "",
    hasThumbnail: false,
    uploadName: `${over.id}.png`,
    exportedToPdf: false,
    isBrief: false,
    blockedReason: null,
    attachWarning: null,
    recommended: true,
    ...over,
  }) as BuildFile;

const pacote = (files: BuildFile[], missing: string[] = []): BuildPackage =>
  ({
    prompt: { found: true, text: "", file: null, others: 0 },
    files,
    limits: { maxPromptChars: 100_000, maxAttachments: 20, maxAttachmentBytes: 1000 },
    generation: { enabled: true, reason: null },
    signature: { files: ["logo-dark.png", "logo-light.png"], missing },
  }) as BuildPackage;

const longo = "Somos uma empresa de manutenção industrial em Joinville. ".repeat(20);

const byKey = (items: ReturnType<typeof assessBriefing>["items"]) =>
  Object.fromEntries(items.map((item) => [item.key, item]));

describe("assessBriefing", () => {
  it("material completo: tudo verde e uma frase só", () => {
    const pkg = pacote([arquivo({ id: "logo" }), arquivo({ id: "fachada" })]);
    const avaliacao = assessBriefing({
      pkg,
      prompt: `${longo} WhatsApp (47) 99999-1234.`,
      observations: "Paleta azul.",
      selected: new Set(["logo", "fachada"]),
      stockCount: 0,
    });
    expect(avaliacao.warnings).toBe(0);
    expect(avaliacao.shallow).toBe(false);
    expect(avaliacao.summary).toBe("Material completo para gerar.");
    const itens = byKey(avaliacao.items);
    expect(itens.logo.status).toBe("ok");
    expect(itens.photos.label).toContain("2 imagens");
    expect(itens.notes.status).toBe("ok");
  });

  it("briefing raso: avisa o que falta e como completar", () => {
    const pkg = pacote([arquivo({ id: "a", kind: "pdf", name: "a.pdf" })]);
    const avaliacao = assessBriefing({
      pkg,
      prompt: "Empresa de manutenção.",
      observations: "",
      selected: new Set(),
      stockCount: 0,
    });
    const itens = byKey(avaliacao.items);
    expect(itens.briefing.status).toBe("warn");
    expect(itens.briefing.label).toContain("curto");
    expect(itens.contact.status).toBe("warn");
    expect(itens.photos.status).toBe("warn");
    expect(itens.logo.label).toBe("Sem logo");
    // Sem observações num envio raso é um aviso, com a dica de usá-las.
    expect(itens.notes.status).toBe("warn");
    expect(avaliacao.shallow).toBe(true);
    expect(avaliacao.summary).toMatch(/^5 pontos a completar/);
  });

  it("sem briefing, as observações são o prompt — e o aviso diz isso", () => {
    const avaliacao = assessBriefing({
      pkg: pacote([]),
      prompt: "",
      observations: "",
      selected: new Set(),
      stockCount: 0,
    });
    expect(byKey(avaliacao.items).briefing.label).toBe("Sem briefing");
    expect(byKey(avaliacao.items).briefing.hint).toMatch(/observações/);
  });

  it("logo na pasta mas não marcada é um aviso diferente de não ter logo", () => {
    const pkg = pacote([arquivo({ id: "l", name: "Logotipo Final.png" })]);
    const avaliacao = assessBriefing({
      pkg,
      prompt: longo,
      observations: "",
      selected: new Set(),
      stockCount: 0,
    });
    expect(byKey(avaliacao.items).logo.label).toBe("Logo não marcada");
  });

  it("fotos de banco cobrem a falta de fotos do cliente sem aviso", () => {
    const avaliacao = assessBriefing({
      pkg: pacote([]),
      prompt: `${longo} contato@empresa.com.br`,
      observations: "",
      selected: new Set(),
      stockCount: 6,
    });
    const itens = byKey(avaliacao.items);
    expect(itens.photos.status).toBe("neutral");
    expect(itens.stock.label).toBe("Banco de imagens · 6 fotos");
  });

  it("assinatura incompleta avisa, e o limiar do briefing curto é o declarado", () => {
    const avaliacao = assessBriefing({
      pkg: pacote([], ["Claro"]),
      prompt: "x".repeat(SHORT_BRIEF_CHARS),
      observations: "",
      selected: new Set(),
      stockCount: 0,
    });
    const itens = byKey(avaliacao.items);
    expect(itens.briefing.status).toBe("ok");
    expect(itens.signature.status).toBe("warn");
    expect(itens.signature.hint).toContain("Rodapé Claro");
  });
});

describe("looksLikeLogo", () => {
  it("reconhece a logo pelo nome, só em imagens", () => {
    expect(looksLikeLogo({ name: "logo.png", kind: "image" })).toBe(true);
    expect(looksLikeLogo({ name: "Marca Registrada.svg", kind: "image" })).toBe(true);
    expect(looksLikeLogo({ name: "logo.pdf", kind: "pdf" })).toBe(false);
    expect(looksLikeLogo({ name: "catalogo.png", kind: "image" })).toBe(false);
  });
});
