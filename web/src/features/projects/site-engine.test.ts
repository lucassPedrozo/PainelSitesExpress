import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import { filterProjects } from "@/features/projects/project-filters";
import { emptyTagFilter } from "@/features/tags/tag-filter";
import { approvalUrlOf, engineOf, latestLovableSite, projectEngines, repoUrlOf, siteUrlOf } from "@/features/projects/site-engine";
import { nextStep } from "@/features/projects/next-step";
import { projectStatus } from "@/features/projects/project-status";
import { stageOf } from "@/features/projects/stage";

/** Com que ferramenta cada site foi feito — e o caminho até o Lovable que não some. */

const site = (over: Partial<Generation> = {}): Generation =>
  ({ id: "3f1c2b9a-0000-4000-8000-000000000001", url: null, lovableName: null, ...over }) as unknown as Generation;

const lovable = (n = 1, over: Partial<Generation> = {}) =>
  site({ id: `3f1c2b9a-0000-4000-8000-00000000000${n}`, ...over });
const claude = () => site({ id: "ext-a1b2c3", engine: "claude" });
const externo = () => site({ id: "ext-d4e5f6", repoFullName: "org/site" });

const projeto = (generations: Generation[], over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "[04/09/2026] cliente.com.br",
    alias: null,
    domain: "cliente.com.br",
    details: null,
    tagIds: [],
    fileCount: 3,
    folderCount: 0,
    brief: null,
    publication: null,
    generations,
    ...over,
  }) as unknown as Project;

describe("engineOf", () => {
  it("separa Lovable, Claude e o que veio de fora dos dois", () => {
    expect(engineOf(lovable())).toBe("lovable");
    expect(engineOf(claude())).toBe("claude");
    expect(engineOf(externo())).toBe("externo");
  });
});

describe("projectEngines", () => {
  it("sem site, nenhuma ferramenta", () => {
    expect(projectEngines(projeto([]))).toEqual([]);
  });

  it("uma vez cada, a do site atual primeiro, com a contagem", () => {
    const engines = projectEngines(projeto([lovable(1), lovable(2), claude()]));
    expect(engines.map((e) => [e.engine, e.count, e.current])).toEqual([
      ["claude", 1, true],
      ["lovable", 2, false],
    ]);
    // O site do Lovable lembrado é o mais recente dele.
    expect(engines[1].site.id).toBe(lovable(2).id);
  });
});

describe("latestLovableSite", () => {
  it("acha o site do Lovable mesmo com um do Claude depois dele", () => {
    expect(latestLovableSite(projeto([lovable(1), claude()]))?.id).toBe(lovable(1).id);
    expect(latestLovableSite(projeto([claude(), externo()]))).toBeUndefined();
  });
});

describe("busca pela ferramenta", () => {
  const opcoes = (query: string) => ({ query, tagFilter: emptyTagFilter, tab: "ativos" as const, finishedTagId: null });
  const projetos = [
    projeto([lovable(1, { lovableName: "aurora-odonto" })], { id: "a" }),
    projeto([claude()], { id: "b" }),
    projeto([], { id: "c" }),
  ];

  it("“lovable” e “claude” acham os projetos de cada ferramenta", () => {
    expect(filterProjects(projetos, opcoes("lovable")).map((p) => p.id)).toEqual(["a"]);
    expect(filterProjects(projetos, opcoes("Claude")).map((p) => p.id)).toEqual(["b"]);
  });

  it("o nome do projeto no Lovable também acha", () => {
    expect(filterProjects(projetos, opcoes("aurora")).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("coleta repetida de um domínio que já tem site", () => {
  const outra = { projectId: "pasta-nova", projectName: "[08/09/2026] cliente.com.br", site: lovable(1) };

  it("não pede Gerar: aponta a coleta que tem o site", () => {
    const p = projeto([], { domainSite: outra });
    expect(projectStatus(p).stage).toBe("other-collection");
    expect(nextStep(p)).toMatchObject({ kind: "open-collection", projectId: "pasta-nova" });
    expect(stageOf(p)).toMatchObject({ label: "Outra coleta", group: null });
  });

  it("mostra a ferramenta e o Lovable do site da outra coleta", () => {
    const p = projeto([], { domainSite: outra });
    expect(projectEngines(p)).toMatchObject([{ engine: "lovable", elsewhere: true, current: true }]);
    expect(latestLovableSite(p)?.id).toBe(lovable(1).id);
  });

  it("no ar, o domínio publicado continua valendo", () => {
    const p = projeto([], {
      domainSite: outra,
      publication: { domain: "cliente.com.br", repoFullName: "org/x", configuredAt: null, lastDeployAt: "2026-09-20T10:00:00.000Z", lastAttempt: null },
    } as Partial<Project>);
    expect(projectStatus(p).stage).toBe("live");
  });

  it("a coleta com o próprio site não muda", () => {
    const p = projeto([claude()], { domainSite: outra });
    expect(projectEngines(p).map((e) => e.engine)).toEqual(["claude"]);
  });
});

describe("os endereços do projeto", () => {
  it("o site abre o domínio publicado, senão o do projeto; sem domínio, nada", () => {
    expect(siteUrlOf(projeto([]))).toBe("https://cliente.com.br");
    expect(siteUrlOf(projeto([], { publication: { domain: "www.cliente.com.br" } } as Partial<Project>))).toBe("https://www.cliente.com.br");
    expect(siteUrlOf(projeto([], { domain: null }))).toBeNull();
  });

  it("a aprovação é o link do cliente: a pasta publicada ou o link curto; sem ele, nada", () => {
    expect(approvalUrlOf(projeto([lovable(1)]))).toBeNull();
    expect(approvalUrlOf(projeto([lovable(1, { clientUrl: "https://aprovacao.exemplo.com.br/cliente/" } as Partial<Generation>)]))).toBe(
      "https://aprovacao.exemplo.com.br/cliente/",
    );
    expect(approvalUrlOf(projeto([lovable(1, { shortUrl: "https://link.exemplo.com.br/x" })]))).toBe("https://link.exemplo.com.br/x");
    // Coleta repetida: vale o link do site da outra coleta.
    const outra = { projectId: "p2", projectName: "x", site: lovable(2, { clientUrl: "https://aprovacao.exemplo.com.br/y/" } as Partial<Generation>) };
    expect(approvalUrlOf(projeto([], { domainSite: outra }))).toBe("https://aprovacao.exemplo.com.br/y/");
  });

  it("o repositório é o do site atual, senão o da publicação; antes do GitHub, nada", () => {
    expect(repoUrlOf(projeto([lovable(1)]))).toBeNull();
    expect(repoUrlOf(projeto([externo()]))).toBe("https://github.com/org/site");
    const naArea = lovable(1, { devArea: { repoFullName: "org/area" } } as Partial<Generation>);
    expect(repoUrlOf(projeto([naArea]))).toBe("https://github.com/org/area");
    // Vale o site mais recente, não o primeiro que teve repositório.
    expect(repoUrlOf(projeto([externo(), lovable(2, { repoFullName: "org/novo" })]))).toBe("https://github.com/org/novo");
    expect(repoUrlOf(projeto([], { publication: { repoFullName: "org/publicado" } } as Partial<Project>))).toBe(
      "https://github.com/org/publicado",
    );
    // Coleta repetida: vale o repositório do site da outra coleta.
    const outra = { projectId: "p2", projectName: "x", site: externo() };
    expect(repoUrlOf(projeto([], { domainSite: outra }))).toBe("https://github.com/org/site");
  });
});
