import type { Project } from "@/lib/api";
import { parseProjectName, projectIdentity, timeOf } from "@/lib/format";
import { emptyTagFilter, type TagFilter } from "@/features/tags/tag-filter";
import { lastActivityOf } from "./last-activity";
import { PRIORITY, STAGES, tabOf, type Etapa, type ListTab, type WorkGroupKey } from "./stage";
import { projectStatus } from "./project-status";
import { engineLabels, engineOf } from "./site-engine";

/*
 * As regras da lista de projetos, sem React: abas, filtros, contadores e
 * ordenação. Testadas em project-filters.test.ts.
 */

export type SortKey = "prioridade" | "atividade" | "coleta-recente" | "coleta-antiga" | "nome";

export const sortLabels: Record<SortKey, string> = {
  prioridade: "Prioridade",
  atividade: "Última atividade",
  "coleta-recente": "Coleta mais recente",
  "coleta-antiga": "Coleta mais antiga",
  nome: "Nome",
};

/** O filtro de etapa: uma das etapas, ou só os que estão com problema. */
export type EtapaFilter = Etapa | "problema" | null;

export type FilterOptions = {
  query: string;
  tagFilter: TagFilter;
  tab: ListTab;
  finishedTagId: string | null;
  etapa?: EtapaFilter;
  /** O grupo de trabalho escolhido (o Dashboard é quem liga). */
  group?: WorkGroupKey | null;
};

/** A data da coleta: a do nome da pasta, ou a criação quando o nome não traz. */
export const collectedAtOf = (project: Project) =>
  // A data corrigida à mão vence a do nome da pasta.
  (project.details?.receivedAt ? new Date(timeOf(project.details.receivedAt) ?? 0) : null) ??
  parseProjectName(project.name).collectedAt ??
  new Date(timeOf(project.createdTime) ?? 0);

/**
 * A busca alcança o nome da pasta, o apelido, o domínio limpo, o responsável,
 * a observação, a ferramenta de cada site ("lovable", "claude") e o nome do
 * projeto no Lovable.
 */
const matchesQuery = (project: Project, term: string) =>
  !term ||
  [
    project.name,
    project.alias,
    project.domain,
    project.details?.responsible,
    project.details?.note,
    ...project.generations.flatMap((site) => [engineLabels[engineOf(site)], site.lovableName]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(term);

const matchesTags = (project: Project, tagFilter: TagFilter) => {
  if (tagFilter.untaggedOnly) return project.tagIds.length === 0;
  if (tagFilter.tagIds.length === 0) return true;
  return tagFilter.matchAll
    ? tagFilter.tagIds.every((id) => project.tagIds.includes(id))
    : tagFilter.tagIds.some((id) => project.tagIds.includes(id));
};

const matchesEtapa = (project: Project, etapa: EtapaFilter) => {
  if (!etapa) return true;
  const def = STAGES[projectStatus(project).stage];
  return etapa === "problema" ? Boolean(def.problem) : def.etapa === etapa;
};

const matchesGroup = (project: Project, group: WorkGroupKey | null | undefined) =>
  !group || STAGES[projectStatus(project).stage].group === group;

export function filterProjects(projects: Project[], options: FilterOptions) {
  const term = options.query.trim().toLowerCase();
  return projects.filter(
    (project) =>
      tabOf(project, options.finishedTagId) === options.tab &&
      matchesQuery(project, term) &&
      matchesTags(project, options.tagFilter) &&
      matchesEtapa(project, options.etapa ?? null) &&
      matchesGroup(project, options.group),
  );
}

/** Quantos há em cada aba, com a busca e as tags aplicadas. */
export function countTabs(projects: Project[], options: FilterOptions): Record<ListTab, number> {
  const counts: Record<ListTab, number> = { ativos: 0, "no-ar": 0, finalizados: 0, ocultos: 0 };
  const term = options.query.trim().toLowerCase();
  for (const project of projects) {
    if (!matchesQuery(project, term) || !matchesTags(project, options.tagFilter)) continue;
    counts[tabOf(project, options.finishedTagId)] += 1;
  }
  return counts;
}

/**
 * Quantos projetos usam cada tag, com os outros filtros aplicados. Contada na
 * lista que veio do Drive: o número do banco inclui pastas que já não
 * existem.
 */
export function countTags(projects: Project[], options?: FilterOptions) {
  const base = options ? filterProjects(projects, { ...options, tagFilter: emptyTagFilter }) : projects;
  const counts = new Map<string, number>();
  for (const project of base) {
    for (const id of project.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Algum filtro além da aba está ligado — busca, contador, etapa ou tags. */
export const hasActiveFilters = ({ query, tagFilter, etapa, group }: FilterOptions) =>
  Boolean(query.trim() || etapa || group || tagFilter.tagIds.length || tagFilter.untaggedOnly);

/**
 * Ordena sem mexer no array recebido. Cada chave é calculada uma vez por
 * projeto (o estado e a última atividade não são baratos).
 *
 * Prioridade: o grupo de trabalho (o que quebrou primeiro) e, dentro
 * dele, o que está parado há mais tempo.
 */
export function sortProjects(projects: Project[], sort: SortKey): Project[] {
  const keyed = projects.map((project) => ({
    project,
    priority: sort === "prioridade" ? priorityIndex(project) : 0,
    activity: sort === "prioridade" || sort === "atividade" ? (timeOf(lastActivityOf(project)?.at) ?? 0) : 0,
    collected: sort.startsWith("coleta") ? collectedAtOf(project).getTime() : 0,
    label: sort === "nome" ? projectIdentity(project).label : "",
  }));

  keyed.sort((a, b) => {
    switch (sort) {
      case "prioridade":
        return a.priority - b.priority || a.activity - b.activity;
      case "atividade":
        return b.activity - a.activity;
      case "coleta-recente":
        return b.collected - a.collected;
      case "coleta-antiga":
        return a.collected - b.collected;
      case "nome":
        return a.label.localeCompare(b.label, "pt-BR", { numeric: true });
    }
  });
  return keyed.map((item) => item.project);
}

const priorityIndex = (project: Project) => {
  const group = STAGES[projectStatus(project).stage].group;
  // Sem grupo: no ar e só de arquivos, depois de todo o resto.
  return group ? PRIORITY.indexOf(group) : PRIORITY.length;
};
