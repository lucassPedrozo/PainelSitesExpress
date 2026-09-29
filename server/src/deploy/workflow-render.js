/** Scripts embutidos nos blocos `run: |`, indexados pelo placeholder do YAML. */

const scriptPlaceholderPattern = /^([ \t]*)(__[A-Z_]+__)[ \t]*$/gm;

// Os scripts vivem em arquivos .sh para poderem ser lintados e testados; aqui
// eles são embutidos no YAML respeitando a indentação do bloco.
const indentScript = (script, indent) =>
  script
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.trim() ? `${indent}${line}` : ""))
    .join("\n");

/**
 * Se o workflow de deploy publica a cada push. É o que o formulário mostra
 * para um repositório configurado em outro navegador — sem isto, ele abria
 * com o gatilho desligado, e salvar desligava a publicação automática.
 *
 * @param {string} content conteúdo do Deploy-via-FTP.yml
 */
export const readAutoDeploy = (content) => /^ {2}push:\s*$/m.test(content);

const renderAutoDeployTrigger = (branch, autoDeploy) =>
  autoDeploy ? `\n  push:\n    branches:\n      - ${branch}\n\n` : "\n";

/**
 * Valores que entram no meio do YAML — a pasta e o endereço da área de
 * desenvolvimento. Só passam os caracteres de um caminho ou URL simples: nada
 * de aspas, espaço, `$` ou quebra de linha que mudasse o sentido do workflow.
 */
const safeValuePattern = /^[a-z0-9._:/-]+$/i;

export const renderWorkflow = (template, scripts, options) => {
  let rendered = template
    .replace(/\r\n/g, "\n")
    .replace(
      "__AUTO_DEPLOY_TRIGGER__\n",
      renderAutoDeployTrigger(options.branch, options.autoDeploy ?? false),
    )
    .replaceAll("__DEFAULT_BRANCH__", options.branch)
    .replace(scriptPlaceholderPattern, (match, indent, placeholder) => {
      const script = scripts[placeholder];
      return script ? indentScript(script, indent) : match;
    });

  for (const [placeholder, value] of Object.entries(options.values ?? {})) {
    if (!safeValuePattern.test(value) || value.includes("..")) {
      throw new Error(`Valor inválido para ${placeholder} no workflow: ${value}`);
    }
    rendered = rendered.replaceAll(placeholder, value);
  }

  const leftover = rendered.match(/__[A-Z_]+__/);
  if (leftover) {
    throw new Error(
      `Template de workflow com placeholder não resolvido: ${leftover[0]}`,
    );
  }

  return rendered;
};

/**
 * Bump a cada mudança relevante nos templates. O painel compara este valor com
 * o marcador gravado no repositório para avisar quando o workflow está velho.
 */
export const WORKFLOW_TEMPLATE_VERSION = "9";

export const readTemplateVersion = (content) =>
  content.match(/^#\s*joinvix-deploy-template:\s*(\S+)\s*$/m)?.[1] ?? null;
