import path from "node:path";
import { ART_DIRECTION_LEVELS, EFFORT_LABELS, MOTION_LEVELS } from "../../../shared/claude-options.js";
import { ESFORCOS, MODELO_INVALIDO, MODELO_VALIDO } from "../engines/claude/command.js";
import { config } from "../config.js";
import { isLocalNetworkAddress } from "../security/network.js";
import { HOST_PATTERN } from "../../../shared/deploy-rules.js";
import { FREE_TIER_MODELS, isFlashModel } from "../gemini/client.js";

/**
 * Todas as chaves do `.env` que a tela de configuração edita, com o que a tela
 * precisa saber de cada uma: seção, tipo, validação, se é segredo e se o valor
 * novo só vale depois de reiniciar o painel.
 *
 * `restart: true` são as que `config.js` lê uma vez, na subida (`config`); as
 * demais são relidas a cada uso (`runtimeConfig`, `devAreaConfig`, `claudeConfig`)
 * e valem na hora.
 *
 * Segredos nunca voltam para o navegador: a tela recebe só se estão definidos
 * e uma dica (`github_pat_…a1b2`) para reconhecer qual está gravado.
 */

/**
 * @typedef {"text" | "secret" | "number" | "boolean" | "select" | "url"} FieldType
 * @typedef {{
 *   key: string, label: string, type: FieldType, help?: string,
 *   restart?: boolean, required?: boolean, placeholder?: string,
 *   options?: Array<{ value: string, label: string, disabled?: boolean }>,
 *   min?: number, max?: number,
 *   validate?: (value: string, all: Record<string, string>) => string | null,
 * }} SettingField
 * @typedef {{ id: string, title: string, description: string, fields: SettingField[] }} SettingSection
 */

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const GITHUB_ORG = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const SAFE_DIR = /^[a-z0-9._/-]{0,255}$/i;

const dentroDe = (raiz, alvo) => {
  const relativo = path.relative(path.resolve(raiz), path.resolve(alvo));
  return relativo === "" || (!relativo.startsWith("..") && !path.isAbsolute(relativo));
};

/**
 * Um programa que o painel vai lançar nesta máquina. A tela só aceita o
 * programa esperado (pelo nome do arquivo) e fora das pastas em que o painel
 * grava o que recebe: sem isto, quem configura o painel poderia apontar para
 * um arquivo enviado como material de um cliente e fazê-lo rodar aqui.
 *
 * @param {RegExp} nomes os nomes de arquivo aceitos
 * @param {string} quais como dizer isso à pessoa
 * @param {{ soNome?: boolean }} [opcoes] `soNome`: aceita o nome sem pasta, achado pelo PATH
 */
const programaConhecido = (nomes, quais, { soNome = false } = {}) => (valor) => {
  if (valor.length > 500) return "Caminho longo demais.";
  if (/["'<>|*?]/.test(valor)) return "Informe só o caminho do programa, sem aspas nem argumentos.";
  // Uma pasta compartilhada na rede é de quem a compartilha, não desta máquina.
  if (/^[\\/]{2}/.test(valor)) return "Use um programa instalado nesta máquina, não um caminho de rede.";
  const nome = valor.split(/[\\/]/).pop() ?? "";
  if (!nomes.test(nome)) return `Informe o caminho de ${quais}.`;
  if (nome === valor) return soNome ? null : `Informe o caminho completo de ${quais}.`;
  if (!path.isAbsolute(valor)) return "Use o caminho completo, a partir da raiz do disco.";
  if (dentroDe(config.projectRoot, valor) || dentroDe(config.dataDir, valor)) {
    return "O programa não pode ficar dentro das pastas do painel.";
  }
  return null;
};

/** O Claude Code. Um script (`.mjs`, o claude falso dos testes) só entra pelo ambiente, nunca pela tela. */
const CLAUDE_CODE = /^claude(\.exe)?$/i;
/** Os navegadores que o motor sabe usar nas capturas (Chrome, Edge e Chromium). */
const NAVEGADOR = /^(chrome|msedge|chromium|chromium-browser|google-chrome(-stable)?|microsoft-edge(-stable)?|Google Chrome|Microsoft Edge|Chromium)(\.exe)?$/i;

const urlHttps = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? null : "Use um endereço https://.";
  } catch {
    return "Endereço inválido.";
  }
};

