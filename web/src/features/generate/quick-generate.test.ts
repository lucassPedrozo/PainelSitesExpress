import { describe, expect, it } from "vitest";
import type { BuildFile, BuildPackage, Project } from "@/lib/api";
import { quickPlan } from "@/features/generate/quick-generate";

const arquivo = (id: string, recommended = true): BuildFile =>
  ({ id, name: `${id}.jpg`, recommended, blockedReason: null }) as unknown as BuildFile;

const pacote = (over: Partial<BuildPackage> = {}): BuildPackage =>
  ({
    prompt: { found: true, text: "# Instrução\nConstrua o site", file: null, others: 0 },
    files: [arquivo("a"), arquivo("b"), arquivo("c", false)],
    limits: { maxPromptChars: 50_000, maxAttachments: 10, maxAttachmentBytes: 1 },
    generation: { enabled: true, reason: null },
    signature: { files: [], missing: [] },
    ...over,
  }) as BuildPackage;

const projeto = (over: Partial<Project> = {}) =>
  ({ generations: [], ...over }) as unknown as Project;

describe("quickPlan", () => {
  it("envia o briefing como está e as imagens recomendadas", () => {
    const plano = quickPlan(projeto(), pacote());
    expect(plano).toMatchObject({ ok: true, fileIds: ["a", "b"], attachments: 2, warnings: [] });
  });

  it("sem briefing não há envio padrão", () => {
    const plano = quickPlan(
      projeto(),
      pacote({ prompt: { found: false, text: "", file: null, others: 0 } }),
    );
    expect(plano.ok).toBe(false);
  });

  it("briefing acima do limite é recusado antes de gastar crédito", () => {
    const plano = quickPlan(
      projeto(),
      pacote({ limits: { maxPromptChars: 5, maxAttachments: 10, maxAttachmentBytes: 1 } }),
    );
    expect(plano.ok).toBe(false);
  });

  it("avisa o que vale saber: site já gerado, briefing repetido, imagens cortadas", () => {
    const plano = quickPlan(
      projeto({ generations: [{}] as never }),
      pacote({
        prompt: { found: true, text: "briefing", file: null, others: 1 },
        limits: { maxPromptChars: 50_000, maxAttachments: 1, maxAttachmentBytes: 1 },
      }),
    );
    expect(plano.ok && plano.warnings).toHaveLength(3);
  });
});
