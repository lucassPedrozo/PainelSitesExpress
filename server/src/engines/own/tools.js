import { WorkspaceError } from "./workspace.js";

/**
 * As ferramentas com que o modelo constrói o site: listar, ler, escrever e
 * apagar arquivos do espaço de trabalho. Nada roda na máquina do painel — o
 * espaço é memória, e o build acontece depois, no GitHub.
 *
 * `eager_input_streaming`: o conteúdo de um arquivo é grande, e assim ele
 * chega enquanto é gerado. A contrapartida é que a API deixa de validar a
 * entrada, então cada uma é conferida aqui antes de executar.
 */

/** Definições no formato da API de mensagens. */
export const TOOLS = [
  {
    name: "list_files",
    description: "Lista os caminhos de todos os arquivos do projeto.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_file",
    description: "Lê um arquivo do projeto, inclusive os de configuração.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Caminho relativo, ex.: src/App.tsx" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Cria ou substitui um arquivo inteiro. Só em src/, public/ ou index.html; a configuração do projeto não muda.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho relativo, ex.: src/components/Hero.tsx" },
        contents: { type: "string", description: "O conteúdo completo do arquivo." },
      },
      required: ["path", "contents"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_file",
    description: "Apaga um arquivo de src/ ou public/ que deixou de ser usado.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

const campos = {
  list_files: [],
  read_file: ["path"],
  write_file: ["path", "contents"],
  delete_file: ["path"],
};

/**
 * Confere a entrada de uma ferramenta: o parser tolerante do SDK pode entregar
 * um objeto truncado sem erro quando a entrada chega por streaming.
 *
 * @returns {string | null} o problema, ou `null` se a entrada serve
 */
export function inputProblem(name, input) {
  const esperados = campos[name];
  if (!esperados) return `Ferramenta desconhecida: ${name}`;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Entrada inválida.";
  for (const campo of esperados) {
    if (typeof input[campo] !== "string") return `Campo "${campo}" ausente ou não é texto.`;
  }
  const sobrando = Object.keys(input).filter((chave) => !esperados.includes(chave));
  return sobrando.length ? `Campos inesperados: ${sobrando.join(", ")}` : null;
}

/**
 * Executa uma ferramenta no espaço de trabalho.
 *
 * @param {import("./workspace.js").Workspace} workspace
 * @returns {{ content: string, isError: boolean }}
 */
export function runTool(workspace, name, input) {
  const problema = inputProblem(name, input);
  if (problema) return { content: problema, isError: true };
  try {
    switch (name) {
      case "list_files":
        return { content: workspace.list().join("\n"), isError: false };
      case "read_file":
        return { content: workspace.read(input.path), isError: false };
      case "write_file": {
        const { path, bytes } = workspace.write(input.path, input.contents);
        return { content: `Gravado ${path} (${bytes} bytes).`, isError: false };
      }
      case "delete_file":
        return { content: `Apagado ${workspace.remove(input.path).path}.`, isError: false };
      default:
        return { content: `Ferramenta desconhecida: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof WorkspaceError) return { content: err.message, isError: true };
    throw err;
  }
}
