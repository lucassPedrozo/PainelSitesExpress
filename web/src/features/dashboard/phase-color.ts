import type { Phase } from "./dashboard-metrics";

/**
 * A cor de cada trecho do fluxo — a mesma no gráfico de etapas e nas barras.
 * A espera é cinza de propósito: é o tempo em que ninguém trabalhou no projeto.
 */
export const phaseColor: Record<Phase, string> = {
  waiting: "bg-muted-foreground/40",
  production: "bg-chart-1",
  client: "bg-chart-4",
  done: "bg-chart-3",
};
