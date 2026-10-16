/**
 * As opções do motor Claude que a tela de Configurações (pela API) e a revisão
 * do briefing (na interface) mostram com os mesmos nomes, e o limite das
 * imagens de um ajuste, que a API confere e a interface avisa antes de subir.
 */

/** Como a tela chama cada nível do `--effort` do Claude Code. */
export const EFFORT_LABELS = { low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto", max: "Máximo" };

/** Até onde o visual do site se afasta do convencional. */
export const ART_DIRECTION_LEVELS = [
  { value: "sobria", label: "Sóbria" },
  { value: "autoral", label: "Autoral" },
  { value: "ousada", label: "Ousada" },
];

/** Quanta animação o site leva. */
export const MOTION_LEVELS = [
  { value: "discreto", label: "Discreto" },
  { value: "expressivo", label: "Expressivo" },
  { value: "cinematografico", label: "Cinematográfico" },
];

/** Um pedido de ajuste leva até seis imagens de 8 MB. */
export const MAX_ADJUST_ATTACHMENTS = 6;
export const MAX_ADJUST_ATTACHMENT_BYTES = 8 * 1024 * 1024;
