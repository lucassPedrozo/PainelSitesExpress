import { createCn } from "cn/config";

/**
 * Junta classes do Tailwind e resolve conflitos (o último vence).
 *
 * Os degraus de texto e os tamanhos de diálogo próprios do painel (`index.css`)
 * precisam estar aqui: sem isso o `cn` lê `text-page` ou `text-ui` como cor e,
 * ao lado de um `text-muted-foreground`, descarta um dos dois.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["page", "section", "ui", "numeral", "2xs"] }],
      // Os tamanhos de diálogo também: sem isto, `sm:max-w-dialog` não vence o
      // `sm:max-w-sm` do diálogo base.
      "max-w": [{ "max-w": ["dialog"] }],
      h: [{ h: ["dialog-tall", "dialog-full"] }],
    },
  },
});
