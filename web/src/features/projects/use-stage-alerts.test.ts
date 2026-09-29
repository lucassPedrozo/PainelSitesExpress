import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import { stageAlerts } from "@/features/projects/use-stage-alerts";
import type { ProjectStage } from "@/features/projects/project-status";

const projeto = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "[04/09/2026] cliente.com.br",
    alias: null,
    fileCount: 3,
    folderCount: 0,
    generations: [],
    brief: null,
    publication: null,
    ...over,
  }) as unknown as Project;

const comAgente = (agentState: Generation["agentState"]) =>
  projeto({ generations: [{ id: "g", agentState, previewState: "unknown" } as Generation] });

const antes = (stage: ProjectStage) => new Map([["p1", stage]]);

describe("stageAlerts", () => {
  it("avisa quando o agente termina ou para", () => {
    const pronto = stageAlerts(antes("building"), [comAgente("done")]);
    expect(pronto).toHaveLength(1);
    expect(pronto[0].title).toBe("Site pronto: cliente.com.br");

    const parado = stageAlerts(antes("building"), [comAgente("awaiting")]);
    expect(parado[0].tone).toBe("warning");
  });

  it("avisa o resultado da publicação", () => {
    const publicacao = {
      domain: "cliente.com.br",
      repoFullName: "org/cliente",
      configuredAt: null,
      lastDeployAt: "t",
      lastAttempt: { at: "t", status: "success" as const, runUrl: null },
    };
    expect(stageAlerts(antes("deploying"), [projeto({ publication: publicacao })])[0].title).toBe(
      "No ar: cliente.com.br",
    );

    const falhou = { ...publicacao, lastAttempt: { ...publicacao.lastAttempt, status: "failure" as const } };
    expect(stageAlerts(antes("deploying"), [projeto({ publication: falhou })])[0].tone).toBe("error");
  });

  it("não avisa o que não mudou, nem projeto que acabou de aparecer", () => {
    expect(stageAlerts(antes("building"), [comAgente("running")])).toEqual([]);
    expect(stageAlerts(new Map(), [comAgente("done")])).toEqual([]);
  });
});
