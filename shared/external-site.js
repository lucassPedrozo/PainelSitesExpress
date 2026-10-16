/**
 * Site que não veio do Lovable — vinculado de fora ou feito pelo motor Claude.
 * O id dele é criado pelo painel, com este prefixo, e nunca é consultado no
 * Lovable: não há editor, Share preview nem agente.
 */
export const EXTERNAL_PREFIX = "ext-";

/** @param {{ id?: unknown } | null | undefined} generation */
export const isExternalSite = (generation) =>
  typeof generation?.id === "string" && generation.id.startsWith(EXTERNAL_PREFIX);
