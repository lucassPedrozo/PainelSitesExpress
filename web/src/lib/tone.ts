/**
 * Os tons de estado do painel — um por significado, iguais em toda tela.
 *
 * - `info`: algo em andamento ou informativo (gerando, publicando, no ar);
 * - `success`: concluído e bem (pronto, entregue, conectado);
 * - `warning`: pede atenção, mas não quebrou (falta um passo);
 * - `danger`: quebrou ou foi recusado;
 * - `neutral`: estado de repouso, sem nada a destacar.
 *
 * As classes aparecem por extenso para o Tailwind detectá-las.
 */
export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

/** Selo, chip ou etiqueta: borda, fundo e texto do tom. */
export const toneBadge: Record<Tone, string> = {
  info: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** Faixa de aviso (banner): fundo suave e borda do tom; o texto segue o normal. */
export const toneBanner: Record<Tone, string> = {
  info: "border-info/25 bg-info/5",
  success: "border-success/25 bg-success/5",
  warning: "border-warning/30 bg-warning/8",
  danger: "border-destructive/25 bg-destructive/5",
  neutral: "border-border bg-muted/50",
};

/** Só o texto ou o ícone no tom. */
export const toneText: Record<Tone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};
