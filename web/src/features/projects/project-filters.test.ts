import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api";
import { emptyTagFilter } from "@/features/tags/tag-filter";
import {
  countStages,
  countTags,
  filterProjects,
  hasActiveFilters,
  isDateSort,
  sortDateOf,
  sortProjects,
  summarize,
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
    webViewLink: "",
    ...over,
  }) as unknown as Project;

const filtroBase = {
  query: "",
  tagFilter: emptyTagFilter,
  showFinished: false,
  finishedTagId: null as string | null,
};

describe("filterProjects", () => {
  it("busca no nome da pasta e no apelido", () => {
    const lista = [
      projeto({ id: "a", name: "[04/09/2026] aurora.eng.br" }),
      projeto({ id: "b", name: "[04/09/2026] Cliente Sem Dominio", alias: "Padaria" }),
    ];

    expect(
      filterProjects(lista, { ...filtroBase, query: "aurora" }).map((p) => p.id),
    ).toEqual(["a"]);
    // O apelido é do painel, mas quem renomeou procura por ele.
    expect(
      filterProjects(lista, { ...filtroBase, query: "padaria" }).map((p) => p.id),
    ).toEqual(["b"]);
  });

  it("esconde os finalizados até serem pedidos", () => {
    const lista = [
      projeto({ id: "a" }),
      projeto({ id: "fim", tagIds: ["t-fim"] }),
    ];
    const base = { ...filtroBase, finishedTagId: "t-fim" };

    expect(filterProjects(lista, base).map((p) => p.id)).toEqual(["a"]);
    // Pedidos, aparecem *sozinhos* — é uma gaveta, não um acréscimo.
    expect(
      filterProjects(lista, { ...base, showFinished: true }).map((p) => p.id),
    ).toEqual(["fim"]);
  });

  it("filtra por tag em modo Qualquer e em modo Todas", () => {
    const lista = [
      projeto({ id: "ab", tagIds: ["a", "b"] }),
      projeto({ id: "so-a", tagIds: ["a"] }),
    ];

    expect(
      filterProjects(lista, {
        ...filtroBase,
        tagFilter: { ...emptyTagFilter, tagIds: ["a", "b"], matchAll: false },
      }).map((p) => p.id),
    ).toEqual(["ab", "so-a"]);

    expect(
      filterProjects(lista, {
        ...filtroBase,
        tagFilter: { ...emptyTagFilter, tagIds: ["a", "b"], matchAll: true },
      }).map((p) => p.id),
    ).toEqual(["ab"]);
  });

  it("acha o que ainda não foi triado", () => {
    const lista = [projeto({ id: "sem" }), projeto({ id: "com", tagIds: ["a"] })];
    expect(
      filterProjects(lista, {
        ...filtroBase,
        tagFilter: { ...emptyTagFilter, untaggedOnly: true },
      }).map((p) => p.id),
    ).toEqual(["sem"]);
  });
});

describe("sortProjects", () => {
  const lista = [
    projeto({ id: "meio", name: "[15/08/2026] bravo.com", fileCount: 5, totalSize: 50 }),
    projeto({ id: "novo", name: "[04/09/2026] alfa.com", fileCount: 1, totalSize: 10 }),
    projeto({ id: "velho", name: "[01/07/2026] charlie.com", fileCount: 9, totalSize: 90 }),
  ];

  it("por data da coleta, decrescente por padrão", () => {
    expect(sortProjects(lista, "collected", false).map((p) => p.id)).toEqual([
      "novo",
      "meio",
      "velho",
    ]);
    expect(sortProjects(lista, "collected", true).map((p) => p.id)).toEqual([
      "velho",
      "meio",
      "novo",
    ]);
  });

  it("por nome, respeitando a ordem do português", () => {
    expect(sortProjects(lista, "name", true).map((p) => p.id)).toEqual([
      "novo",
      "meio",
      "velho",
    ]);
  });

  it("por volume e por quantidade de arquivos", () => {
    expect(sortProjects(lista, "size", true).map((p) => p.id)).toEqual([
      "novo",
      "meio",
      "velho",
    ]);
    expect(sortProjects(lista, "files", false).map((p) => p.id)).toEqual([
      "velho",
      "meio",
      "novo",
    ]);
  });

  it("não altera o array recebido", () => {
    const antes = lista.map((p) => p.id);
    sortProjects(lista, "name", true);
    expect(lista.map((p) => p.id)).toEqual(antes);
  });
});

