/** Tipos de `domain.js` para a interface (TypeScript). */
export function findDomain(
  text: string | null | undefined,
): { domain: string; exact: boolean } | null;

export function normalizeDomain(text: string | null | undefined): string | null;

export function parseCollectionName(rawName: string): {
  label: string;
  domain: string | null;
  collected: { day: number; month: number; year: number } | null;
};
