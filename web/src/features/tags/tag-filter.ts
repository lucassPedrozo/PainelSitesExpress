/** O filtro de tags da lista de projetos. */
export type TagFilter = {
  tagIds: string[];
  matchAll: boolean;
  untaggedOnly: boolean;
};

export const emptyTagFilter: TagFilter = {
  tagIds: [],
  matchAll: false,
  untaggedOnly: false,
};
