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
const REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Nome aceito para um repositório novo na organização: começa com letra ou
 * número, tem até 100 letras, números, pontos, hífens e sublinhados, e não
 * termina em `.git`. A API recusa e a interface avisa pela mesma regra.
 *
 * @param {string} name
 * @returns {boolean}
 */
export const isValidRepoName = (name) => REPO_NAME_PATTERN.test(name) && !name.endsWith(".git");

export const repoNameOf = (lovableName) =>
  lovableName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
