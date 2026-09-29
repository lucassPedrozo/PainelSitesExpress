/**
 * O que cada chave de acesso pode fazer — a lista única do painel.
 *
 * API e interface importam daqui. Antes cada lado tinha a sua cópia, e uma
 * permissão nova incluída só no servidor simplesmente não aparecia na tela de
 * chaves (ou aparecia na tela e era recusada pela API).
 *
 * Ver projetos, arquivos e briefings não é uma permissão: é a base de qualquer
 * acesso ao painel. O que se concede aqui é o direito de **mudar** alguma coisa.
 */
export const ACCESS_PERMISSIONS = Object.freeze([
  "organizar",
  "gerar",
  "publicar",
  "configurar",
  "administrar",
]);
