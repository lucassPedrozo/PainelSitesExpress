import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Generation, Project } from "@/lib/api";
import {
  fetchProjects,
  setProjectName,
  setProjectTags,
} from "@/lib/api";
import { groupByDate, type DatedGroup } from "@/features/projects/date-groups";
import type { TagFilter } from "@/features/tags/tag-filter";
import { emptyTagFilter } from "@/features/tags/tag-filter";
import { queryKeys } from "@/lib/query";
import type { TagsController } from "@/features/tags/use-tags";
import type { ProjectStage } from "./project-status";
import { groupByNextStep, isDone } from "./work-queue";
import { isInProgress } from "./project-progress";
import {
  countStages,
  countTags,
  filterProjects,
  hasActiveFilters,
  isDateSort,
  sortDateOf,
  sortProjects,
  summarize,
  type FilterOptions,
  type SortKey,
} from "./project-filters";

/**
 * A lista de projetos: carga, filtro, ordenação, agrupamento e as escritas
 * otimistas. As regras puras estão em `project-filters.ts`.
 *
 * Isto morava dentro do `App`, que passava de 900 linhas misturando estado,
 * regras e apresentação. Aqui as regras ficam testáveis sem montar a tela — e
 * a tela volta a ser só tela.
 */

/**
 * "Fazer agora" agrupa pelo próximo passo; "Todos" é a lista por data;
 * "Finalizados" traz só os que saíram do painel.
 *
 * Os finalizados eram um botão à parte, combinado com a vista — e em "Fazer
 * agora" eles sumiam de novo, porque a fila esconde o que está no ar (e quase
 * todo finalizado está). O resultado era uma lista vazia. Como vista própria,
 * não há combinação a dar errado.
 */
export type ProjectsView = "queue" | "all" | "finished";

const VIEW_KEY = "painel:projetos:vista";

const rememberedView = (): ProjectsView => {
  try {
    const salva = localStorage.getItem(VIEW_KEY);
    return salva === "all" || salva === "finished" ? salva : "queue";
  } catch {
    return "queue";
  }
};

export type ProjectList = {
  projects: Project[];
  visible: Project[];
  groups: Array<DatedGroup<Project>> | null;
  view: ProjectsView;
  setView: (value: ProjectsView) => void;
  /** No ar, fora da fila "Fazer agora" — o que a vista "Todos" mostra a mais. */
  doneCount: number;
  summary: ReturnType<typeof summarize>;
  finishedCount: number;
  /** Primeira carga: a tela ainda não tem nada para mostrar. */
  loading: boolean;
  /** Recarregando com dados na tela — o botão gira, a lista continua. */
  refreshing: boolean;
  error: string | null;
  fetchedAt: string | null;
  now: number;
  query: string;
  setQuery: (value: string) => void;
  sort: SortKey;
  setSort: (value: SortKey) => void;
  asc: boolean;
  toggleDirection: () => void;
  tagFilter: TagFilter;
  setTagFilter: (value: TagFilter) => void;
  /** Estado escolhido no filtro; `null` mostra todos. */
  stage: ProjectStage | null;
  setStage: (value: ProjectStage | null) => void;
  stageCounts: Map<ProjectStage, number>;
  /** Uso de cada tag, com os outros filtros aplicados. */
  tagCounts: Map<string, number>;
  /** Busca, etapa ou tags ligadas — a vista não conta. */
  filtersActive: boolean;
  /** Volta a busca, a etapa e as tags ao padrão; a vista fica. */
  clearFilters: () => void;
  /** Projetos marcados para uma ação em massa. */
  selectedIds: ReadonlySet<string>;
  toggleSelected: (projectId: string) => void;
  setSelected: (projectIds: string[]) => void;
  clearSelection: () => void;
  /** Aplica tags a vários projetos de uma vez; devolve quantos falharam. */
  applyTagsMany: (
    projects: Project[],
    update: (tagIds: string[]) => string[],
  ) => Promise<number>;
  load: (refresh?: boolean) => Promise<void>;
  applyTags: (project: Project, tagIds: string[]) => Promise<void>;
  applyName: (project: Project, name: string) => Promise<void>;
  patchGeneration: (project: Project, generation: Generation) => void;
  forgetTag: (tagId: string) => void;
};

type ProjectsResponse = Awaited<ReturnType<typeof fetchProjects>>;

