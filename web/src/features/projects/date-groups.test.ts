import { describe, expect, it } from "vitest";
import { dateGroupOf, groupByDate } from "@/features/projects/date-groups";

const REF = Date.parse("2026-09-09T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe("dateGroupOf", () => {
  it("separa hoje, ontem e as janelas relativas", () => {
    expect(dateGroupOf(dia("2026-09-09"), REF).label).toBe("Hoje");
    expect(dateGroupOf(dia("2026-09-08"), REF).label).toBe("Ontem");
    expect(dateGroupOf(dia("2026-09-05"), REF).label).toBe("Últimos 7 dias");
    expect(dateGroupOf(dia("2026-08-25"), REF).label).toBe("Últimos 30 dias");
  });

  it("conta dias de calendário, não períodos de 24 h", () => {
    // Às 00h30, uma coleta de ontem às 23h tem de cair em "Ontem" — e não em
    // "Hoje" só porque faz menos de um dia. As datas são montadas em hora
    // local de propósito: é o calendário do operador que define a faixa, e
    // usar UTC aqui testaria outra coisa.
    const meiaNoiteEMeia = new Date(2026, 8, 9, 0, 30).getTime();
    const ontemDeNoite = new Date(2026, 8, 8, 23, 0);

    expect(ontemDeNoite.getTime()).toBeGreaterThan(meiaNoiteEMeia - 86_400_000);
    expect(dateGroupOf(ontemDeNoite, meiaNoiteEMeia).label).toBe("Ontem");
  });

  it("passa a mês no ano corrente e a ano no que é mais antigo", () => {
    expect(dateGroupOf(dia("2026-07-15"), REF).label).toBe("Julho");
    expect(dateGroupOf(dia("2025-11-02"), REF).label).toBe("2025");
  });

  it("trata data futura como hoje — é erro de digitação, não faixa", () => {
    expect(dateGroupOf(dia("2026-12-31"), REF).label).toBe("Hoje");
  });

  it("dá a mesma chave a datas da mesma faixa", () => {
    expect(dateGroupOf(dia("2026-09-05"), REF).key).toBe(
      dateGroupOf(dia("2026-09-04"), REF).key,
    );
    expect(dateGroupOf(dia("2026-07-01"), REF).key).not.toBe(
      dateGroupOf(dia("2026-06-01"), REF).key,
    );
  });
});

describe("groupByDate", () => {
  const itens = [
    { id: "hoje", d: dia("2026-09-09") },
    { id: "semana", d: dia("2026-09-05") },
    { id: "mes", d: dia("2026-08-20") },
    { id: "julho-a", d: dia("2026-07-20") },
    { id: "julho-b", d: dia("2026-07-02") },
  ];

  it("junta vizinhos da mesma faixa, na ordem recebida", () => {
    const grupos = groupByDate(itens, (i) => i.d, REF);
    expect(grupos.map((g) => g.label)).toEqual([
      "Hoje",
      "Últimos 7 dias",
      "Últimos 30 dias",
      "Julho",
    ]);
    expect(grupos.at(-1)?.items.map((i) => i.id)).toEqual(["julho-a", "julho-b"]);
  });

  it("não cria faixa vazia", () => {
    // Não há nada de ontem: "Ontem" não deve aparecer.
    const grupos = groupByDate(itens, (i) => i.d, REF);
    expect(grupos.map((g) => g.label)).not.toContain("Ontem");
  });

  it("preserva a soma dos itens", () => {
    const grupos = groupByDate(itens, (i) => i.d, REF);
    expect(grupos.reduce((n, g) => n + g.items.length, 0)).toBe(itens.length);
  });

  it("lista vazia não gera grupo", () => {
    expect(groupByDate([], (i: { d: Date }) => i.d, REF)).toEqual([]);
  });
});
