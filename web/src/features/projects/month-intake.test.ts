import { describe, expect, it } from "vitest";
import type { DashboardRow } from "@/features/dashboard/dashboard-metrics";
import { countTicks, monthIntake } from "@/features/projects/month-intake";

/** O gráfico dos projetos novos do mês: a conta por dia, dos dois lados. */

// 15 de outubro de 2026, à tarde, no fuso de quem roda o teste.
const REF = new Date(2026, 9, 15, 15, 0).getTime();
const linha = (quando: Date, source: "drive" | "panel" = "drive") =>
  ({ receivedAt: quando.getTime(), project: { source } }) as unknown as DashboardRow;

describe("monthIntake", () => {
  it("tem todos os dias do mês, e a linha para hoje", () => {
    const mes = monthIntake([], REF);
    expect(mes.days).toHaveLength(31);
    expect(mes.days[0].day).toBe(1);
    expect(mes.days.at(-1)?.day).toBe(31);
    expect(mes.today).toBe(15);
    expect(mes.days[14]).toMatchObject({ day: 15, drive: 0, panel: 0 });
    expect(mes.days[15]).toMatchObject({ day: 16, drive: null, panel: null });
    expect(mes.label).toBe("Outubro de 2026");
    // Fevereiro de 2026 tem 28 dias.
    expect(monthIntake([], new Date(2026, 1, 10).getTime()).days).toHaveLength(28);
  });

  it("separa o que chegou pelo Drive do que foi criado no painel, por dia", () => {
    const mes = monthIntake(
      [
        linha(new Date(2026, 9, 1, 9)),
        linha(new Date(2026, 9, 1, 18)),
        linha(new Date(2026, 9, 1, 10), "panel"),
        linha(new Date(2026, 9, 14, 23, 59), "panel"),
      ],
      REF,
    );
    expect(mes.days[0]).toMatchObject({ drive: 2, panel: 1 });
    expect(mes.days[13]).toMatchObject({ drive: 0, panel: 1 });
    expect(mes.totals).toEqual({ drive: 2, panel: 2 });
  });

  it("deixa de fora os outros meses, e uma data à frente do relógio conta hoje", () => {
    const mes = monthIntake(
      [
        linha(new Date(2026, 8, 30, 23)),
        linha(new Date(2025, 9, 5)),
        linha(new Date(2026, 10, 1)),
        linha(new Date(2026, 9, 20)),
      ],
      REF,
    );
    expect(mes.totals).toEqual({ drive: 1, panel: 0 });
    expect(mes.days[14].drive).toBe(1);
  });
});

describe("countTicks", () => {
  it("vai do zero a um teto redondo, com no mínimo 0 a 4", () => {
    expect(countTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(countTicks(3)).toEqual([0, 1, 2, 3, 4]);
    expect(countTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(countTicks(12)).toEqual([0, 5, 10, 15]);
  });
});
