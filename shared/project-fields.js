/**
 * O que a equipe corrige à mão num projeto: as etapas que dá para escolher e o
 * tamanho de cada campo. A API recusa o que passar daqui, e a interface limita
 * os campos pelos mesmos números.
 */

/** As etapas que dá para escolher à mão — as do caminho até o domínio. */
export const MANUAL_STAGES = ["material", "geracao", "link", "cliente", "publicacao", "no-ar"];

/** Nome do projeto (projeto do painel ou nome corrigido de uma pasta do Drive). */
export const MAX_PROJECT_NAME = 120;

/** Responsável pelo projeto. */
export const MAX_RESPONSIBLE = 80;

/** Observação interna, só da equipe. */
export const MAX_NOTE = 1000;
