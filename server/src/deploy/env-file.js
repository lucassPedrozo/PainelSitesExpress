/**
 * Escrita do arquivo `.env` (quem lê é o `dotenv`, em `config.js`). São funções
 * puras de texto: quem toca no disco são `settings/service.js` e
 * `deploy/settings.js`, e assim tudo aqui é testável sem efeito colateral.
 */

// Valores simples ficam sem aspas para o arquivo continuar legível; só o que
// poderia ser reinterpretado na releitura é escapado.
const formatValue = (value) =>
  /^[A-Za-z0-9_@./:+-]*$/.test(value)
    ? value
    : `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const matchesKey = (line, key) =>
  new RegExp(`^\\s*(export\\s+)?${key}\\s*=`, "i").test(
    line.replace(/^\uFEFF/, ""),
  );

/**
 * Atualiza chaves preservando comentários, ordem e as demais variáveis.
 * Chaves ausentes são acrescentadas no fim.
 */
export const upsertEnvFile = (content, updates) => {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const pending = new Map(Object.entries(updates));

  const rewritten = lines.map((line) => {
    for (const [key, value] of pending) {
      if (matchesKey(line, key)) {
        pending.delete(key);
        return `${key}=${formatValue(value)}`;
      }
    }
    return line;
  });

  while (rewritten.length > 0 && rewritten[rewritten.length - 1].trim() === "") {
    rewritten.pop();
  }

  if (pending.size > 0) {
    if (rewritten.length > 0) rewritten.push("");
    for (const [key, value] of pending) {
      rewritten.push(`${key}=${formatValue(value)}`);
    }
  }

  return `${rewritten.join("\n")}\n`;
};

/** Dica exibida na interface no lugar do segredo: `github_pat_…a1b2`. */
export const maskSecret = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••";

  const prefix = trimmed.startsWith("github_pat_")
    ? "github_pat_"
    : trimmed.slice(0, 4);
  return `${prefix}…${trimmed.slice(-4)}`;
};
