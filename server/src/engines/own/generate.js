import { SYSTEM_PROMPT } from "./prompt.js";
import { runTool, TOOLS } from "./tools.js";

/**
 * O laço que constrói um site com o modelo: o modelo pede ferramentas de
 * arquivo, o painel executa no espaço de trabalho em memória e devolve o
 * resultado, até o modelo terminar.
 *
 * AINDA NÃO LIGADO: nenhuma rota chama esta função. O motor próprio só fica
 * disponível quando o resto do caminho (modelo de projeto, commit no GitHub,
 * registro da geração) estiver pronto — ver `engines/own/index.js`.
 *
 * Forma da chamada (SDK oficial, `@anthropic-ai/sdk`):
 * - streaming (`messages.stream` + `finalMessage()`): a geração é longa e
 *   `max_tokens` alto estouraria o tempo de uma requisição comum;
 * - adaptive thinking, com o esforço configurável;
 * - ferramentas com `eager_input_streaming`, e por isso cada entrada é
 *   conferida antes de executar (`runTool` → `inputProblem`);
 * - `max_tokens` com ferramenta pendente e `refusal` param o laço — a entrada
 *   cortada não é executada;
 * - cache automático do prompt de sistema e das ferramentas, que não mudam;
 * - nos modelos Opus 5 e Fable 5.1, o fallback do servidor
 *   (`fallbacks: "default"`) repete o pedido em outro modelo quando o
 *   primeiro recusa por política.
 */

export class OwnGenerationError extends Error {}

/** Modelos em que o fallback do servidor é recomendado por padrão. */
const WITH_FALLBACKS = new Set(["claude-opus-5", "claude-fable-5-1"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * @param {{
 *   client: any, Anthropic: any, model: string,
 *   workspace: import("./workspace.js").Workspace,
 *   userPrompt: string,
 *   effort?: "low" | "medium" | "high" | "xhigh" | "max",
 *   maxTurns?: number,
 *   onProgress?: (event: { turn: number, tool?: string, path?: string, text?: string }) => void,
 * }} params
 * @returns {Promise<{ summary: string, touched: string[], turns: number,
 *   usage: { input: number, output: number, cacheRead: number } }>}
 */
export async function runOwnGeneration({
  client,
  Anthropic,
  model,
  workspace,
  userPrompt,
  effort = "xhigh",
  maxTurns = 80,
  onProgress = () => {},
}) {
  /** @type {any[]} */
  const messages = [{ role: "user", content: userPrompt }];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const comFallback = WITH_FALLBACKS.has(model);
  let tentativasJson = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const params = {
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      ...(comFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
    };
    const stream = comFallback ? client.beta.messages.stream(params) : client.messages.stream(params);
    stream.on("text", (text) => onProgress({ turn, text }));

    let message;
    try {
      message = await stream.finalMessage();
      tentativasJson = 0;
    } catch (err) {
      // Só a entrada de ferramenta que não virou JSON é repetida; erro da API
      // sobe para quem chamou.
      if (err instanceof Anthropic.APIError || tentativasJson >= 2) throw err;
      tentativasJson += 1;
      continue;
    }

    usage.input += message.usage?.input_tokens ?? 0;
    usage.output += message.usage?.output_tokens ?? 0;
    usage.cacheRead += message.usage?.cache_read_input_tokens ?? 0;

    if (message.stop_reason === "refusal") {
      throw new OwnGenerationError(
        `O modelo recusou o pedido${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}.`,
      );
    }

    const pedidos = message.content.filter((block) => block.type === "tool_use");

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "max_tokens" && pedidos.length) {
      throw new OwnGenerationError("A resposta passou do limite no meio de um arquivo.");
    }
    if (message.stop_reason !== "tool_use" || pedidos.length === 0) {
      const summary = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { summary, touched: [...workspace.touched].sort(), turns: turn, usage };
    }

    messages.push({ role: "assistant", content: message.content });
    // Todas as respostas de ferramenta numa mensagem só: separar ensina o
    // modelo a parar de pedir várias de uma vez.
    const resultados = pedidos.map((pedido) => {
      const { content, isError } = runTool(workspace, pedido.name, pedido.input);
      onProgress({ turn, tool: pedido.name, path: pedido.input?.path });
      return {
        type: "tool_result",
        tool_use_id: pedido.id,
        content,
        ...(isError ? { is_error: true } : {}),
      };
    });
    messages.push({ role: "user", content: resultados });
  }

  throw new OwnGenerationError(`O modelo não terminou em ${maxTurns} rodadas.`);
}
