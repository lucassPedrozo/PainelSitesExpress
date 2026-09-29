import { describe, expect, it } from "vitest";
import type { BuildFile, BuildPackage } from "@/lib/api";
import {
  composePrompt,
  filterFiles,
  initialSelection,
  selectAll,
  summarizeSelection,
} from "./generation-prompt";

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
    recommended: false,
    ...over,
  }) as BuildFile;

const pacote = (files: BuildFile[], limits = {}): BuildPackage =>
  ({
    prompt: { found: true, text: "briefing", file: null },
    files,
    limits: { maxPromptChars: 100, maxAttachments: 2, maxAttachmentBytes: 1000, ...limits },
    generation: { enabled: true, reason: null },
  }) as BuildPackage;

describe("composePrompt", () => {
  it("junta briefing e observações em blocos separados", () => {
    expect(composePrompt("Briefing do cliente", "Use azul")).toBe(
      "Briefing do cliente\n\n## Observações adicionais\nUse azul",
    );
  });

  it("sem observações, o prompt é só o briefing", () => {
    expect(composePrompt("  Briefing  ", "   ")).toBe("Briefing");
  });

  it("sem briefing no Drive, as observações são o prompt", () => {
    expect(composePrompt("", "Site de uma padaria")).toBe("Site de uma padaria");
  });
});

describe("initialSelection", () => {
  it("marca só o recomendado, até o teto por envio", () => {
    const files = [
      arquivo({ id: "a", recommended: true }),
      arquivo({ id: "b", recommended: true }),
      arquivo({ id: "c", recommended: true }),
      arquivo({ id: "d" }),
    ];
    expect([...initialSelection(files, 2)]).toEqual(["a", "b"]);
  });

  it("o compactado vem antes das imagens: é ele que leva as fotos que não cabem", () => {
    const files = [
      arquivo({ id: "a", recommended: true }),
      arquivo({ id: "b", recommended: true }),
      arquivo({ id: "fotos", kind: "archive", recommended: true }),
    ];
    expect([...initialSelection(files, 2)]).toEqual(["fotos", "a"]);
  });
});

describe("selectAll", () => {
  it("ignora o que está bloqueado e respeita o teto", () => {
    const files = [
      arquivo({ id: "a" }),
      arquivo({ id: "grande", blockedReason: "Acima do limite" }),
      arquivo({ id: "b" }),
      arquivo({ id: "c" }),
    ];
    expect([...selectAll(files, 2)]).toEqual(["a", "b"]);
  });
});

describe("summarizeSelection", () => {
  it("conta bytes, teto de anexos e tamanho do prompt de fato enviado", () => {
    const pkg = pacote([
      arquivo({ id: "a", size: 100, recommended: true }),
      arquivo({ id: "b", size: 250, recommended: true }),
      arquivo({ id: "c", size: null, recommended: true }),
    ]);

    const resumo = summarizeSelection(pkg, new Set(["a", "b", "c"]), "x".repeat(101));

    expect(resumo.chosen).toHaveLength(3);
    expect(resumo.totalBytes).toBe(350);
    expect(resumo.overLimit).toBe(true);
    // O prompt contado é o final (briefing + observações), não o briefing cru.
    expect(resumo.promptChars).toBe(101);
    expect(resumo.promptTooLong).toBe(true);
    expect(resumo.capped).toBe(true);
    expect(resumo.recommended).toBe(3);
  });

  it("conta os bloqueados para o aviso da tela", () => {
    const pkg = pacote([
      arquivo({ id: "a" }),
      arquivo({ id: "b", blockedReason: "Acima do limite de 64 MB" }),
    ]);
    const resumo = summarizeSelection(pkg, new Set(["a"]), "curto");
    expect(resumo.blocked).toBe(1);
    expect(resumo.overLimit).toBe(false);
    expect(resumo.promptTooLong).toBe(false);
  });
});

describe("filterFiles", () => {
  it("acha por nome e por subpasta", () => {
    const files = [
      arquivo({ id: "a", name: "logo.png" }),
      arquivo({ id: "b", name: "banner.png", folder: "Fotos da loja" }),
    ];
    expect(filterFiles(files, "LOGO").map((f) => f.id)).toEqual(["a"]);
    expect(filterFiles(files, "loja").map((f) => f.id)).toEqual(["b"]);
    expect(filterFiles(files, "  ")).toHaveLength(2);
  });
});
