import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import { groupByNextStep, isDone } from "@/features/projects/work-queue";

const projeto = (id: string, over: Partial<Project> = {}): Project =>
  ({
    id,
    name: `[04/09/2026] ${id}.com.br`,
    alias: null,
    fileCount: 3,
    folderCount: 0,
    generations: [],
    brief: null,
    publication: null,
    ...over,
  }) as unknown as Project;

const comSite = (over: Partial<Generation>) =>
  [{ id: "g", previewState: "unknown", agentState: "done", ...over }] as Generation[];

describe("groupByNextStep", () => {
  it("ordena por urgência e deixa de fora o que está no ar", () => {
    const noAr = projeto("noar", {
      publication: {
        domain: "noar.com.br",
        repoFullName: "org/noar",
        configuredAt: null,
        lastDeployAt: "t",
        lastAttempt: { at: "t", status: "success", runUrl: null },
      },
    });
    const grupos = groupByNextStep([
      projeto("briefing", { brief: { id: "b" } as never }),
      projeto("enviar", { generations: comSite({ shortUrl: "https://s/x", previewState: "alive" }) }),
      noAr,
      projeto("caiu", {
        generations: comSite({ sharePreviewUrl: "https://lovable.dev/preview/x", previewState: "dead" }),
      }),
    ]);

    expect(grupos.map((g) => g.key)).toEqual(["link-broken", "send", "generate"]);
    expect(isDone(noAr)).toBe(true);
  });

  it("mantém a ordem de entrada dentro do grupo", () => {
    const grupos = groupByNextStep([
      projeto("b", { brief: { id: "1" } as never }),
      projeto("a", { brief: { id: "2" } as never }),
    ]);
    expect(grupos[0].items.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