/** @type {SettingSection[]} */
export const SETTINGS_SCHEMA = [
  {
    id: "drive",
    title: "Google Drive",
    description: "De onde vêm as coletas dos clientes. A chave da service account fica num arquivo; aqui vai só o caminho dele.",
    fields: [
      {
        key: "DRIVE_ROOT_FOLDER_ID",
        label: "ID da pasta raiz das coletas",
        type: "text",
        required: true,
        restart: true,
        help: "O trecho depois de /folders/ no endereço da pasta no Drive.",
        validate: (v) => (DRIVE_ID.test(v) ? null : "ID de pasta do Drive inválido."),
      },
      {
        key: "GOOGLE_CREDENTIALS_PATH",
        label: "Arquivo da service account",
        type: "text",
        restart: true,
        help: "Caminho do .json da chave, relativo à raiz do projeto ou absoluto. Nunca versione esse arquivo.",
        validate: (v) => (v.length <= 500 ? null : "Caminho longo demais."),
      },
      {
        key: "CACHE_TTL_MS",
        label: "Cache das respostas do Drive (ms)",
        type: "number",
        restart: true,
        min: 0,
        max: 3_600_000,
        placeholder: "60000",
      },
    ],
  },
  {
    id: "generation",
    title: "Geração de sites",
    description:
      "Os motores que criam os sites e os limites do envio ao Lovable. Cada geração escolhe o motor na própria tela; aqui fica qual vem marcado.",
    fields: [
      {
        key: "GENERATION_ENGINE",
        label: "Motor que vem marcado",
        type: "select",
        options: [
          { value: "lovable", label: "Lovable" },
          { value: "claude", label: "Claude" },
        ],
        help: "Só a escolha inicial da tela de geração: quem gera pode trocar o motor a cada site. Vazio, vem o Lovable.",
      },
      {
        key: "LOVABLE_ENABLE_GENERATION",
        label: "Liberar gasto de crédito no Lovable",
        type: "boolean",
        restart: true,
        help: "Desligado, o painel monta e confere o envio, mas nunca cria o projeto — a única chamada que debita crédito.",
      },
      {
        key: "LOVABLE_MAX_ATTACHMENTS",
        label: "Máximo de anexos por envio",
        type: "number",
        restart: true,
        min: 1,
        max: 100,
        placeholder: "20",
      },
      {
        key: "LOVABLE_MAX_ATTACHMENT_BYTES",
        label: "Tamanho máximo por anexo (bytes)",
        type: "number",
        restart: true,
        min: 1024,
        max: 1024 * 1024 * 1024,
        placeholder: "67108864",
      },
      {
        key: "PIXABAY_API_KEY",
        label: "Chave da API do Pixabay",
        type: "secret",
        help: "Libera a busca de imagens de banco na tela de geração. Sai de pixabay.com/api/docs (logado), no topo da página. Uso comercial livre, sem atribuição.",
        validate: (v) => (/^[A-Za-z0-9-]{10,100}$/.test(v) ? null : "A chave do Pixabay tem só letras, números e hífen."),
      },
    ],
  },
  {
    id: "claude",
    title: "Motor Claude",
    description:
      "O Claude Code desta máquina escreve o briefing e o site, pelo login da assinatura, e o site passa por rodadas de crítica e refino antes de ser entregue. O painel prepara a pasta de trabalho, enfileira e acompanha cada execução e envia o site entregue ao GitHub.",
    fields: [
      {
        key: "CLAUDE_ENABLE_GENERATION",
        label: "Liberar o uso do Claude",
        type: "boolean",
        help: "Desligado, o painel monta e confere o pedido e mostra o comando, mas nunca dispara o Claude Code. Ligado, cada briefing, site, crítica, refino, ajuste e teste consome a assinatura do Claude Code.",
      },
      {
        key: "CLAUDE_MODEL",
        label: "Modelo",
        type: "text",
        placeholder: "o que o motor espera",
        help: "O modelo que escreve os briefings e os sites. Vazio usa o que o motor espera, mostrado no estado acima. É o padrão de todos os projetos; cada um pode escolher outro na hora de gerar.",
        validate: (v) => (MODELO_VALIDO.test(v) ? null : MODELO_INVALIDO),
      },
      {
        key: "CLAUDE_REASONING_EFFORT",
        label: "Esforço de raciocínio",
        type: "select",
        options: [
          { value: "", label: "O que o motor espera" },
          ...ESFORCOS.map((nivel) => ({ value: nivel, label: `${EFFORT_LABELS[nivel]} (${nivel})` })),
        ],
        help: "Quanto o modelo pensa antes de escrever. Mais esforço dá um site mais bem resolvido; cada execução demora mais e consome mais da assinatura. É o padrão de todos os projetos; cada um pode escolher outro na hora de gerar.",
      },
      {
        key: "CLAUDE_REVIEW_ROUNDS",
        label: "Rodadas de crítica e refino",
        type: "select",
        options: [
          { value: "", label: "Padrão do motor" },
          { value: "1", label: "1 rodada" },
          { value: "2", label: "2 rodadas" },
          { value: "3", label: "3 rodadas" },
          { value: "4", label: "4 rodadas" },
        ],
        help: "Depois de gerado, o site é criticado por outra sessão do Claude, que não o escreveu, e refinado por quem o escreveu com o que a crítica apontou. Cada rodada são duas execuções a mais; a sequência termina antes se a crítica aprovar o site. É o padrão de todos os projetos; cada site pode escolher outro número na revisão do briefing.",
      },
      {
        key: "CLAUDE_PARALLEL_SITES",
        label: "Sites criados ao mesmo tempo",
        type: "select",
        options: [
          { value: "", label: "Padrão (3 sites)" },
          { value: "1", label: "1 site" },
          { value: "2", label: "2 sites" },
          { value: "3", label: "3 sites" },
        ],
        help: "Quantos sites passam pela criação (briefing, geração, crítica e refino) ao mesmo tempo. Cada site segue as próprias etapas sem esperar os outros: o passo seguinte de um site em andamento passa à frente de um site novo na fila. Sites que nascem juntos não se comparam entre si, só com os já entregues. Mais execuções juntas consomem a assinatura mais depressa e pesam mais nesta máquina.",
      },
      {
        key: "CLAUDE_PARALLEL_ADJUSTMENTS",
        label: "Ajustes ao mesmo tempo",
        type: "select",
        options: [
          { value: "", label: "Padrão (5 ajustes)" },
          { value: "0", label: "Nenhum: tudo em uma fila só" },
          { value: "1", label: "1 ajuste" },
          { value: "2", label: "2 ajustes" },
          { value: "3", label: "3 ajustes" },
          { value: "4", label: "4 ajustes" },
          { value: "5", label: "5 ajustes" },
        ],
        help: "O ajuste de um site já entregue não espera a criação de outros: roda ao lado dela, e até esta quantidade de ajustes roda junta. Nunca há duas execuções no mesmo site. “Nenhum” põe tudo, criação e ajustes, em uma fila só, um de cada vez. Mais execuções juntas consomem a assinatura mais depressa e pesam mais nesta máquina.",
      },
      {
        key: "CLAUDE_ART_DIRECTION",
        label: "Direção de arte",
        type: "select",
        options: [
          { value: "", label: "Padrão do motor" },
          ...ART_DIRECTION_LEVELS.map(({ value, label }) => ({ value, label })),
        ],
        help: "Até onde o visual do site se afasta do convencional: da sóbria, mais contida, à ousada, que arrisca mais. É o padrão de todos os projetos; cada site pode escolher outra na revisão do briefing.",
      },
      {
        key: "CLAUDE_MOTION",
        label: "Movimento",
        type: "select",
        options: [
          { value: "", label: "Padrão do motor" },
          ...MOTION_LEVELS.map(({ value, label }) => ({ value, label })),
        ],
        help: "Quanta animação o site leva: do discreto, só com transições leves, ao cinematográfico, em que o movimento faz parte da apresentação. É o padrão de todos os projetos; cada site pode escolher outro na revisão do briefing.",
      },
      {
        key: "CLAUDE_HUMAN_APPROVAL",
        label: "Escolha da rota criativa",
        type: "select",
        options: [
          { value: "", label: "Padrão do motor" },
          { value: "1", label: "Parar para uma pessoa escolher a rota" },
          { value: "0", label: "Seguir com a rota que o Claude escolher" },
        ],
        help: "Com a parada, a geração espera depois da direção criativa: as rotas propostas aparecem no projeto, e o site só é escrito depois que alguém aprova a direção ou escolhe outra rota.",
      },
      {
        key: "CLAUDE_BIN",
        label: "Programa do Claude Code",
        type: "text",
        placeholder: "claude",
        help: "Vazio usa o claude do PATH. Preencha com o caminho completo se o painel não o encontrar.",
        validate: programaConhecido(CLAUDE_CODE, "claude ou claude.exe", { soNome: true }),
      },
      {
        key: "CLAUDE_BROWSER_PATH",
        label: "Navegador das capturas",
        type: "text",
        placeholder: "automático",
        help: "O Chrome, Edge ou Chromium que fotografa o site. Vazio usa o que estiver instalado no lugar de costume.",
        validate: programaConhecido(NAVEGADOR, "um Chrome, Edge ou Chromium"),
      },
    ],
  },
  {
    id: "assistant",
    title: "Assistente (Gemini)",
    description:
      "Sugestões na tela de geração: resumo do briefing, o que falta, complementos para as observações e termos para o banco de imagens. Usa o nível gratuito do Gemini, só quando alguém pede.",
    fields: [
      {
        key: "GEMINI_API_KEY",
        label: "Chave da API do Gemini",
        type: "secret",
        help: "Sai de aistudio.google.com → Get API key, numa conta gratuita. O painel só usa modelos Flash, só quando alguém clica em Analisar, e guarda cada resposta por 24 h — para a chave continuar no nível gratuito. Vazia, o botão some.",
        // O formato muda com o tempo (as chaves "AIza…" de 39 caracteres
        // deram lugar a tokens maiores, com ponto): só se exige um token sem
        // espaço. O botão Testar é que diz se ela funciona.
        validate: (v) =>
          /^[A-Za-z0-9._~-]{20,200}$/.test(v)
            ? null
            : "A chave tem só letras, números, ponto, hífen e sublinhado (20 a 200 caracteres).",
      },
      {
        key: "GEMINI_MODEL",
        label: "Modelo preferido",
        type: "text",
        placeholder: "automático",
        help: `Vazio: usa ${FREE_TIER_MODELS.join(" e, se faltar cota, ")}; se nenhum responder, o painel procura outro modelo Flash de texto no catálogo da chave. Só modelos Flash são aceitos.`,
        validate: (v) =>
          !/^[a-z0-9.-]{1,60}$/i.test(v)
            ? "Use só o id do modelo (ex.: gemini-2.5-flash)."
            : isFlashModel(v)
              ? null
              : "Para a chave continuar no nível gratuito, só modelos Flash são aceitos.",
      },
    ],
  },
  {
    id: "github",
    title: "GitHub e publicação",
    description: "O token que grava workflows e secrets nos repositórios da organização.",
    fields: [
      {
        key: "GITHUB_TOKEN",
        label: "Token do GitHub",
        type: "secret",
        help: "Fine-grained (github_pat_). Permissões: Metadata leitura; Contents, Workflows, Secrets e Actions leitura e escrita.",
        validate: (v) =>
          v.startsWith("github_pat_") && v.length <= 512
            ? null
            : "Use um fine-grained personal access token (prefixo github_pat_).",
      },
      {
        key: "GITHUB_ORG",
        label: "Organização",
        type: "text",
        validate: (v) => (GITHUB_ORG.test(v) ? null : "Use o identificador da organização, sem espaços."),
      },
      {
        key: "DEFAULT_FTP_HOST",
        label: "Servidor FTP padrão",
        type: "text",
        help: "Pré-preenche o servidor em repositórios novos.",
        validate: (v) => (HOST_PATTERN.test(v.toLowerCase()) ? null : "Informe só o host, sem ftp:// ou caminho."),
      },
    ],
  },
  {
    id: "dev-area",
    title: "Área de aprovação",
    description: "O domínio em que cada site é publicado numa pasta para o cliente aprovar.",
    fields: [
      { key: "DEV_AREA_URL", label: "Endereço da área", type: "url", placeholder: "https://aprovacao.exemplo.com.br", validate: urlHttps },
      {
        key: "DEV_AREA_FTP_SERVER",
        label: "Servidor FTP",
        type: "text",
        validate: (v) => (HOST_PATTERN.test(v.toLowerCase()) ? null : "Informe só o host."),
      },
      { key: "DEV_AREA_FTP_LOGIN", label: "Login FTP", type: "text", validate: (v) => (v.length <= 200 ? null : "Login longo demais.") },
      { key: "DEV_AREA_FTP_PASSWORD", label: "Senha FTP", type: "secret", validate: (v) => (v.length <= 512 ? null : "Senha longa demais.") },
      {
        key: "DEV_AREA_FTP_DIR",
        label: "Pasta do domínio no FTP",
        type: "text",
        help: "Vazio usa domains/<domínio>/public_html. Conta FTP presa ao domínio: /.",
        validate: (v) => (SAFE_DIR.test(v) && !v.includes("..") ? null : "Pasta inválida."),
      },
      {
        key: "DEV_AREA_FTP_PROTOCOL",
        label: "Protocolo",
        type: "select",
        options: [
          { value: "", label: "Automático (exige FTPS)" },
          { value: "ftps", label: "FTPS explícito" },
          { value: "ftps-legacy", label: "FTPS implícito" },
          { value: "ftp", label: "FTP simples (sem criptografia)" },
        ],
      },
      { key: "DEV_AREA_FTP_PORT", label: "Porta FTP", type: "number", min: 1, max: 65535, placeholder: "21" },
      {
        key: "DEV_AREA_WATCH_INTERVAL_MS",
        label: "Varredura de repositórios novos (ms)",
        type: "number",
        restart: true,
        min: 0,
        max: 86_400_000,
        placeholder: "180000",
        help: "0 desliga a publicação automática e deixa só o botão.",
      },
    ],
  },
  {
    id: "shortlinks",
    title: "Encurtador (BetterLinks)",
    description: "Os links curtos dos sites de antes da área de aprovação.",
    fields: [
      { key: "BETTERLINKS_MCP_URL", label: "Endereço do MCP", type: "url", restart: true, validate: urlHttps },
      { key: "BETTERLINKS_MCP_TOKEN", label: "Token do MCP", type: "secret", restart: true, validate: (v) => (v.length <= 512 ? null : "Token longo demais.") },
      { key: "BETTERLINKS_PUBLIC_BASE", label: "Domínio dos links curtos", type: "url", restart: true, help: "Só se for diferente do domínio do MCP.", validate: urlHttps },
      {
        key: "PREVIEW_WATCH_INTERVAL_MS",
        label: "Conferência dos links (ms)",
        type: "number",
        restart: true,
        min: 0,
        max: 86_400_000,
        placeholder: "1800000",
      },
    ],
  },
  {
    id: "network",
    title: "Rede e acesso",
    description: "Quem alcança o painel. Mudanças aqui valem depois de reiniciar, menos a chave do painel.",
    fields: [
      {
        key: "PANEL_ACCESS_TOKEN",
        label: "Chave do administrador",
        type: "secret",
        help: "Trocar encerra as sessões abertas com a chave antiga — inclusive a sua.",
        validate: (v) => (v.length >= 16 && v.length <= 256 ? null : "Use de 16 a 256 caracteres."),
      },
      {
        key: "SERVER_HOST",
        label: "Interface de escuta",
        type: "text",
        restart: true,
        placeholder: "127.0.0.1",
        help: "127.0.0.1 só esta máquina; 0.0.0.0 a rede local (exige a chave do administrador).",
        validate: (v, all) => {
          const host = v.toLowerCase();
          if (host !== "0.0.0.0" && host !== "localhost" && !isLocalNetworkAddress(host)) {
            return "Use loopback, 0.0.0.0 ou um IP privado da rede local.";
          }
          if (host !== "127.0.0.1" && host !== "localhost" && !all.PANEL_ACCESS_TOKEN) {
            return "Abrir para a rede exige a chave do administrador definida.";
          }
          return null;
        },
      },
      { key: "PORT", label: "Porta", type: "number", restart: true, min: 1, max: 65535, placeholder: "3333" },
      {
        key: "LAN_ALLOWED_HOSTS",
        label: "Hostnames internos extras",
        type: "text",
        restart: true,
        help: "Separados por vírgula. IPs privados, localhost e .local já são aceitos.",
        validate: (v) =>
          v.split(",").map((h) => h.trim()).filter(Boolean).every((h) => HOST_PATTERN.test(h.toLowerCase()))
            ? null
            : "Hostname inválido na lista.",
      },
    ],
  },
];

/** Todas as chaves, por nome. */
export const SETTING_FIELDS = new Map(
  SETTINGS_SCHEMA.flatMap((section) => section.fields.map((field) => [field.key, field])),
);