describe("sortDateOf", () => {
  it("lê a data da coleta do nome da pasta", () => {
    const p = projeto({ id: "a", name: "[15/08/2026] x.com" });
    expect(sortDateOf(p, "collected").toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("cai na criação no Drive quando a pasta não traz data", () => {
    const p = projeto({
      id: "a",
      name: "Cliente Sem Dominio",
      createdTime: "2026-07-02T10:00:00.000Z",
    });
    expect(sortDateOf(p, "collected").toISOString().slice(0, 10)).toBe("2026-07-02");
  });

  it("usa a última atividade quando a ordenação é por atividade", () => {
    const p = projeto({
      id: "a",
      name: "[15/08/2026] x.com",
      lastActivity: "2026-09-01T00:00:00.000Z",
    });
    expect(sortDateOf(p, "activity").toISOString().slice(0, 10)).toBe("2026-09-01");
  });
});

describe("isDateSort", () => {
  it("só as ordenações por data agrupam", () => {
    expect(isDateSort("collected")).toBe(true);
    expect(isDateSort("activity")).toBe(true);
    for (const outra of ["name", "files", "size", "tags"] as const) {
      expect(isDateSort(outra)).toBe(false);
    }
  });
});

describe("summarize", () => {
  it("conta as coletas dentro da janela de 30 dias", () => {
    const agora = Date.parse("2026-09-09T12:00:00.000Z");
    const lista = [
      projeto({ id: "recente", name: "[01/09/2026] a.com" }),
      projeto({ id: "limite", name: "[11/08/2026] b.com" }),
      projeto({ id: "antigo", name: "[01/06/2026] c.com" }),
    ];

    const resumo = summarize(lista, agora);
    expect(resumo.total).toBe(3);
    expect(resumo.recent).toBe(2);
  });

  it("soma arquivos e volume", () => {
    const lista = [
      projeto({ id: "a", fileCount: 3, totalSize: 100 }),
      projeto({ id: "b", fileCount: 4, totalSize: 250 }),
    ];
    const resumo = summarize(lista, Date.now());
    expect(resumo.files).toBe(7);
    expect(resumo.size).toBe(350);
  });
});

describe("filtro e contagem por estado", () => {
  const vivo = {
    domain: "a.com.br",
    repoFullName: "org/a",
    configuredAt: null,
    lastDeployAt: "2026-09-10T00:00:00.000Z",
  };
  const lista = [
    projeto({ id: "no-ar", publication: vivo } as never),
    projeto({ id: "vazio", fileCount: 0 }),
    projeto({ id: "fim", tagIds: ["finalizado"], publication: vivo } as never),
  ];
  const base = {
    query: "",
    tagFilter: emptyTagFilter,
    showFinished: false,
    finishedTagId: "finalizado",
  };

  it("filtra pelo mesmo estado do selo", () => {
    const ids = filterProjects(lista, { ...base, stage: "live" }).map((p) => p.id);
    expect(ids).toEqual(["no-ar"]);
  });

  it("conta só a lista aberta — finalizado fica de fora", () => {
    const counts = countStages(lista, base);
    expect(counts.get("live")).toBe(1);
    expect(counts.get("empty")).toBe(1);
  });

  it("tags contam só projetos que existem na lista", () => {
    const counts = countTags([
      projeto({ id: "a", tagIds: ["t1", "t2"] }),
      projeto({ id: "b", tagIds: ["t1"] }),
    ]);
    expect(counts.get("t1")).toBe(2);
    expect(counts.get("t2")).toBe(1);
  });

  it("a contagem de cada etapa segue a busca e as tags — é o que aparece ao clicar", () => {
    const comTag = [
      projeto({ id: "a", tagIds: ["t1"], publication: vivo } as never),
      projeto({ id: "b", publication: vivo } as never),
    ];
    const counts = countStages(comTag, { ...base, tagFilter: { ...emptyTagFilter, tagIds: ["t1"] } });
    // Antes contava 2 (ignorava a tag), e clicar abria uma lista com 1.
    expect(counts.get("live")).toBe(1);
  });

  it("a contagem das tags segue a vista: finalizado escondido não conta", () => {
    const counts = countTags(
      [
        projeto({ id: "a", tagIds: ["t1"] }),
        projeto({ id: "fim", tagIds: ["t1", "finalizado"] }),
      ],
      base,
    );
    expect(counts.get("t1")).toBe(1);
    // Na vista Finalizados, é o contrário.
    expect(countTags([projeto({ id: "fim", tagIds: ["t1", "finalizado"] })], { ...base, showFinished: true }).get("t1")).toBe(1);
  });

  it("filtros ativos: a vista não conta, busca, etapa e tags sim", () => {
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters({ ...base, showFinished: true })).toBe(false);
    expect(hasActiveFilters({ ...base, query: " x " })).toBe(true);
    expect(hasActiveFilters({ ...base, stage: "live" })).toBe(true);
    expect(hasActiveFilters({ ...base, tagFilter: { ...emptyTagFilter, untaggedOnly: true } })).toBe(true);
  });
});
