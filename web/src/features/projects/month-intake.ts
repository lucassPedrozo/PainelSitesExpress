import type { DashboardRow } from "@/features/dashboard/dashboard-metrics";

/**
 * Os projetos novos do mês, dia a dia: os recebidos pelo Drive e os criados
 * no painel. A conta é a do Dashboard ("Recebidos"): as mesmas linhas
 * (`buildRows` — sem ocultos, sem projeto só de arquivos, sem coleta repetida
 * de um domínio) e a mesma data, a da chegada da pasta ou da criação no
 * painel. Assim o número daqui nunca diverge do de lá.
 */
export type IntakeDay = {
  /** O dia do mês, de 1 a 31. */
  day: number;
  /** Meia-noite do dia, no fuso de quem olha. */
  at: number;
  /** `null` nos dias que ainda não chegaram: a linha para no dia de hoje. */
  drive: number | null;
  panel: number | null;
};

export type MonthIntake = {
  /** O primeiro dia do mês, à meia-noite. */
  monthStart: number;
  /** "Outubro de 2026". */
  label: string;
  /** Todos os dias do mês, do 1 ao último. */
  days: IntakeDay[];
  /** O dia de hoje no mês (1–31). */
  today: number;
  totals: { drive: number; panel: number };
};

const monthLabel = (date: Date) => {
  const texto = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return `${texto.charAt(0).toLocaleUpperCase("pt-BR")}${texto.slice(1)}`;
};

export function monthIntake(rows: DashboardRow[], reference: number): MonthIntake {
  const agora = new Date(reference);
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  const total = new Date(ano, mes + 1, 0).getDate();
  const hoje = agora.getDate();

  const drive = new Array<number>(total).fill(0);
  const panel = new Array<number>(total).fill(0);
  for (const row of rows) {
    const quando = new Date(row.receivedAt);
    if (quando.getFullYear() !== ano || quando.getMonth() !== mes) continue;
    // Uma data à frente do relógio (fuso, relógio da pasta) conta hoje.
    const dia = Math.min(quando.getDate(), hoje) - 1;
    if (row.project.source === "panel") panel[dia] += 1;
    else drive[dia] += 1;
  }

  const days = Array.from({ length: total }, (_, index) => {
    const day = index + 1;
    const passou = day <= hoje;
    return {
      day,
      at: new Date(ano, mes, day).getTime(),
      drive: passou ? drive[index] : null,
      panel: passou ? panel[index] : null,
    };
  });

  return {
    monthStart: new Date(ano, mes, 1).getTime(),
    label: monthLabel(agora),
    days,
    today: hoje,
    totals: { drive: drive.reduce((a, b) => a + b, 0), panel: panel.reduce((a, b) => a + b, 0) },
  };
}

/**
 * As marcas do eixo dos projetos: números inteiros redondos, do zero a um
 * teto que cabe o maior dia. Um mês parado ainda mostra a escala de 0 a 4.
 */
export function countTicks(max: number): number[] {
  const passo = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10;
  const teto = Math.max(4, Math.ceil(max / passo) * passo);
  const marcas: number[] = [];
  for (let valor = 0; valor <= teto; valor += passo) marcas.push(valor);
  return marcas;
}
