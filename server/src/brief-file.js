/**
 * Qual arquivo da pasta é o briefing — a regra única, usada pela contagem que
 * acende o botão no card e pela leitura que vira prompt.
 *
 * Antes cada lado escolhia do seu jeito: a contagem pegava o primeiro que o
 * Drive devolvesse, a leitura o primeiro em ordem alfabética. Numa pasta com
 * dois briefings (o cliente preencheu o formulário de novo), o card e o prompt
 * podiam falar de arquivos diferentes.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * O nome varia bastante depois do prefixo ("Informações do Site - [dominio]",
 * "... - NAO TENHO"), então só o começo é exigido, com tolerância a acento e
 * caixa.
 */
const BRIEF_PATTERN = /informa[çc][õo]es\s+do\s+site/i;

export const isBriefFile = (file) =>
  file.mimeType !== FOLDER_MIME && BRIEF_PATTERN.test(file.name ?? "");

/**
 * O briefing mais recente da pasta e quantos há. O mais recente vence porque
 * o reenvio do formulário costuma ser a correção do primeiro.
 *
 * @template {{ name?: string, mimeType?: string, modifiedTime?: string }} F
 * @param {F[]} files
 * @returns {{ file: F | null, count: number }}
 */
export function pickBrief(files) {
  const briefs = files
    .filter(isBriefFile)
    .sort((a, b) =>
      String(b.modifiedTime ?? "").localeCompare(String(a.modifiedTime ?? "")),
    );
  return { file: briefs[0] ?? null, count: briefs.length };
}
