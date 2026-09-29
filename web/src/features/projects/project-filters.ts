import type { Project } from "@/lib/api";
import { parseProjectName, projectIdentity } from "@/lib/format";
import { emptyTagFilter, type TagFilter } from "@/features/tags/tag-filter";
import { projectStatus, type ProjectStage } from "./project-status";

/*
 * As regras da lista de projetos, sem React: ordenação, filtro, a data que
 * decide as faixas e o resumo do topo. Testadas em project-filters.test.ts.
 */

export type SortKey =
  | "collected"
  | "name"
  | "activity"
  | "files"
  | "size"
  | "tags";

export const sortLabels: Record<SortKey, string> = {
  collected: "Data da coleta",
  name: "Nome do projeto",
  activity: "Última atividade",
  files: "Quantidade de arquivos",
  size: "Volume de material",
  tags: "Quantidade de tags",
};

const DAY = 86_400_000;

/**
 * Data que manda na ordenação. O agrupamento por faixa usa exatamente a mesma,
 * senão as seções sairiam fora de ordem — ou repetidas.
 */
export const sortDateOf = (project: Project, sort: SortKey) => {
  if (sort === "activity") return new Date(project.lastActivity);
  const { collectedAt } = parseProjectName(project.name);
  return collectedAt ?? new Date(project.createdTime);
};

/** As faixas de data só fazem sentido quando a lista está ordenada por data. */
export const isDateSort = (sort: SortKey) =>
  sort === "collected" || sort === "activity";

export type FilterOptions = {
  query: string;
  tagFilter: TagFilter;
  /** `true`: só os finalizados (a vista "Finalizados"); `false`: os demais. */
  showFinished: boolean;
  finishedTagId: string | null;
  /** Só os projetos neste estado — o mesmo do selo do card. */
  stage?: ProjectStage | null;
};

export function filterProjects(
  projects: Project[],
  { query, tagFilter, showFinished, finishedTagId, stage = null }: FilterOptions,
) {
  const term = query.trim().toLowerCase();

  return projects.filter((project) => {
    if (!inFinishedView(project, showFinished, finishedTagId)) return false;
    if (stage && projectStatus(project).stage !== stage) return false;
    // A busca alcança os dois nomes e o domínio limpo: quem renomeou procura
    // pelo apelido, quem lembra da pasta procura pelo nome dela.
    if (
      term &&
      !`${project.name} ${project.alias ?? ""} ${project.domain ?? ""}`
        .toLowerCase()
        .includes(term)
    ) {
      return false;
    }
    if (tagFilter.untaggedOnly) return project.tagIds.length === 0;
    if (tagFilter.tagIds.length === 0) return true;
    return tagFilter.matchAll
      ? tagFilter.tagIds.every((id) => project.tagIds.includes(id))
      : tagFilter.tagIds.some((id) => project.tagIds.includes(id));
  });
}

/** Finalizado sai da lista principal e só aparece quando pedido. */
const inFinishedView = (
  project: Project,
  showFinished: boolean,
  finishedTagId: string | null,
) =>
  !finishedTagId || project.tagIds.includes(finishedTagId) === showFinished;

/**
 * Quantos projetos há em cada estado, com os **outros** filtros aplicados
 * (vista, busca, tags) — o número ao lado de cada etapa é o que aparece ao
 * clicar nela. Antes a contagem ignorava a busca e as tags, e uma etapa com
 * "5" abria uma lista vazia.
 */
export function countStages(projects: Project[], options: FilterOptions) {
  const counts = new Map<ProjectStage, number>();
  for (const project of filterProjects(projects, { ...options, stage: null })) {
    const { stage } = projectStatus(project);
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return counts;
}

/**
 * Quantos projetos usam cada tag, com os outros filtros aplicados (vista,
 * busca, etapa). Contada na lista que veio do Drive: o número do banco inclui
 * pastas que já não existem, e por isso "A avaliar" chegava a 81 de 80.
 */
export function countTags(projects: Project[], options?: FilterOptions) {
  const base = options
    ? filterProjects(projects, { ...options, tagFilter: emptyTagFilter })
    : projects;
  const counts = new Map<string, number>();
  for (const project of base) {
    for (const id of project.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Algum filtro além da vista está ligado — busca, etapa ou tags. */
export const hasActiveFilters = ({ query, tagFilter, stage }: FilterOptions) =>
  Boolean(query.trim() || stage || tagFilter.tagIds.length || tagFilter.untaggedOnly);

export function sortProjects(
  projects: Project[],
  sort: SortKey,
  asc: boolean,
): Project[] {
  const direction = asc ? 1 : -1;

  return [...projects].sort((a, b) => {
    switch (sort) {
      case "name":
        return (
          projectIdentity(a).label.localeCompare(
            projectIdentity(b).label,
            "pt-BR",
            { numeric: true },
          ) * direction
        );
      case "activity":
        return (
          (new Date(a.lastActivity).getTime() -
            new Date(b.lastActivity).getTime()) *
          direction
        );
      case "files":
        return (a.fileCount - b.fileCount) * direction;
      case "size":
        return (a.totalSize - b.totalSize) * direction;
      case "tags":
        return (
          (a.tagIds.length - b.tagIds.length ||
            a.name.localeCompare(b.name, "pt-BR")) * direction
        );
      default:
        return (
          (sortDateOf(a, "collected").getTime() -
            sortDateOf(b, "collected").getTime()) *
          direction
        );
    }
  });
}

export function summarize(projects: Project[], now: number) {
  return {
    total: projects.length,
    files: projects.reduce((sum, p) => sum + p.fileCount, 0),
    size: projects.reduce((sum, p) => sum + p.totalSize, 0),
    recent: projects.filter((p) => {
      const { collectedAt } = parseProjectName(p.name);
      const reference = collectedAt ?? new Date(p.createdTime);
      return now - reference.getTime() <= 30 * DAY;
    }).length,
  };
}
