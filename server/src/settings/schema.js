import { isLocalNetworkAddress } from "../security/network.js";
import { hostPattern } from "../deploy/input.js";
import { AI_PROVIDERS } from "../ai/providers.js";

/**
 * Todas as chaves do `.env` que a tela de configuração edita, com o que a tela
 * precisa saber de cada uma: seção, tipo, validação, se é segredo e se o valor
 * novo só vale depois de reiniciar o painel.
 *
 * `restart: true` são as que `config.js` lê uma vez, na subida (`config`); as
 * demais são relidas a cada uso (`runtimeConfig`, `devAreaConfig`, `aiConfig`)
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
    description: "Qual motor cria os sites e os limites do envio. Hoje só o Lovable gera; o motor próprio está em preparação.",
    fields: [
      {
        key: "GENERATION_ENGINE",
        label: "Motor de geração",
        type: "select",
        options: [
          { value: "lovable", label: "Lovable" },
          { value: "own", label: "Lovable próprio (em preparação)", disabled: true },
        ],
        help: "O motor próprio usa o modelo de IA configurado abaixo. Ele fica disponível quando a geração dele for liberada.",
        // Enquanto o motor próprio não gera, gravar "own" deixaria o painel
        // dizendo uma coisa e fazendo outra.
        validate: (v) => (v === "" || v === "lovable" ? null : "O motor próprio ainda não está disponível."),
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
    ],
  },
  {
    id: "ai",
    title: "Modelo de IA",
    description: "A chave de API do modelo que o motor próprio vai usar. Guardar e testar a chave não gera nada nem muda o que já funciona.",
    fields: [
      {
        key: "AI_PROVIDER",
        label: "Provedor",
        type: "select",
        options: Object.values(AI_PROVIDERS).map((p) => ({ value: p.id, label: p.label })),
        validate: (v) => (v === "" || AI_PROVIDERS[v] ? null : "Provedor desconhecido."),
      },
      {
        key: "AI_API_KEY",
        label: "Chave de API",
        type: "secret",
        help: "Guardada só no .env desta máquina. O botão Testar confere a chave listando os modelos — sem custo.",
        validate: (v, all) => {
          const provedor = AI_PROVIDERS[all.AI_PROVIDER || "anthropic"];
          if (v.length > 512) return "Chave longa demais.";
          return provedor?.keyPattern && !provedor.keyPattern.test(v)
            ? `A chave não tem o formato de uma chave ${provedor.label} (${provedor.keyHint}).`
            : null;
        },
      },
      {
        key: "AI_MODEL",
        label: "Modelo",
        type: "select",
        options: Object.values(AI_PROVIDERS).flatMap((p) =>
          p.models.map((m) => ({ value: m.id, label: `${m.label} — ${p.label}` })),
        ),
        help: "O padrão é o mais capaz para gerar código. O custo por site depende do modelo.",
        validate: (v) =>
          v === "" || Object.values(AI_PROVIDERS).some((p) => p.models.some((m) => m.id === v))
            ? null
            : "Modelo desconhecido.",
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
        validate: (v) => (hostPattern.test(v.toLowerCase()) ? null : "Informe só o host, sem ftp:// ou caminho."),
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
        validate: (v) => (hostPattern.test(v.toLowerCase()) ? null : "Informe só o host."),
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
          v.split(",").map((h) => h.trim()).filter(Boolean).every((h) => hostPattern.test(h.toLowerCase()))
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
