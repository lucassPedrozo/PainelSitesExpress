import { describe, expect, it } from "vitest";
import type { DevArea } from "@/lib/api";
import { devAreaSteps } from "@/features/projects/dev-area-steps";

const area = (over: Partial<DevArea> = {}): DevArea => ({
  state: "publishing",
  slug: "cliente",
  url: "https://area.dev/cliente/",
  repoFullName: "org/cliente",
  branch: "main",
  configuredAt: "t",
  lastRun: { at: "t", status: "pending", runUrl: "https://gh/run/1", sha: "abc" },
  publishedSha: null,
  publishedAt: null,
  detail: null,
  ...over,
});

const status = (steps: ReturnType<typeof devAreaSteps>) => steps.map((step) => step.status);

describe("devAreaSteps", () => {
  it("sem repositório, a etapa atual é conectar no Lovable — e leva ao editor", () => {
    const steps = devAreaSteps(
      area({ state: "waiting-repo", repoFullName: null, lastRun: null }),
      "unknown",
      "https://lovable.dev/projects/x",
    );
    expect(status(steps)).toEqual(["active", "waiting", "waiting"]);
    expect(steps[0].href).toBe("https://lovable.dev/projects/x");
  });

  it("publicando, diz quanto leva e onde acompanhar", () => {
    const steps = devAreaSteps(area(), "unknown", null);
    expect(status(steps)).toEqual(["done", "active", "waiting"]);
    expect(steps[1].detail).toContain("1 a 5 minutos");
    expect(steps[1].href).toBe("https://gh/run/1");
  });

  it("falhou: mostra o motivo lido do log, não só 'veja o GitHub'", () => {
    const motivo = "Este projeto e renderizado no servidor: o build gerou .output/server.";
    const steps = devAreaSteps(
      area({ state: "failed", detail: motivo, lastRun: { at: "t", status: "failure", runUrl: "https://gh/run/2", sha: "abc" } }),
      "unknown",
      null,
    );
    expect(status(steps)).toEqual(["done", "error", "waiting"]);
    expect(steps[1].detail).toBe(motivo);
  });

  it("build terminado, mas pasta ainda não conferida: está conferindo", () => {
    const steps = devAreaSteps(
      area({ lastRun: { at: "t", status: "success", runUrl: null, sha: "abc" } }),
      "unknown",
      null,
    );
    expect(status(steps)).toEqual(["done", "done", "active"]);
  });

  it("conferida e abrindo: pronto para enviar", () => {
    const steps = devAreaSteps(
      area({ state: "live", publishedSha: "abc", lastRun: { at: "t", status: "success", runUrl: null, sha: "abc" } }),
      "alive",
      null,
    );
    expect(status(steps)).toEqual(["done", "done", "done"]);
    expect(steps[2].label).toContain("pronto para enviar");
  });

  it("republicando um site já no ar avisa que o link segue com a versão anterior", () => {
    const steps = devAreaSteps(area({ publishedSha: "velho" }), "alive", null);
    expect(steps[2].detail).toContain("versão anterior");
  });
});
