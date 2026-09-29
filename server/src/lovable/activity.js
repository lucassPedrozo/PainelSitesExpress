/**
 * O que o agente do Lovable está fazendo agora, lido das mensagens.
 *
 * Depois do "Gerar", o card dizia só "Gerando no Lovable" — sem tempo, sem
 * sinal de avanço, e a única forma de saber se faltava pouco era abrir o
 * editor. A resposta do agente, porém, traz cada ferramenta que ele usa
 * (`<lov-tool-use name="code--apply_patch" data="{...}">`): o arquivo que está
 * criando, o comando que roda. É isso que o painel mostra, com a contagem de
 * ações e de arquivos escritos. `list_messages` é gratuita.
 *
 * Tempo restante não: medindo as gerações da organização, a primeira
 * construção levou de 3 a 158 minutos (as pausas esperando alguém entram na
 * conta), e uma estimativa assim enganaria. O que diz se falta pouco é a fase
 * — um site passa sempre por planejar, escrever, conferir o build e responder.
 */

/**
 * As fases de uma construção, na ordem. A fase só avança: uma leitura de
 * arquivo depois de escrever não volta o trabalho para o planejamento.
 */
export const AGENT_PHASES = ["planning", "writing", "checking", "answering"];

// Atributo a atributo, com o valor entre aspas: o `data` de um patch traz `>`
// (`=>`, `<div>`), e parar no primeiro `>` cortava a tag no meio.
const TOOL_USE = /<lov-tool-use\b((?:\s+[\w-]+="(?:[^"\\]|\\.)*")*)\s*\/?>/g;
const attr = (attrs, name) => {
  const match = attrs.match(new RegExp(`\\b${name}="((?:[^"\\\\]|\\\\.)*)"`));
  return match ? match[1] : null;
};

/**
 * O `data` vem como JSON com as aspas escapadas dentro do atributo. Quando o
 * JSON não fecha (mensagem ainda sendo escrita), os campos que interessam são
 * lidos direto do texto.
 *
 * @param {string | null} raw
 * @returns {Record<string, unknown>}
 */
