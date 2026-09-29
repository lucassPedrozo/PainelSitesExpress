/**
 * O nome que o GitHub dá ao repositório criado pelo Lovable: o nome do
 * projeto em minúsculas, com tudo que não é letra ou número (acentos
 * inclusive) trocado por hífen. Conferido nos repositórios da organização:
 * "SBC Cobranças: Smart Recovery" → `sbc-cobran-as-smart-recovery`.
 *
 * A API usa para achar sozinha o repositório e publicar na área de
 * desenvolvimento; a interface, para sugerir o repositório ao publicar.
 *
 * @param {string} lovableName
 * @returns {string}
 */
export const repoNameOf = (lovableName) =>
  lovableName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
