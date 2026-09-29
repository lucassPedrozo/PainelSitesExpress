import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TagColor } from "@/lib/api";
import * as api from "@/lib/api";
import { queryKeys } from "@/lib/query";

type TagsResponse = Awaited<ReturnType<typeof api.fetchTags>>;

/** Fonte única das tags do painel, compartilhada por filtros, cards e modais. */
export function useTags() {
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.tags,
    queryFn: api.fetchTags,
  });

  const tags = useMemo(() => data?.tags ?? [], [data]);
  const finishedTagId = data?.finishedTagId ?? null;

  /** Escreve direto no cache: a resposta da API já traz a tag atualizada. */
  const patch = useCallback(
    (update: (current: TagsResponse) => TagsResponse) => {
      queryClient.setQueryData<TagsResponse>(queryKeys.tags, (current) =>
        current ? update(current) : current,
      );
    },
    [queryClient],
  );

  const byId = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag])),
    [tags],
  );

  const create = useCallback(
    async (name: string, color: TagColor) => {
      const { tag } = await api.createTag(name, color);
      patch((current) => ({ ...current, tags: [...current.tags, tag] }));
      return tag;
    },
    [patch],
  );

  const update = useCallback(
    async (id: string, changes: { name?: string; color?: TagColor }) => {
      const { tag } = await api.updateTag(id, changes);
      patch((current) => ({
        ...current,
        tags: current.tags.map((item) =>
          item.id === id ? { ...tag, projectCount: item.projectCount } : item,
        ),
      }));
    },
    [patch],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteTag(id);
      patch((current) => ({
        ...current,
        tags: current.tags.filter((tag) => tag.id !== id),
        finishedTagId:
          current.finishedTagId === id ? null : current.finishedTagId,
      }));
    },
    [patch],
  );

  /** Mantém `projectCount` em dia após uma reatribuição de tags. */
  const recount = useCallback(
    (previous: string[], next: string[]) => {
      const added = next.filter((id) => !previous.includes(id));
      const removed = previous.filter((id) => !next.includes(id));
      if (!added.length && !removed.length) return;

      patch((current) => ({
        ...current,
        tags: current.tags.map((tag) => {
          if (added.includes(tag.id))
            return { ...tag, projectCount: tag.projectCount + 1 };
          if (removed.includes(tag.id))
            return { ...tag, projectCount: Math.max(0, tag.projectCount - 1) };
          return tag;
        }),
      }));
    },
    [patch],
  );

  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  /**
   * Memoizado de propósito: este objeto desce como prop para cada card da
   * lista. Recriá-lo a cada render mudaria a identidade da prop e faria os
   * cards re-renderizarem todos juntos, mesmo memoizados.
   */
  return useMemo(
    () => ({
      tags,
      byId,
      finishedTagId,
      loading: isPending,
      error: error ? (error as Error).message : null,
      reload,
      create,
      update,
      remove,
      recount,
    }),
    [
      tags,
      byId,
      finishedTagId,
      isPending,
      error,
      reload,
      create,
      update,
      remove,
      recount,
    ],
  );
}

export type TagsController = ReturnType<typeof useTags>;
