import type { BuildFile, BuildPackage } from "@/lib/api";

/**
 * O que é enviado ao Lovable, calculado fora da tela.
 *
 * Estas regras decidem quanto crédito se gasta e o que o modelo recebe, então
 * valem um teste próprio — e não uma conferência a olho no diálogo.
 */

/**
 * Briefing do cliente + observações do operador, nessa ordem.
 *
 * Os dois ficam em campos separados de propósito: o briefing é o que o cliente
 * escreveu e vale como registro; as observações são decisão nossa. Quando não
 * há briefing no Drive, as observações *são* o prompt.
 */
export function composePrompt(briefing: string, observations: string): string {
  const base = briefing.trim();
  const extra = observations.trim();
  if (!extra) return base;
  if (!base) return extra;
  return `${base}\n\n## Observações adicionais\n${extra}`;
}

/**
 * Marcação inicial dos anexos: o material visual recomendado, até o teto por
 * envio. Uma coleta com dezenas de fotos estouraria o limite e a tela abriria
 * já inválida — por isso o corte, que o aviso explica.
 *
 * Compactados vêm primeiro: um `.zip` carrega as fotos que não cabem no teto,
 * e seria o pior anexo para o corte deixar de fora.
 */
export function initialSelection(
  files: BuildFile[],
  maxAttachments: number,
): Set<string> {
  const compactadoPrimeiro = (file: BuildFile) => (file.kind === "archive" ? 0 : 1);
  return new Set(
    files
      .filter((file) => file.recommended)
      .sort((a, b) => compactadoPrimeiro(a) - compactadoPrimeiro(b))
      .slice(0, maxAttachments)
      .map((file) => file.id),
  );
}

/** Todos os anexáveis, respeitando o teto por envio. */
export const selectAll = (files: BuildFile[], maxAttachments: number) =>
  new Set(
    files
      .filter((file) => !file.blockedReason)
      .slice(0, maxAttachments)
      .map((file) => file.id),
  );

export type SelectionSummary = {
  /** Arquivos marcados que ainda existem na lista. */
  chosen: BuildFile[];
  totalBytes: number;
  overLimit: boolean;
  promptChars: number;
  promptTooLong: boolean;
  /** Recomendados além do teto — a tela avisa que marcou só os primeiros. */
  capped: boolean;
  blocked: number;
  recommended: number;
};

export function summarizeSelection(
  pkg: BuildPackage,
  selected: Set<string>,
  finalPrompt: string,
): SelectionSummary {
  const chosen = pkg.files.filter((file) => selected.has(file.id));
  const recommended = pkg.files.filter((file) => file.recommended).length;

  return {
    chosen,
    totalBytes: chosen.reduce((sum, file) => sum + (file.size ?? 0), 0),
    overLimit: selected.size > pkg.limits.maxAttachments,
    promptChars: finalPrompt.length,
    promptTooLong: finalPrompt.length > pkg.limits.maxPromptChars,
    capped: recommended > pkg.limits.maxAttachments,
    blocked: pkg.files.filter((file) => file.blockedReason).length,
    recommended,
  };
}

/** Busca por nome do arquivo ou da subpasta onde ele está. */
export const filterFiles = (files: BuildFile[], query: string) => {
  const term = query.trim().toLowerCase();
  if (!term) return files;
  return files.filter(
    (file) =>
      file.name.toLowerCase().includes(term) ||
      file.folder?.toLowerCase().includes(term),
  );
};
