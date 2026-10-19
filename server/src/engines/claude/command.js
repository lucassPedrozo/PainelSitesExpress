import path from "node:path";

/**
 * A linha de comando do `claude -p`.
 *
 * As permissões vêm do contrato do motor (`joinvixable/config/headless.json`):
 * ferramentas, comandos permitidos e negados, modo de permissão. O painel
 * acrescenta o que é dele — onde ficam os segredos desta máquina — num arquivo
 * de configurações passado em `--settings`.
 *
 * O pedido nunca entra aqui: vai pelo stdin. As listas de ferramentas são
 * variádicas e engoliriam um argumento solto, e no Windows a linha de comando
 * estraga acentos e aspas.
 */

/**
 * @typedef {{
 *   ferramentas: string[], modo_de_permissao: string, fontes_de_configuracao: string,
 *   configuracoes: Record<string, any>, permitir: string[], permitir_no_briefing: string[],
 *   negar: string[], variaveis_removidas: string[], variaveis_definidas: Record<string, string>,
 *   esforco: { criacao: string, ajuste: string, briefing: string },
 *   cancelamento_espera_ms: number,
 * }} Contrato
 * @typedef {{ bin: string, args: string[] }} Comando
 * @typedef {"cliente" | "analisar" | "ajuste" | "continuar" | "criticar" | "refinar" | "edicao"} TipoDePedido
 */

/** Os níveis que o `--effort` do Claude Code aceita, do mais raso ao mais fundo. */
export const ESFORCOS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

/**
 * Id ou apelido de modelo do Claude Code: `claude-opus-5-5`, `opus`, `sonnet[1m]`.
 * O modelo vira um argumento do claude: nada que pareça outra opção dele.
 */
export const MODELO_VALIDO = /^[a-z0-9][a-z0-9._:[\]-]{0,79}$/i;
/** O que dizer a quem informou outra coisa no lugar do modelo. */
export const MODELO_INVALIDO ="Use só o id ou o apelido do modelo (ex.: claude-opus-5-5, sonnet).";

/** Os modelos que as telas oferecem. O campo aceita qualquer outro id válido. */
export const MODELOS = Object.freeze([
  { id: "claude-opus-5-5", rotulo: "Opus 5.5" },
  { id: "claude-fable-5-1", rotulo: "Fable 5.1" },
  { id: "claude-sonnet-5-5", rotulo: "Sonnet 5.5" },
]);

/**
 * `CLAUDE_BIN` troca o executável (instalação fora do PATH). Um arquivo
 * `.mjs`/`.js` roda pelo Node: é o claude falso dos testes.
 * @param {string} [bin]
 */
export function executavel(bin) {
  const escolhido = (bin ?? "").trim() || "claude";
  return /\.(mjs|cjs|js)$/i.test(escolhido)
    ? { bin: process.execPath, prefixo: [escolhido] }
    : { bin: escolhido, prefixo: [] };
}

/**
 * O caminho no formato das regras de arquivo do Claude Code: absoluto a partir
 * da raiz, com barras normais e, no Windows, a letra da unidade em minúscula
 * (`C:\Users\x` vira `//c/Users/x`).
 * @param {string} caminho
 */
export function caminhoDeRegra(caminho) {
  const normal = path.resolve(caminho).replace(/\\/g, "/");
  const unidade = /^([A-Za-z]):\/(.*)$/.exec(normal);
  return unidade ? `//${unidade[1].toLowerCase()}/${unidade[2]}` : `/${normal}`;
}

/**
 * As configurações do Claude Code para uma execução: as do contrato do motor
 * mais as regras de leitura que só o painel conhece. O `.env`, a chave da
 * service account e o que há na pasta de dados fora da pasta do motor nunca
 * são legíveis pelo agente — nem pelas ferramentas de arquivo, nem por `cat`.
 *
 * @param {{ contrato: Contrato, protegidos?: string[] }} params `protegidos`:
 *   arquivos e pastas desta máquina que o agente não pode ler
 */
export function configuracoesDoAgente({ contrato, protegidos = [] }) {
  const doContrato = contrato.configuracoes ?? {};
  const negar = protegidos.flatMap((alvo) => {
    const regra = caminhoDeRegra(alvo);
    // Vale para o arquivo e, sendo pasta, para tudo o que há nela.
    return [`Read(${regra})`, `Read(${regra}/**)`];
  });
  return {
    ...doContrato,
    permissions: {
      ...(doContrato.permissions ?? {}),
      deny: [...(doContrato.permissions?.deny ?? []), ...negar],
    },
  };
}

