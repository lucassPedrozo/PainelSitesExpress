import { describe, expect, it } from "vitest";
import type { Publication } from "@/lib/api/deploy";
import { deployAuthor } from "./publications-card";

const base: Publication = {
  repoFullName: "org/site",
  domain: "site.com.br",
  branch: "main",
  configuredAt: "2026-10-01T10:00:00.000Z",
  configuredBy: "Ana",
  deploys: [],
};

describe("deployAuthor", () => {
  it("assina o envio com quem disparou quando o disparo é esse envio", () => {
    expect(
      deployAuthor({
        ...base,
        lastDeployAt: "2026-10-10T12:00:05.000Z",
        deploys: [{ at: "2026-10-10T12:00:00.000Z", by: "Ana", dryRun: false }],
      }),
    ).toBe("Ana");
  });

  it("não assina um envio antigo com o autor de uma simulação recente", () => {
    expect(
      deployAuthor({
        ...base,
        lastDeployAt: "2026-10-01T12:00:00.000Z",
        deploys: [
          { at: "2026-10-12T09:00:00.000Z", by: "Bruno", dryRun: true },
          { at: "2026-10-05T09:00:00.000Z", by: "Carla", dryRun: false },
        ],
      }),
    ).toBeNull();
  });

  it("atribui ao Lovable o envio que veio de um push", () => {
    expect(
      deployAuthor({
        ...base,
        lastDeployAt: "2026-10-10T12:00:00.000Z",
        deploys: [{ at: "2026-10-01T12:00:00.000Z", by: "Ana", dryRun: false }],
        lastRun: { at: "2026-10-10T12:00:00.000Z", status: "success", runUrl: null, event: "push" },
      }),
    ).toBe("edição no Lovable");
  });

  it("aceita relógios desencontrados quando a execução mais recente é o disparo real", () => {
    expect(
      deployAuthor({
        ...base,
        lastDeployAt: "2026-10-10T13:00:00.000Z",
        deploys: [{ at: "2026-10-10T12:00:00.000Z", by: "Ana", dryRun: false }],
        lastRun: {
          at: "2026-10-10T13:00:00.000Z",
          status: "success",
          runUrl: null,
          event: "workflow_dispatch",
        },
      }),
    ).toBe("Ana");
  });

  it("nunca publicado não tem autor", () => {
    expect(deployAuthor({ ...base, lastDeployAt: null })).toBeNull();
  });
});