function parseData(raw) {
  if (!raw) return {};
  const texto = raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  try {
    const valor = JSON.parse(texto);
    return valor && typeof valor === "object" ? valor : {};
  } catch {
    const campo = (nome) => texto.match(new RegExp(`"${nome}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1];
    return {
      file_path: campo("file_path"),
      user_facing_description: campo("user_facing_description"),
      patch: texto,
    };
  }
}

/** Os arquivos de um patch: `*** Add File: src/x.tsx`, `*** Update File: ...`. */
const patchFiles = (patch) =>
  [...String(patch ?? "").matchAll(/\*\*\* (Add|Update|Delete) File: ([^\n\\]+)/g)].map(
    (match) => ({ action: match[1], path: match[2].trim() }),
  );

const shortPath = (path) => String(path ?? "").replace(/^user-uploads:\/\//, "anexo ");

/**
 * Ferramentas sem arquivo nem comando: a frase é fixa. Nomes conferidos nas
 * mensagens dos projetos da organização.
 */
const FIXED = {
  "lov-think": "Planejando o próximo passo",
  "user_messaging--message_user": "Escrevendo a resposta",
  "plan--show": "Apresentando o plano",
  "questions--ask_questions": "Fazendo perguntas",
  "document--parse_document": "Lendo um documento anexo",
  "vision--describe_image": "Analisando uma imagem",
  "design--create_directions": "Criando direções de design",
  "imagegen--generate_image": "Gerando uma imagem",
  "imagegen--edit_image": "Editando uma imagem",
  "acp_subagent--spawn_agent": "Delegando uma tarefa a um subagente",
  "acp_subagent--get_agent_result": "Recebendo o resultado do subagente",
  "code--read_console_logs": "Conferindo o console do site",
  "code--read_runtime_errors": "Conferindo erros do site",
  "code--execute_preview_javascript": "Testando o site no preview",
  tool_search: "Escolhendo as ferramentas",
};

/** Ferramentas que gravam arquivos — as que contam como "arquivos escritos". */
const WRITES = /apply_patch|--write$|line_replace|--rename$|--delete$/;

/** Os arquivos que a ferramenta gravou. */
export function writtenFiles(name, data) {
  if (!WRITES.test(name)) return [];
  const doPatch = patchFiles(data.patch);
  if (doPatch.length) return doPatch;
  return typeof data.file_path === "string" ? [{ action: "Update", path: data.file_path }] : [];
}

/**
 * Uma frase para a ferramenta, em português.
 *
 * @param {string} name
 * @param {Record<string, unknown>} data
 */
export function describeTool(name, data) {
  if (FIXED[name]) return FIXED[name];
  const arquivo = typeof data.file_path === "string" ? shortPath(data.file_path) : null;
  const descricao =
    typeof data.user_facing_description === "string" ? data.user_facing_description : null;

  if (WRITES.test(name)) {
    const [primeiro] = writtenFiles(name, data);
    if (primeiro) {
      const verbo = { Add: "Criando", Update: "Editando", Delete: "Removendo" }[primeiro.action];
      return `${verbo} ${shortPath(primeiro.path)}`;
    }
    return "Editando o código";
  }
  if (name.startsWith("comments--")) return "Respondendo comentários no projeto";
  if (/--(view|read|search_files|list)/.test(name)) return arquivo ? `Lendo ${arquivo}` : "Lendo o código";
  if (/--exec$/.test(name)) return descricao ?? "Executando um comando";
  if (/image/.test(name)) return "Trabalhando numa imagem";
  if (/search|fetch|web/.test(name)) return "Pesquisando";
  return descricao ?? "Trabalhando";
}

/**
 * A atividade do trabalho em curso: da mensagem mais recente do usuário (o
 * pedido que o agente está atendendo) em diante.
 *
 * @param {Array<{ role?: string, content?: string, created_at?: string }>} messages
 *   da mais recente para a mais antiga, como o `list_messages` devolve
 * @returns {{ startedAt: string | null, steps: number, filesWritten: number,
 *   current: string | null, phase: typeof AGENT_PHASES[number] } | null}
 */
export function agentActivityFrom(messages) {
  const lista = Array.isArray(messages) ? messages : [];
  const indicePedido = lista.findIndex((message) => message.role === "user");
  const pedido = indicePedido >= 0 ? lista[indicePedido] : null;
  const respostas = (indicePedido >= 0 ? lista.slice(0, indicePedido) : lista).filter(
    (message) => message.role === "assistant",
  );

  let steps = 0;
  let current = null;
  let fase = 0;
  const arquivos = new Set();
  // Da resposta mais antiga para a mais nova, para a última ação ser a atual.
  for (const resposta of [...respostas].reverse()) {
    for (const [, attrs] of String(resposta.content ?? "").matchAll(TOOL_USE)) {
      const name = attr(attrs, "name") ?? "";
      const data = parseData(attr(attrs, "data"));
      steps += 1;
      const gravados = writtenFiles(name, data);
      for (const { path } of gravados) arquivos.add(path);
      // O agente pensa entre uma ação e outra: mostrar "Planejando" a cada
      // pausa escondia o que ele de fato está fazendo.
      if (name !== "lov-think" || current === null) current = describeTool(name, data);
      fase = Math.max(fase, phaseOf(name, gravados.length > 0, arquivos.size > 0));
    }
  }

  if (!pedido && steps === 0) return null;
  return {
    startedAt: pedido?.created_at ?? null,
    steps,
    filesWritten: arquivos.size,
    current,
    phase: AGENT_PHASES[fase],
  };
}

/**
 * A fase a que uma ferramenta leva o trabalho (índice em `AGENT_PHASES`).
 *
 * @param {string} name
 * @param {boolean} wrote a ferramenta gravou arquivo
 * @param {boolean} hasWritten algum arquivo já foi escrito neste trabalho
 */
function phaseOf(name, wrote, hasWritten) {
  if (name === "user_messaging--message_user" && hasWritten) return 3;
  if (wrote || name.startsWith("imagegen--")) return 1;
  // Rodar o build, ler o console, testar o preview: depois de escrever, é a
  // conferência.
  if (hasWritten && /--exec$|read_console|runtime_errors|execute_preview/.test(name)) return 2;
  return 0;
}
