import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Generation, Project, ProjectDetailsPatch } from "@/lib/api";
import { fetchProjects, setProjectTags, updateProjectDetails } from "@/lib/api";
import type { TagFilter } from "@/features/tags/tag-filter";
import { emptyTagFilter } from "@/features/tags/tag-filter";
import { queryKeys } from "@/lib/query";
import type { TagsController } from "@/features/tags/use-tags";
import { isInProgress } from "./project-progress";
import {
  countTabs,
  countTags,
  filterProjects,
  hasActiveFilters,
  sortProjects,
  type EtapaFilter,
  type FilterOptions,
  type SortKey,
} from "./project-filters";
import type { ListTab, WorkGroupKey } from "./stage";

/**
 * A lista de projetos: carga, abas, filtros, contadores, ordenação e as
 * escritas otimistas. As regras puras estão em `project-filters.ts`.
 */

const TAB_KEY = "painel:projetos:aba";

const rememberedTab = (): ListTab => {
  try {
    const salva = localStorage.getItem(TAB_KEY);
    return salva === "no-ar" || salva === "finalizados" ? salva : "ativos";
  } catch {
    return "ativos";
  }
};

export type ProjectList = {
  projects: Project[];
  /** O que a tabela mostra: aba, filtros e ordem aplicados. */
  visible: Project[];
  tab: ListTab;
  setTab: (value: ListTab) => void;
  tabCounts: Record<ListTab, number>;
  group: WorkGroupKey | null;
  /** Liga um contador; o mesmo de novo desliga. Também leva para a aba Ativos. */
  toggleGroup: (value: WorkGroupKey) => void;
  etapa: EtapaFilter;
  setEtapa: (value: EtapaFilter) => void;
  /** Primeira carga: a tela ainda não tem nada para mostrar. */
  loading: boolean;
  /** Recarregando com dados na tela — o botão gira, a lista continua. */
  refreshing: boolean;
  error: string | null;
  fetchedAt: string | null;
  query: string;
  setQuery: (value: string) => void;
  sort: SortKey;
  setSort: (value: SortKey) => void;
  tagFilter: TagFilter;
  setTagFilter: (value: TagFilter) => void;
  /** Uso de cada tag, com os outros filtros aplicados. */
  tagCounts: Map<string, number>;
  /** Busca, contador, etapa ou tags ligados — a aba não conta. */
  filtersActive: boolean;
  /** Volta a busca, o contador, a etapa e as tags ao padrão; a aba fica. */
  clearFilters: () => void;
  /** Mostra um projeto pelo nome, na aba em que ele está. */
  showProject: (project: Project, tab: ListTab) => void;
  /** Projetos marcados para uma ação em massa. */
  selectedIds: ReadonlySet<string>;
  toggleSelected: (projectId: string) => void;
  setSelected: (projectIds: string[]) => void;
  clearSelection: () => void;
  /** Aplica tags a vários projetos de uma vez; devolve quantos falharam. */
  applyTagsMany: (projects: Project[], update: (tagIds: string[]) => string[]) => Promise<number>;
  load: (refresh?: boolean) => Promise<void>;
  applyTags: (project: Project, tagIds: string[]) => Promise<void>;
  /** Grava o que a equipe corrigiu e relê a lista: domínio, data e etapa mexem em tudo. */
  applyDetails: (project: Project, patch: ProjectDetailsPatch) => Promise<void>;
  /** O mesmo em vários projetos; devolve quantos falharam. Relê a lista no fim. */
  applyDetailsMany: (projects: Project[], patch: ProjectDetailsPatch) => Promise<number>;
  patchGeneration: (project: Project, generation: Generation) => void;
  forgetTag: (tagId: string) => void;
};

type ProjectsResponse = Awaited<ReturnType<typeof fetchProjects>>;

