/**
 * O traço de um gráfico de linhas, suave mas fiel aos dados: uma curva cúbica
 * monótona (Fritsch–Carlson). Entre dois pontos ela nunca passa do maior nem
 * do menor deles — um dia sem projeto não vira "-0,3" na curva, e o pico não
 * cresce além do que aconteceu. Os pontos vêm em pixels, com x crescente.
 */
export type Point = { x: number; y: number };

export function smoothPath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  const fmt = (v: number) => v.toFixed(1);
  if (n === 1) return `M${fmt(points[0].x)},${fmt(points[0].y)}`;

  // A inclinação de cada trecho e, em cada ponto, a tangente da curva.
  const secante = points.slice(0, -1).map((p, i) => (points[i + 1].y - p.y) / (points[i + 1].x - p.x));
  const tangente = points.map((_, i) => {
    if (i === 0) return secante[0];
    if (i === n - 1) return secante[n - 2];
    const antes = secante[i - 1];
    const depois = secante[i];
    // Num pico, num vale ou num trecho plano, a curva chega deitada.
    return antes * depois <= 0 ? 0 : (antes + depois) / 2;
  });
  // O ajuste de Fritsch–Carlson: tangentes grandes demais fariam a curva passar do ponto.
  for (let i = 0; i < n - 1; i++) {
    if (secante[i] === 0) {
      tangente[i] = 0;
      tangente[i + 1] = 0;
      continue;
    }
    const a = tangente[i] / secante[i];
    const b = tangente[i + 1] / secante[i];
    const soma = a * a + b * b;
    if (soma > 9) {
      const t = 3 / Math.sqrt(soma);
      tangente[i] = t * a * secante[i];
      tangente[i + 1] = t * b * secante[i];
    }
  }

  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const terco = (q.x - p.x) / 3;
    d += ` C${fmt(p.x + terco)},${fmt(p.y + tangente[i] * terco)} ${fmt(q.x - terco)},${fmt(q.y - tangente[i + 1] * terco)} ${fmt(q.x)},${fmt(q.y)}`;
  }
  return d;
}