/**
 * A chave de `esforco` do contrato para cada tipo de pedido. Os demais — criar
 * o site, continuar, criticar e refinar — usam a da criação.
 */
const ESFORCO = { ajuste: "ajuste", analisar: "briefing" };

/**
 * O esforço que o motor espera para um tipo de pedido.
 * @param {Contrato} contrato
 * @param {TipoDePedido} [tipo]
 * @returns {string}
 */
export const esforcoDoContrato = (contrato, tipo) => contrato.esforco[ESFORCO[tipo] ?? "criacao"];

/**
 * @param {{
 *   contrato: Contrato, bin?: string, modelo: string, esforco?: string | null,
 *   tipo?: TipoDePedido, resume?: string | null, sites?: string[],
 *   pasta?: string | null, runbook?: string | null, configuracoes?: string | null,
 * }} params
 *   `esforco`: o que o projeto ou as Configurações escolheram; ausente, vale o
 *   que o contrato do motor espera para o tipo do pedido.
 *   `sites`: domínios citados nas observações de um pedido de briefing — os
 *   únicos para os quais a leitura de páginas é liberada.
 *   `pasta`: a pasta do cliente, no pedido de briefing.
 *   `runbook`: arquivo com o runbook, anexado ao prompt de sistema.
 *   `configuracoes`: arquivo de `--settings`.
 * @returns {Comando}
 */
export function montarComando({
  contrato,
  bin,
  modelo,
  esforco = null,
  tipo,
  resume = null,
  sites = [],
  pasta = null,
  runbook = null,
  configuracoes = null,
}) {
  const { bin: executar, prefixo } = executavel(bin);
  const doBriefing =
    tipo === "analisar" && pasta
      ? contrato.permitir_no_briefing.map((regra) => regra.replaceAll("{pasta}", pasta))
      : [];

  return {
    bin: executar,
    args: [
      ...prefixo,
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      modelo,
      // Sempre com a flag: sem ela o claude -p usa o padrão dele, mais raso.
      "--effort",
      esforco || esforcoDoContrato(contrato, tipo),
      // Sem `--bare`: o modo bare não lê o login da assinatura.
      "--permission-mode",
      contrato.modo_de_permissao,
      "--permission-prompts",
      "none",
      // Sem a fonte `project`, nada da árvore de pastas do painel é herdado —
      // nem configurações, nem o CLAUDE.md de uma pasta de cima. Por isso o
      // runbook vai anexado ao prompt de sistema, e não como CLAUDE.md.
      "--setting-sources",
      contrato.fontes_de_configuracao,
      ...(configuracoes ? ["--settings", configuracoes] : []),
      ...(runbook ? ["--append-system-prompt-file", runbook] : []),
      "--tools",
      [...contrato.ferramentas, ...(sites.length ? ["WebFetch"] : [])].join(","),
      "--allowedTools",
      ...contrato.permitir,
      ...doBriefing,
      ...sites.flatMap((site) => [`WebFetch(domain:${site})`, `WebFetch(domain:www.${site})`]),
      "--disallowedTools",
      ...contrato.negar,
      "--strict-mcp-config",
      "--disable-slash-commands",
      ...(resume ? ["--resume", resume] : []),
    ],
  };
}

/**
 * O `claude -p` mínimo do teste de login: sem ferramentas e sem gravar sessão.
 * @param {{ contrato: Contrato, bin?: string, modelo: string }} params
 * @returns {Comando}
 */
export function montarComandoTeste({ contrato, bin, modelo }) {
  const { bin: executar, prefixo } = executavel(bin);
  return {
    bin: executar,
    args: [
      ...prefixo,
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      modelo,
      "--tools",
      "",
      "--permission-mode",
      contrato.modo_de_permissao,
      "--permission-prompts",
      "none",
      "--setting-sources",
      contrato.fontes_de_configuracao,
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
    ],
  };
}

/**
 * O comando como se digita em um terminal, para mostrar à pessoa.
 * @param {Comando} comando
 */
export const comandoTexto = (comando) =>
  [path.basename(comando.bin).replace(/\.exe$/i, ""), ...comando.args]
    .map((arg) => (!arg || /[\s()*"{}]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ");
