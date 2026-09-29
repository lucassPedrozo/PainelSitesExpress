import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api";
import { formatElapsed, progressOf, stepLabel } from "@/features/projects/project-progress";

const projeto = (over: Record<string, unknown> = {}): Project =>
  ({
    id: "p1",
    name: "[04/09/2026] cliente.com.br",
    generations: [],
    publication: null,
    tagIds: [],
    ...over,
  }) as unknown as Project;

const geracao = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  createdAt: "2026-09-24T12:00:00Z",
  agentState: "running",
  agentActivity: null,
  devArea: null,
  ...over,
});

describe("progressOf", () => {
  it("nada em curso, nada a mostrar", () => {
    expect(progressOf(projeto())).toBeNull();
    expect(progressOf(projeto({ generations: [geracao({ agentState: "done" })] }))).toBeNull();
  });

  it("gerando: mostra a fase, a ação atual e as contagens", () => {
    const modelo = progressOf(
      projeto({
        generations: [
          geracao({
            agentActivity: {
              startedAt: "2026-09-24T12:00:05Z",
              steps: 34,
              filesWritten: 12,
              current: "Criando src/components/Hero.tsx",
              phase: "writing",
            },
          }),
        ],
      }),
    );
    expect(modelo?.kind).toBe("agent");
    if (modelo?.kind !== "agent") return;
    expect(modelo.startedAt).toBe("2026-09-24T12:00:05Z");
    expect(modelo.phases.map((fase) => fase.state)).toEqual(["done", "active", "todo", "todo"]);
    expect(modelo.current).toBe("Criando src/components/Hero.tsx");
    expect(modelo.counts).toBe("12 arquivos escritos · 34 ações");
  });

  it("recém-criado, sem atividade lida ainda: conta desde a criação", () => {
    const modelo = progressOf(projeto({ generations: [geracao()] }));
    expect(modelo?.startedAt).toBe("2026-09-24T12:00:00Z");
    expect(modelo?.kind === "agent" && modelo.current).toBe("Iniciando…");
  });

  it("publicando na área de aprovação: o passo do deploy, em português", () => {
    const modelo = progressOf(
      projeto({
        generations: [
          geracao({
            agentState: "done",
            devArea: {
              state: "publishing",
              lastRun: {
                at: "2026-09-24T13:00:00Z",
                status: "pending",
                runUrl: "https://gh/run/1",
                sha: null,
                progress: { total: 12, done: 6, current: "Install dependencies and build" },
              },
            },
          }),
        ],
      }),
    );
    expect(modelo?.kind).toBe("run");
    if (modelo?.kind !== "run") return;
    expect(modelo.title).toBe("Publicando na área de aprovação");
    expect(modelo.fraction).toBe(0.5);
    expect(modelo.step).toBe("Passo 7 de 12 · Instalando dependências e gerando o site");
    expect(modelo.href).toBe("https://gh/run/1");
  });

  it("a publicação no domínio do cliente vem primeiro", () => {
    const modelo = progressOf(
      projeto({
        generations: [geracao()],
        publication: {
          domain: "cliente.com.br",
          lastAttempt: { at: "t", status: "pending", runUrl: null, progress: null },
        },
      }),
    );
    expect(modelo?.title).toBe("Publicando em cliente.com.br");
    expect(modelo?.kind === "run" && modelo.step).toBe("Esperando o GitHub iniciar…");
  });
});

describe("formatElapsed e stepLabel", () => {
  it("formata o tempo decorrido", () => {
    expect(formatElapsed(45_000)).toBe("45 s");
    expect(formatElapsed(192_000)).toBe("3 min 12 s");
    expect(formatElapsed(3_900_000)).toBe("1 h 05 min");
  });

  it("passo desconhecido fica com o nome original", () => {
    expect(stepLabel("Upload via FTP")).toBe("Enviando os arquivos por FTP");
    expect(stepLabel("Algo novo")).toBe("Algo novo");
  });
});
