import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api";
import { emptyTagFilter } from "@/features/tags/tag-filter";
import {
  collectedAtOf,
  countTabs,
  countTags,
  filterProjects,
  hasActiveFilters,
  sortProjects,
  type FilterOptions,
} from "@/features/projects/project-filters";

/** Projeto mínimo — só os campos que estas regras leem. */
const projeto = (over: Partial<Project> & { id: string }): Project =>
  ({
    name: "[04/09/2026] exemplo.com.br",
    alias: null,
    createdTime: "2026-09-04T00:00:00.000Z",
    lastActivity: "2026-09-04T00:00:00.000Z",
    fileCount: 1,
    folderCount: 0,
    totalSize: 1000,
    kinds: {},
    tagIds: [],
    generations: [],
    brief: null,
    publication: null,
    webViewLink: "",
    ...over,
  }) as unknown as Project;

const vivo = {
  domain: "a.com.br",
  repoFullName: "org/a",
  configuredAt: null,
  lastDeployAt: "2026-09-10T00:00:00.000Z",
  lastAttempt: null,
};
const falhou = {
  ...vivo,
  lastAttempt: { at: "2026-09-12T00:00:00.000Z", status: "failure", runUrl: null },
};
const gerado = (id: string, extra: object = {}) => ({
  id,
  createdAt: "2026-09-05T00:00:00.000Z",
  agentState: "done",
  previewState: "unknown",
  sharePreviewUrl: null,
  deliveredAt: null,
  devArea: null,
  clientUrl: null,
  ...extra,
});

const base: FilterOptions = {
  query: "",
  tagFilter: emptyTagFilter,
  tab: "ativos",
  finishedTagId: "fim",
  etapa: null,
  group: null,
};

describe("filterProjects — abas", () => {
  const lista = [
    projeto({ id: "ativo", brief: { id: "b", name: "Informações do Site", mimeType: "x", createdTime: null } }),
    projeto({ id: "no-ar", publication: vivo } as never),
    // No ar, mas com a última publicação falhando: é problema, não descanso.
    projeto({ id: "no-ar-falhou", publication: falhou } as never),
    projeto({ id: "finalizado", tagIds: ["fim"], publication: vivo } as never),
  ];

  it("Ativos é o que não está no ar nem finalizado", () => {
    expect(filterProjects(lista, base).map((p) => p.id)).toEqual(["ativo", "no-ar-falhou"]);
  });

  it("No ar e Finalizados são abas próprias, sem se misturar", () => {
    expect(filterProjects(lista, { ...base, tab: "no-ar" }).map((p) => p.id)).toEqual(["no-ar"]);
    expect(filterProjects(lista, { ...base, tab: "finalizados" }).map((p) => p.id)).toEqual(["finalizado"]);
  });

  it("conta cada aba com a busca e as tags aplicadas", () => {
    expect(countTabs(lista, base)).toEqual({ ativos: 2, "no-ar": 1, finalizados: 1, ocultos: 0 });
    expect(countTabs(lista, { ...base, query: "inexistente" })).toEqual({ ativos: 0, "no-ar": 0, finalizados: 0, ocultos: 0 });
  });
});

describe("filterProjects — busca, tags e etapa", () => {
  it("busca no nome da pasta, no apelido e no domínio", () => {
    const lista = [
      projeto({ id: "a", name: "[04/09/2026] aurora.eng.br" }),
      projeto({ id: "b", name: "[04/09/2026] Cliente Sem Dominio", alias: "Padaria" }),
    ];
    expect(filterProjects(lista, { ...base, query: "aurora" }).map((p) => p.id)).toEqual(["a"]);
    // O apelido é do painel, mas quem renomeou procura por ele.
    expect(filterProjects(lista, { ...base, query: "padaria" }).map((p) => p.id)).toEqual(["b"]);
  });

  it("filtra por tag em modo Qualquer e em modo Todas, e acha o que não foi triado", () => {
    const lista = [
      projeto({ id: "ab", tagIds: ["a", "b"] }),
      projeto({ id: "so-a", tagIds: ["a"] }),
      projeto({ id: "sem" }),
    ];
    const tags = (matchAll: boolean) => ({ ...base, tagFilter: { ...emptyTagFilter, tagIds: ["a", "b"], matchAll } });
    expect(filterProjects(lista, tags(false)).map((p) => p.id)).toEqual(["ab", "so-a"]);
    expect(filterProjects(lista, tags(true)).map((p) => p.id)).toEqual(["ab"]);
    expect(
      filterProjects(lista, { ...base, tagFilter: { ...emptyTagFilter, untaggedOnly: true } }).map((p) => p.id),
    ).toEqual(["sem"]);
  });

  it("filtra pela etapa visível, e “com problema” junta os problemas de todas", () => {
    const lista = [
      projeto({ id: "vazio", fileCount: 0 }),
      projeto({ id: "gerar" }),
      projeto({ id: "link", generations: [gerado("g1")] } as never),
      projeto({ id: "falhou", publication: falhou } as never),
    ];
    expect(filterProjects(lista, { ...base, etapa: "material" }).map((p) => p.id)).toEqual(["vazio"]);
    expect(filterProjects(lista, { ...base, etapa: "link" }).map((p) => p.id)).toEqual(["link"]);
    expect(filterProjects(lista, { ...base, etapa: "problema" }).map((p) => p.id)).toEqual(["falhou"]);
  });
});

