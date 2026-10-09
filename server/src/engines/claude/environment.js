import path from "node:path";

/**
 * O ambiente dos processos do motor Claude: o `claude -p` e os comandos do
 * motor que o painel roda.
 *
 * O processo do painel carrega o token do GitHub, as senhas de FTP e os tokens
 * do Lovable e do BetterLinks. O executor antigo entregava ao `claude` o
 * ambiente inteiro menos as chaves de API — aqui é o contrário: uma lista de
 * permissão. Só passa o que o sistema, o Claude Code e as ferramentas do motor
 * precisam para funcionar; tudo o mais fica de fora sem precisar ser lembrado.
 */

/** O que o Windows e o Node precisam para achar executáveis, o perfil e a pasta temporária. */
const DO_SISTEMA = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  // É no perfil do usuário que o Claude Code guarda o login da assinatura.
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "USERNAME",
  "USER",
  "LOGNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
];

/** O que muda onde o Claude Code procura a configuração dele e como ele sai para a rede. */
const DO_CLAUDE_CODE = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_GIT_BASH_PATH",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
];

export const VARIAVEIS_PERMITIDAS = Object.freeze([...DO_SISTEMA, ...DO_CLAUDE_CODE]);

/**
 * @param {{
 *   base?: NodeJS.ProcessEnv,
 *   definidas?: Record<string, string | null | undefined>,
 *   removidas?: string[],
 * }} [opcoes]
 *   `definidas`: o que o painel passa de forma explícita (pasta de trabalho,
 *   modelo, chave do Pixabay…); valor vazio não entra.
 *   `removidas`: a lista do contrato do motor — conferida por último, para uma
 *   chave de API não entrar nem que alguém a ponha na lista de cima.
 * @returns {Record<string, string>}
 */
export function ambienteDoFilho({ base = process.env, definidas = {}, removidas = [] } = {}) {
  const permitidas = new Set(VARIAVEIS_PERMITIDAS);
  /** @type {Record<string, string>} */
  const env = {};
  // No Windows o nome da variável não diferencia maiúsculas; a cópia do ambiente, sim.
  for (const [nome, valor] of Object.entries(base)) {
    if (valor !== undefined && permitidas.has(nome.toUpperCase())) env[nome] = valor;
  }
  for (const [nome, valor] of Object.entries(definidas)) {
    if (valor !== undefined && valor !== null && valor !== "") env[nome] = String(valor);
  }
  // Os comandos do runbook chamam `node` pelo nome: o Node que roda o painel
  // vai na frente do PATH, para ser ele — e para existir — em qualquer máquina.
  const doNode = path.dirname(process.execPath);
  const chavesDoPath = Object.keys(env).filter((nome) => nome.toUpperCase() === "PATH");
  for (const chave of chavesDoPath.length ? chavesDoPath : ["PATH"]) {
    const atual = env[chave] ?? "";
    if (!atual.split(path.delimiter).includes(doNode)) env[chave] = atual ? `${doNode}${path.delimiter}${atual}` : doNode;
  }

  const proibidas = new Set(removidas.map((nome) => nome.toUpperCase()));
  for (const nome of Object.keys(env)) {
    if (proibidas.has(nome.toUpperCase())) delete env[nome];
  }
  return env;
}