export function useProjectList(tags: TagsController): ProjectList {
  const queryClient = useQueryClient();
  const { data, isPending, isFetching, error: queryError } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => fetchProjects(),
    // Enquanto algo está sendo gerado ou publicado, a lista se atualiza
    // sozinha: é o acompanhamento na API (do agente, do Claude e da execução
    // no GitHub) que muda o selo e o andamento.
    refetchInterval: (query) => (query.state.data?.projects.some(isInProgress) ? 10_000 : false),
    // Continua em outra aba: é de lá que chega o aviso de site pronto.
    refetchIntervalInBackground: true,
  });

  const projects = useMemo(() => data?.projects ?? [], [data]);
  const fetchedAt = data?.fetchedAt ?? null;
  const [query, setQuery] = useState("");
  // A coleta mais recente primeiro: é a ordem em que o material chega, e a
  // das faixas de data (Hoje, Ontem, Últimos 7 dias…).
  const [sort, setSort] = useState<SortKey>("coleta-recente");
  const [tagFilter, setTagFilter] = useState<TagFilter>(emptyTagFilter);
  const [etapa, setEtapa] = useState<EtapaFilter>(null);
  const [group, setGroup] = useState<WorkGroupKey | null>(null);
  const [tab, setTabState] = useState<ListTab>(rememberedTab);
  const setTab = useCallback((value: ListTab) => {
    setTabState(value);
    try {
      localStorage.setItem(TAB_KEY, value);
    } catch {
      // Sem armazenamento, a escolha vale só nesta aba do navegador.
    }
  }, []);
  const toggleGroup = useCallback(
    (value: WorkGroupKey) => {
      setGroup((current) => (current === value ? null : value));
      // Os contadores são dos ativos: ligar um em outra aba levaria a uma lista vazia.
      setTab("ativos");
    },
    [setTab],
  );
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
        patchProjects((prev) => prev.map((item) => (item.id === project.id ? { ...item, tagIds: ids } : item)));

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
          description: err instanceof Error ? err.message : "Verifique se a API está no ar.",
        });
      }
    },
    // Só `recount` interessa: depender do controller inteiro tornaria este
    // callback instável e re-renderizaria a lista toda a cada mudança.
    [patchProjects, recount],
  );

  /**
   * O que a equipe corrige à mão. Não é otimista: o domínio muda a publicação
   * que o projeto acha, e a data e a etapa, a ordem e os contadores — a lista
   * volta da API já com tudo isso recalculado. O erro sobe para o formulário,
   * que o mostra sem fechar.
   */
  const applyDetails = useCallback(
    async (project: Project, patch: ProjectDetailsPatch) => {
      await updateProjectDetails(project.id, patch);
      await load();
      toast.success("Projeto atualizado");
    },
    [load],
  );

  /**
   * Edição em massa: três projetos por vez, como as tags. Cada um é gravado
   * sozinho, então uma falha não desfaz os outros — e a contagem diz quantos.
   */
  const applyDetailsMany = useCallback(
    async (alvos: Project[], patch: ProjectDetailsPatch) => {
      let falhas = 0;
      const fila = [...alvos];
      const worker = async () => {
        for (let project = fila.shift(); project; project = fila.shift()) {
          try {
            await updateProjectDetails(project.id, patch);
          } catch {
            falhas += 1;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      await load();
      return falhas;
    },
    [load],
  );

  /** Substitui uma geração já carregada pela versão que a API devolveu. */
  const patchGeneration = useCallback(
    (project: Project, generation: Generation) => {
      patchProjects((prev) =>
        prev.map((item) =>
          item.id === project.id
            ? { ...item, generations: item.generations.map((g) => (g.id === generation.id ? generation : g)) }
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
          project.tagIds.includes(tagId) ? { ...project, tagIds: project.tagIds.filter((id) => id !== tagId) } : project,
        ),
      );
      setTagFilter((prev) => ({ ...prev, tagIds: prev.tagIds.filter((id) => id !== tagId) }));
    },
    [patchProjects],
  );

  const filterOptions: FilterOptions = useMemo(
    () => ({ query, tagFilter, tab, finishedTagId: tags.finishedTagId, etapa, group }),
    [query, tagFilter, tab, tags.finishedTagId, etapa, group],
  );

  const tabCounts = useMemo(() => countTabs(projects, filterOptions), [projects, filterOptions]);
  const tagCounts = useMemo(() => countTags(projects, filterOptions), [projects, filterOptions]);
  const visible = useMemo(
    () => sortProjects(filterProjects(projects, filterOptions), sort),
    [projects, filterOptions, sort],
  );

  const clearFilters = useCallback(() => {
    setQuery("");
    setGroup(null);
    setEtapa(null);
    setTagFilter(emptyTagFilter);
  }, []);

  const showProject = useCallback(
    (project: Project, target: ListTab) => {
      clearFilters();
      setQuery(project.alias ?? project.name);
      setTab(target);
    },
    [clearFilters, setTab],
  );

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
          patchProjects((prev) => prev.map((item) => (item.id === project.id ? { ...item, tagIds: next } : item)));
          recount(previous, next);
          try {
            await setProjectTags(project.id, next);
          } catch {
            falhas += 1;
            patchProjects((prev) => prev.map((item) => (item.id === project.id ? { ...item, tagIds: previous } : item)));
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

  return {
    projects,
    visible,
    tab,
    setTab,
    tabCounts,
    group,
    toggleGroup,
    etapa,
    setEtapa,
    loading: isPending,
    refreshing: isFetching && !isPending,
    error: queryError ? (queryError as Error).message : null,
    fetchedAt,
    query,
    setQuery,
    sort,
    setSort,
    tagFilter,
    setTagFilter,
    tagCounts,
    filtersActive: hasActiveFilters(filterOptions),
    clearFilters,
    showProject,
    selectedIds,
    toggleSelected,
    setSelected,
    clearSelection,
    applyTagsMany,
    load,
    applyTags,
    applyDetails,
    applyDetailsMany,
    patchGeneration,
    forgetTag,
  };
}