describe("filtro por grupo de trabalho", () => {
  const lista = [
    projeto({ id: "vazio", fileCount: 0 }),
    projeto({ id: "gerar-1" }),
    projeto({ id: "gerar-2", tagIds: ["t1"] }),
    projeto({ id: "link", generations: [gerado("g1")] } as never),
    projeto({ id: "falhou", publication: falhou } as never),
    projeto({ id: "no-ar", publication: vivo } as never),
  ];

  it("o grupo segue a busca e as tags", () => {
    expect(filterProjects(lista, { ...base, group: "gerar", tagFilter: { ...emptyTagFilter, tagIds: ["t1"] } })).toHaveLength(1);
  });

  it("o grupo escolhido filtra a lista", () => {
    expect(filterProjects(lista, { ...base, group: "gerar" }).map((p) => p.id)).toEqual(["gerar-1", "gerar-2"]);
  });
});

describe("sortProjects", () => {
  it("prioridade: o que quebrou primeiro, e dentro do grupo o parado há mais tempo", () => {
    const lista = [
      projeto({ id: "gerar-novo", createdTime: "2026-09-10T00:00:00.000Z" }),
      projeto({ id: "vazio", fileCount: 0 }),
      projeto({ id: "falhou", publication: falhou } as never),
      projeto({ id: "gerar-velho", createdTime: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(sortProjects(lista, "prioridade").map((p) => p.id)).toEqual(["falhou", "gerar-velho", "gerar-novo", "vazio"]);
  });

  it("última atividade: o acontecimento mais recente, e não a data dos arquivos do cliente", () => {
    const lista = [
      // A pasta mais antiga, mas com um site gerado ontem.
      projeto({ id: "gerou", createdTime: "2026-09-01T00:00:00.000Z", generations: [gerado("g1", { createdAt: "2026-09-13T00:00:00.000Z" })] } as never),
      projeto({ id: "recebeu", createdTime: "2026-09-10T00:00:00.000Z" }),
    ];
    expect(sortProjects(lista, "atividade").map((p) => p.id)).toEqual(["gerou", "recebeu"]);
  });

  it("coleta: pela data do nome da pasta, nos dois sentidos; nome: na ordem do português", () => {
    const lista = [
      projeto({ id: "meio", name: "[15/08/2026] bravo.com" }),
      projeto({ id: "novo", name: "[04/09/2026] alfa.com" }),
      projeto({ id: "velho", name: "[01/07/2026] charlie.com" }),
    ];
    expect(sortProjects(lista, "coleta-recente").map((p) => p.id)).toEqual(["novo", "meio", "velho"]);
    expect(sortProjects(lista, "coleta-antiga").map((p) => p.id)).toEqual(["velho", "meio", "novo"]);
    expect(sortProjects(lista, "nome").map((p) => p.id)).toEqual(["novo", "meio", "velho"]);
  });

  it("não altera o array recebido", () => {
    const lista = [projeto({ id: "b", name: "[01/01/2026] b.com" }), projeto({ id: "a", name: "[02/01/2026] a.com" })];
    sortProjects(lista, "nome");
    expect(lista.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("a data corrigida à mão vence a do nome da pasta", () => {
    const corrigida = projeto({
      id: "x",
      name: "[01/09/2026] aurora.eng.br",
      details: { receivedAt: "2026-10-02T12:00:00.000Z" },
    } as never);
    expect(collectedAtOf(corrigida).toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it("a data da coleta cai na criação quando o nome da pasta não traz data", () => {
    const sem = projeto({ id: "x", name: "Formulário sem data", createdTime: "2026-08-20T12:00:00.000Z" });
    expect(collectedAtOf(sem).toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });
});

describe("tags e filtros ativos", () => {
  it("tags contam só projetos que existem na lista, na aba aberta", () => {
    const lista = [projeto({ id: "a", tagIds: ["t1", "t2"] }), projeto({ id: "fim", tagIds: ["t1", "fim"] })];
    expect(countTags(lista).get("t1")).toBe(2);
    expect(countTags(lista, base).get("t1")).toBe(1);
    expect(countTags(lista, { ...base, tab: "finalizados" }).get("t1")).toBe(1);
  });

  it("a aba não conta como filtro; busca, contador, etapa e tags sim", () => {
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters({ ...base, tab: "finalizados" })).toBe(false);
    expect(hasActiveFilters({ ...base, query: " x " })).toBe(true);
    expect(hasActiveFilters({ ...base, group: "resolver" })).toBe(true);
    expect(hasActiveFilters({ ...base, etapa: "link" })).toBe(true);
    expect(hasActiveFilters({ ...base, tagFilter: { ...emptyTagFilter, untaggedOnly: true } })).toBe(true);
  });
});
