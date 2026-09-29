import type { TagColor } from "@/lib/api";

/**
 * As classes precisam aparecer literalmente no código para o Tailwind
 * detectá-las — por isso o mapa é escrito por extenso, sem interpolação.
 */
export const tagBadgeClass: Record<TagColor, string> = {
  slate:
    "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  blue: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  emerald:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  orange:
    "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  red: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  violet:
    "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  pink: "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
};

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
