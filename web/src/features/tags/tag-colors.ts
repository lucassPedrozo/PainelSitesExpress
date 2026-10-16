import { TAG_COLORS } from "@shared/tag-colors.js";
import type { TagColor } from "@/lib/api";

/**
 * As cores das tags. São a exceção às cores do tema: quem cria a tag escolhe
 * a cor, e ela precisa ser a mesma em toda tela e nos dois temas — por isso o
 * tom fixo do Tailwind, e não um token de estado.
 *
 * As classes precisam aparecer literalmente no código para o Tailwind
 * detectá-las — por isso o mapa é escrito por extenso, sem interpolação.
 */

/**
 * A ordem da paleta: a do seletor de cor e a da cor sugerida para a próxima
 * tag. É a mesma lista da API (`shared/tag-colors.js`).
 */
export const TAG_PALETTE: TagColor[] = TAG_COLORS;

/** A cor depois de `color` na paleta, girando: a sugestão para a próxima tag. */
export const nextTagColor = (color: TagColor) =>
  TAG_PALETTE[(TAG_PALETTE.indexOf(color) + 1) % TAG_PALETTE.length];

export const tagDotClass: Record<TagColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  cyan: "bg-cyan-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export const tagColorLabels: Record<TagColor, string> = {
  slate: "Cinza",
  blue: "Azul",
  cyan: "Ciano",
  emerald: "Verde",
  amber: "Âmbar",
  orange: "Laranja",
  red: "Vermelho",
  violet: "Violeta",
  pink: "Rosa",
};
