import { describe, expect, it } from "vitest";
import { smoothPath } from "@/lib/chart-path";

/** A curva do gráfico de linhas: suave, mas sem inventar valor. */

/** Os pontos de controle das cúbicas, na ordem em que aparecem no traço. */
const controles = (d: string) =>
  [...d.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)].map((m) => ({
    c1: Number(m[2]),
    c2: Number(m[4]),
    fim: Number(m[6]),
  }));

describe("smoothPath", () => {
  it("passa por todos os pontos", () => {
    const d = smoothPath([
      { x: 0, y: 100 },
      { x: 10, y: 80 },
      { x: 20, y: 100 },
    ]);
    expect(d.startsWith("M0.0,100.0")).toBe(true);
    expect(controles(d).map((c) => c.fim)).toEqual([80, 100]);
  });

  it("não passa do valor real: dias parados ficam na base e o pico não cresce", () => {
    // Em pixels, y cresce para baixo: a base (zero projeto) é 100, o pico é 10.
    const base = 100;
    const pico = 10;
    const d = smoothPath([
      { x: 0, y: base },
      { x: 10, y: base },
      { x: 20, y: base },
      { x: 30, y: pico },
      { x: 40, y: base },
    ]);
    for (const { c1, c2 } of controles(d)) {
      for (const y of [c1, c2]) {
        expect(y).toBeLessThanOrEqual(base);
        expect(y).toBeGreaterThanOrEqual(pico);
      }
    }
    // O trecho parado continua reto, na base.
    expect(controles(d)[0]).toMatchObject({ c1: base, c2: base });
  });

  it("um ponto só é só o ponto; nenhum é nada", () => {
    expect(smoothPath([{ x: 5, y: 5 }])).toBe("M5.0,5.0");
    expect(smoothPath([])).toBe("");
  });
});
