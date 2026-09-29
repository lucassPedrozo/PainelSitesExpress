/**
 * Faixas de data para separar a lista de projetos. Segue o padrão que já se
 * espera de uma caixa de entrada: janelas relativas para o que é recente, mês
 * para o resto do ano corrente, ano para o que é mais antigo.
 *
 * As janelas são contadas em dias de calendário, não em períodos de 24 h: às
 * 00h30 uma coleta de ontem à noite precisa aparecer em "Ontem", e não em
 * "Hoje" porque faz menos de um dia.
 */
export type DateGroup = {
  /** Identidade da faixa — vira `key` da seção e junta os vizinhos iguais. */
  key: string;
  label: string;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const DAY = 86_400_000;

const monthLabel = (date: Date) => {
  const name = date.toLocaleDateString("pt-BR", { month: "long" });
  return `${name.charAt(0).toLocaleUpperCase("pt-BR")}${name.slice(1)}`;
};

export function dateGroupOf(date: Date, reference: number): DateGroup {
  const now = new Date(reference);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);

  // Datas à frente do relógio entram em "Hoje": uma pasta nomeada com data
  // futura é erro de digitação, não uma faixa que mereça seção própria.
  if (days <= 0) return { key: "hoje", label: "Hoje" };
  if (days === 1) return { key: "ontem", label: "Ontem" };
  if (days <= 7) return { key: "7d", label: "Últimos 7 dias" };
  if (days <= 30) return { key: "30d", label: "Últimos 30 dias" };

  if (date.getFullYear() === now.getFullYear()) {
    return {
      key: `mes-${date.getFullYear()}-${date.getMonth()}`,
      label: monthLabel(date),
    };
  }

  return { key: `ano-${date.getFullYear()}`, label: String(date.getFullYear()) };
}

export type DatedGroup<T> = DateGroup & { items: T[] };

/**
 * Junta os itens já ordenados em faixas contíguas. Depende da ordenação: só
 * faz sentido sobre uma lista ordenada pela mesma data que alimenta o
 * agrupamento, senão a mesma faixa reapareceria várias vezes.
 */
export function groupByDate<T>(
  items: T[],
  dateOf: (item: T) => Date,
  reference: number,
): Array<DatedGroup<T>> {
  const groups: Array<DatedGroup<T>> = [];

  for (const item of items) {
    const group = dateGroupOf(dateOf(item), reference);
    const last = groups.at(-1);
    if (last && last.key === group.key) last.items.push(item);
    else groups.push({ ...group, items: [item] });
  }

  return groups;
}
