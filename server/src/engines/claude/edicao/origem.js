/**
 * Quem fez cada alteração no repositório de um site: o Lovable, o Claude (por
 * este painel), outra pessoa, ou o próprio painel configurando a publicação.
 *
 * - **Lovable**: os commits dele saem com o robô do Lovable como autor
 *   (`lovable-dev[bot]`) e o `gpt-engineer-app[bot]` como committer — visto
 *   nos repositórios da organização.
 * - **Claude**: os commits que este painel faz depois de um ajuste levam a
 *   marca `Ajuste-Painel: <id>` no fim da mensagem.
 * - **Painel**: commits que só mexem em `.github/` — os workflows de build,
 *   publicação e área de aprovação que o painel grava. Não são alteração do
 *   site, e por isso não contam como "a última alteração".
 * - **Pessoa**: qualquer outro commit (alguém editou à mão, ou pelo GitHub).
 */

/** A marca que fecha a mensagem de todo commit de ajuste do painel. */
export const MARCA_DO_AJUSTE = "Ajuste-Painel";

/** O autor dos commits de ajuste. */
export const AUTOR_DO_AJUSTE = Object.freeze({ nome: "Claude (Painel Sites Express)", email: "claude@painel-sites-express.invalid" });

const DO_LOVABLE = /lovable|gpt-engineer/i;
const TEM_MARCA = new RegExp(`^${MARCA_DO_AJUSTE}:\\s*(\\S+)\\s*$`, "m");

/**
 * @typedef {"lovable" | "claude" | "person" | "panel"} Origem
 * @typedef {{ sha: string, authorName: string, authorEmail: string, committerName: string,
 *   committerEmail: string, at: string, subject: string, body: string, files: string[] }} CommitLido
 */

/**
 * @param {CommitLido} commit
 * @returns {Origem}
 */
export function origemDoCommit(commit) {
  if (TEM_MARCA.test(commit.body ?? "")) return "claude";
  if (DO_LOVABLE.test(`${commit.authorName} ${commit.authorEmail} ${commit.committerName} ${commit.committerEmail}`)) return "lovable";
  if (commit.files.length > 0 && commit.files.every((arquivo) => arquivo.startsWith(".github/"))) return "panel";
  return "person";
}

/** O ajuste do painel que gerou o commit, quando ele tem a marca. */
const ajusteDoCommit = (/** @type {CommitLido} */ commit) => TEM_MARCA.exec(commit.body ?? "")?.[1] ?? null;

/**
 * O commit como a tela o vê: quem fez, quando e o quê.
 * @param {CommitLido} commit
 * @param {string} repo
 */
export function commitParaATela(commit, repo) {
  const origem = origemDoCommit(commit);
  return {
    sha: commit.sha,
    origin: origem,
    author: origem === "lovable" ? "Lovable" : origem === "claude" ? "Claude" : commit.authorName,
    message: commit.subject,
    at: commit.at,
    url: `https://github.com/${repo}/commit/${commit.sha}`,
    files: commit.files.length,
    editId: ajusteDoCommit(commit),
  };
}

/**
 * A última alteração do site: o commit mais recente que não é só configuração
 * de publicação do painel.
 * @param {CommitLido[]} commits do mais recente para o mais antigo
 */
export const ultimaAlteracao = (commits) => commits.find((commit) => origemDoCommit(commit) !== "panel") ?? commits[0] ?? null;