export function useProjectList(tags: TagsController): ProjectList {
  const queryClient = useQueryClient();
  const {
    data,
    isPending,
    isFetching,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => fetchProjects(),
    // Enquanto algum site está sendo gerado ou publicado, a lista se atualiza
    // sozinha: é o acompanhamento na API (do agente e da execução no GitHub)
    // que muda o selo e o andamento do card. A área de aprovação ficava de
    // fora, e o link pronto só aparecia recarregando a página.
    refetchInterval: (query) =>
      query.state.data?.projects.some(isInProgress) ? 10_000 : false,
    // Continua em outra aba: é de lá que chega o aviso de site pronto.
    refetchIntervalInBackground: true,
  });

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const fetchedAt = data?.fetchedAt ?? null;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("collected");
  const [asc, setAsc] = useState(false);
  const [tagFilter, setTagFilter] = useState<TagFilter>(emptyTagFilter);
  const [stage, setStage] = useState<ProjectStage | null>(null);
  const [view, setViewState] = useState<ProjectsView>(rememberedView);
  const setView = useCallback((value: ProjectsView) => {
    setViewState(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {
      // Sem armazenamento, a escolha vale só nesta aba.
    }
  }, []);
  const showFinished = view === "finished";
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const { recount } = tags;

  /** Atualiza a lista na mão — com `refresh`, a API relê o Drive. */
  const load = useCallback(
    async (refresh = false) => {
      await queryClient.fetchQuery({
        queryKey: queryKeys.projects,
        queryFn: () => fetchProjects(refresh),
        staleTime: 0,
      });
    },
    [queryClient],
  );

  /** Escrita otimista: mexe na lista em cache antes da resposta da API. */
  const patchProjects = useCallback(
    (update: (projects: Project[]) => Project[]) => {
      queryClient.setQueryData<ProjectsResponse>(queryKeys.projects, (current) =>
        current ? { ...current, projects: update(current.projects) } : current,
      );
    },
    [queryClient],
  );

  const applyTags = useCallback(
    async (project: Project, tagIds: string[]) => {
      const previous = project.tagIds;
      const patch = (ids: string[]) =>
        patchProjects((prev) =>
          prev.map((item) =>
            item.id === project.id ? { ...item, tagIds: ids } : item,
          ),
        );

      patch(tagIds);
      recount(previous, tagIds);
      try {
        await setProjectTags(project.id, tagIds);
      } catch (err) {
        // Desfaz a alteração otimista e avisa — silenciar aqui faria a tag
        // "sumir" sem explicação.
        patch(previous);
        recount(tagIds, previous);
        toast.error("Não foi possível salvar as tags", {
          description:
            err instanceof Error ? err.message : "Verifique se a API está no ar.",
        });
      }
    },
    // Só `recount` interessa: depender do controller inteiro tornaria este
    // callback instável e re-renderizaria a lista toda a cada mudança.
    [patchProjects, recount],
  );

  /**
   * O apelido vale só no painel — a pasta do Drive não é tocada, porque o
   * acesso lá é somente leitura.
   */
  const applyName = useCallback(
    async (project: Project, name: string) => {
      const previous = project.alias;
      const patch = (alias: string | null) =>
        patchProjects((prev) =>
          prev.map((item) =>
            item.id === project.id ? { ...item, alias } : item,
          ),
        );

      patch(name || null);
      try {
        await setProjectName(project.id, name);
        toast.success(name ? "Nome atualizado" : "Nome da pasta restaurado");
      } catch (err) {
        patch(previous);
        toast.error("Não foi possível salvar o nome", {
          description:
            err instanceof Error
              ? err.message
              : "Verifique se a API está no ar.",
        });
      }
    },
    [patchProjects],
  );

  /** Substitui uma geração já carregada pela versão que a API devolveu. */
  const patchGeneration = useCallback(
    (project: Project, generation: Generation) => {
      patchProjects((prev) =>
        prev.map((item) =>
          item.id === project.id
            ? {
                ...item,
                generations: item.generations.map((g) =>
                  g.id === generation.id ? generation : g,
                ),
              }
            : item,
        ),
      );
    },
    [patchProjects],
  );

  /** Uma tag excluída some dos projetos já carregados e dos filtros. */
  const forgetTag = useCallback(
    (tagId: string) => {
      patchProjects((prev) =>
        prev.map((project) =>
          project.tagIds.includes(tagId)
            ? { ...project, tagIds: project.tagIds.filter((id) => id !== tagId) }
            : project,
        ),
      );
      setTagFilter((prev) => ({
        ...prev,
        tagIds: prev.tagIds.filter((id) => id !== tagId),
      }));
    },
    [patchProjects],
  );

  /**
   * A referência de tempo é o instante em que os dados foram lidos, não o
   * relógio de cada render: assim "Hoje" não muda de sentido no meio de uma
   * interação, e o resumo e as faixas de data nunca discordam.
   */
  const now = useMemo(
    () => (fetchedAt ? new Date(fetchedAt).getTime() : 0),
    [fetchedAt],
  );

  const summary = useMemo(() => summarize(projects, now), [projects, now]);

  const finishedCount = useMemo(() => {
    const finished = tags.finishedTagId;
    if (!finished) return 0;
    return projects.filter((p) => p.tagIds.includes(finished)).length;
  }, [projects, tags.finishedTagId]);

  const filterOptions: FilterOptions = useMemo(
    () => ({ query, tagFilter, showFinished, finishedTagId: tags.finishedTagId, stage }),
    [query, tagFilter, showFinished, tags.finishedTagId, stage],
  );

  // Cada fileira conta com os filtros das outras: o número ao lado de uma
  // etapa ou tag é o que a lista mostra ao clicar nela.
  const stageCounts = useMemo(
    () => countStages(projects, filterOptions),
    [projects, filterOptions],
  );
  const tagCounts = useMemo(
    () => countTags(projects, filterOptions),
    [projects, filterOptions],
  );

  const filtered = useMemo(
    () => sortProjects(filterProjects(projects, filterOptions), sort, asc),
    [projects, filterOptions, sort, asc],
  );

  const clearFilters = useCallback(() => {
    setQuery("");
    setStage(null);
    setTagFilter(emptyTagFilter);
  }, []);

  /**
   * Tags em vários projetos: um pedido por projeto, três por vez. Cada um é a
   * mesma escrita otimista do projeto sozinho, e o que falhar volta.
   */
  const applyTagsMany = useCallback(
    async (alvos: Project[], update: (tagIds: string[]) => string[]) => {
      let falhas = 0;
      const fila = alvos.filter((project) => {
        const next = update(project.tagIds);
        return next.length !== project.tagIds.length || next.some((id, i) => id !== project.tagIds[i]);
      });
      const worker = async () => {
        for (let project = fila.shift(); project; project = fila.shift()) {
          const previous = project.tagIds;
          const next = update(previous);
          patchProjects((prev) =>
            prev.map((item) => (item.id === project.id ? { ...item, tagIds: next } : item)),
          );
          recount(previous, next);
          try {
            await setProjectTags(project.id, next);
          } catch {
            falhas += 1;
            patchProjects((prev) =>
              prev.map((item) => (item.id === project.id ? { ...item, tagIds: previous } : item)),
            );
            recount(next, previous);
          }
        }
      };
      await Promise.all(Array.from({ length: 3 }, worker));
      return falhas;
    },
    [patchProjects, recount],
  );

  const toggleSelected = useCallback((projectId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);
  const setSelected = useCallback((projectIds: string[]) => setSelectedIds(new Set(projectIds)), []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Na fila, o que está no ar sai — a não ser que o filtro peça justamente ele.
  const queue = view === "queue" && stage !== "live";
  const visible = useMemo(
    () => (queue ? filtered.filter((project) => !isDone(project)) : filtered),
    [filtered, queue],
  );
  const doneCount = filtered.length - visible.length;

  const groups = useMemo(() => {
    if (queue) return groupByNextStep(visible);
    return isDateSort(sort)
      ? groupByDate(visible, (project) => sortDateOf(project, sort), now)
      : null;
  }, [queue, visible, sort, now]);

  return {
    projects,
    visible,
    groups,
    view,
    setView,
    doneCount,
    summary,
    finishedCount,
    loading: isPending,
    refreshing: isFetching && !isPending,
    error: queryError ? (queryError as Error).message : null,
    fetchedAt,
    now,
    query,
    setQuery,
    sort,
    setSort,
    asc,
    toggleDirection: useCallback(() => setAsc((prev) => !prev), []),
    tagFilter,
    setTagFilter,
    stage,
    setStage,
    stageCounts,
    tagCounts,
    filtersActive: hasActiveFilters(filterOptions),
    clearFilters,
    selectedIds,
    toggleSelected,
    setSelected,
    clearSelection,
    applyTagsMany,
    load,
    applyTags,
    applyName,
    patchGeneration,
    forgetTag,
  };
}
