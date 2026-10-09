/**
 * Os formatos de credencial que o painel reconhece num texto.
 *
 * Usados em dois lugares que não podem divergir: a varredura do repositório
 * antes de publicar (`scripts/verificar-segredos.mjs`) e a conferência do site
 * que o motor Claude gerou, antes de ele ir ao GitHub. Um formato acrescentado
 * aqui vale nos dois.
 *
 * Formatos estritos: os valores de teste do projeto (github_pat_teste…,
 * sk-ant-api03-abc…) são curtos demais para casar.
 *
 * @type {ReadonlyArray<readonly [RegExp, string]>}
 */
export const CREDENTIAL_FORMATS = Object.freeze([
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g, "token clássico do GitHub"],
  [/\bgithub_pat_[A-Za-z0-9_]{70,}/g, "token fine-grained do GitHub"],
  [/\bsk-ant-[a-z0-9]+-[A-Za-z0-9_-]{80,}/g, "chave da Anthropic"],
  [/\bsk-(proj-)?[A-Za-z0-9]{40,}/g, "chave da OpenAI"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "chave de API do Google"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "chave da AWS"],
  [/\bxox[baprs]-[0-9A-Za-z-]{20,}/g, "token do Slack"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "chave privada PEM"],
  [/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{20,}/g, "JWT completo"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`${}]+:[^\s/@'"`${}]{6,}@[^\s/'"`]+/gi, "senha embutida em URL"],
  [/[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/gi, "e-mail de service account"],
]);
