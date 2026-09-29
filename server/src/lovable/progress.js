import { config } from "../config.js";
import { httpError } from "../http.js";
import { generationGate } from "./package.js";
import { listGenerations, setGenerationAgent } from "../store/generations.js";
import { agentActivityFrom } from "./activity.js";
import { extractAgentText } from "./agent-text.js";
import { callTool } from "./mcp.js";
import { listSignatureFiles } from "./signature.js";
import { extractStyleLine, registerStyle } from "./style-registry.js";
import { uploadSignature } from "./upload.js";

/**
 * Acompanha o agente do Lovable depois do "Gerar".
 *
 * O create_project volta assim que o projeto nasce; o site ainda vai ser
 * construído. Para saber se ele começou, terminou ou parou esperando alguém,
 * era preciso abrir o Lovable. Aqui o painel pergunta sozinho — `get_project`
 * e `list_messages` são gratuitas — e grava o estado na geração, que o card
 * mostra. Ao terminar, registra a linha "Já usado" na Workspace Knowledge.
 */

/** Enquanto trabalha, confere a cada 20 s; parado, a cada minuto. */
const RUNNING_INTERVAL_MS = 20_000;
const AWAITING_INTERVAL_MS = 60_000;
/** Depois disso, desiste: algo deu errado ou alguém assumiu no editor. */
const GIVE_UP_MS = 3 * 60 * 60_000;

const watching = new Set();

/**
 * O que interessa do `get_project`. A resposta tem dois níveis: o de cima
 * (nome, commit, `latest_screenshot_url`) e um `project` aninhado, onde ficam
 * `agentFinished` e `screenshotUrl`. Ler só o de cima deixava todo site
 * "trabalhando" até o acompanhamento desistir.
 *
 * @param {any} raw
 * @returns {{ agentFinished: boolean, screenshotUrl: string | null, name: string | null }}
 */
export function readProject(raw) {
  const aninhado = raw?.project ?? {};
  return {
    agentFinished: Boolean(aninhado.agentFinished ?? raw?.agentFinished),
    screenshotUrl: aninhado.screenshotUrl ?? raw?.latest_screenshot_url ?? null,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : null,
  };
}

/**
 * O estado do agente a partir do que o Lovable devolve.
 *
 * `agentFinished` é falso tanto trabalhando quanto parado; a diferença está
 * nas mensagens, onde a pausa aparece como `awaiting_input`.
 *
 * @param {{ agentFinished?: boolean } | null | undefined} project
 * @param {Array<{ role?: string, status?: string, content?: string, response?: { status?: string } }>} messages
 *   da mais recente para a mais antiga
 */
export function interpretProgress(project, messages) {
  const recentes = messages.slice(0, 3);
  const parado = recentes.some(
    (message) =>
      message.status === "awaiting_input" ||
      message.response?.status === "awaiting_input",
  );
  if (parado) {
    // A pergunta está na mensagem que pausou; se ela não tiver fala, na
    // resposta mais recente do agente.
    const pausa = recentes.find(
      (message) =>
        message.status === "awaiting_input" ||
        message.response?.status === "awaiting_input",
    );
    const resposta = messages.find((message) => message.role === "assistant");
    const question =
      extractAgentText(pausa?.content) ?? extractAgentText(resposta?.content);
    return { state: "awaiting", lastReply: null, question };
  }

  if (!project?.agentFinished) return { state: "running", lastReply: null };
  // A última mensagem é do usuário: o agente ainda não respondeu, mesmo que o
  // projeto diga que terminou (acabou de chegar uma mensagem nova).
  if (messages[0]?.role === "user") return { state: "running", lastReply: null };

  const resposta = messages.find((message) => message.role === "assistant");
  return { state: "done", lastReply: resposta?.content ?? null };
}

/**
 * A assinatura está no código quando o arquivo dela existe: a Knowledge (§8)
 * manda salvar em `src/assets/joinvix-rodape-claro|escuro.*`.
 *
 * @param {string[]} paths
 */
export const hasSignatureAsset = (paths) =>
  paths.some((file) => /^(src|public)\/.*joinvix/i.test(file));

/** A correção pedida ao agente quando a assinatura não veio. */
export const SIGNATURE_FIX_MESSAGE =
  "Adicione a assinatura Joinvix no rodapé, conforme a §8 da Workspace Knowledge. " +
  "Use a imagem anexada que combina com o fundo real do rodapé (o nome diz para qual " +
  "fundo cada uma serve) e salve em src/assets/joinvix-rodape-claro ou " +
  "src/assets/joinvix-rodape-escuro. Mexa só no rodapé.";

/**
 * Confere a assinatura depois que o agente termina e, se faltar, pede uma vez
 * para ele pôr. O pedido é uma mensagem ao agente — gasta crédito, por isso só
 * roda com a geração liberada no `.env` e nunca se repete para o mesmo site.
 * Se ainda assim faltar, o build da publicação insere a assinatura.
 *
 * @returns {Promise<{ found: boolean, fixSent: boolean }>}
 */
async function checkSignature(generation) {
  const listed = await callTool("list_files", { project_id: generation.id });
  const paths = (Array.isArray(listed?.data) ? listed.data : []).map(
    (file) => String(file?.path ?? ""),
  );
  const found = hasSignatureAsset(paths);
  if (found || generation.signatureFixSent || !config.lovable.enableGeneration) {
    return { found, fixSent: generation.signatureFixSent };
  }

  const uploaded = [];
  for (const file of await listSignatureFiles()) {
    uploaded.push(await uploadSignature(file));
  }
  if (uploaded.length === 0) return { found, fixSent: false };

  await callTool("send_message", {
    project_id: generation.id,
    message: SIGNATURE_FIX_MESSAGE,
    wait: false,
    files: uploaded.map((item) => ({
      file_id: item.fileId,
      file_name: item.name,
      mime_type: item.mimeType,
    })),
  });
  console.log(`[lovable] assinatura ausente em ${generation.id}: correção pedida ao agente.`);
  return { found, fixSent: true };
}

async function checkOnce(projectId, generation) {
  const project = readProject(
    await callTool("get_project", { project_id: generation.id }),
  );
  const listed = await callTool("list_messages", { project_id: generation.id });
  const messages = Array.isArray(listed?.messages) ? listed.messages : [];

  let { state, lastReply, question } = interpretProgress(project, messages);
  let styleRegistered = generation.styleRegistered;
  let signatureFound = generation.signatureFound;
  let signatureFixSent = generation.signatureFixSent;

  if (state === "done" && !styleRegistered && generation.workspaceId) {
    // A fala do agente primeiro: a linha costuma vir dentro da ferramenta de
    // mensagem, em JSON escapado.
    const entry = extractStyleLine(extractAgentText(lastReply) ?? lastReply);
    if (entry) {
      try {
        styleRegistered = await registerStyle(generation.workspaceId, entry);
        if (styleRegistered) console.log(`[lovable] "Já usado" registrado: ${entry}`);
      } catch (err) {
        // Sem o escopo de escrita (conexão antiga) ou falha passageira: o site
        // está pronto do mesmo jeito; o registro fica para a próxima conferência.
        console.warn(`[lovable] não registrou o "Já usado": ${err?.message ?? err}`);
      }
    }
  }

  // Depois do registro: a correção vira a resposta mais recente do agente, e a
  // linha "Já usado" está na anterior.
  if (state === "done" && signatureFound !== true) {
    try {
      const assinatura = await checkSignature(generation);
      signatureFound = assinatura.found;
      // Pediu a correção agora: o agente volta a trabalhar e o acompanhamento
      // segue até ele terminar, para conferir de novo.
      if (assinatura.fixSent && !signatureFixSent) state = "running";
      signatureFixSent = assinatura.fixSent;
    } catch (err) {
      console.warn(`[lovable] conferência da assinatura: ${err?.message ?? err}`);
    }
  }

  return setGenerationAgent(projectId, generation.id, {
    agentState: state,
    screenshotUrl: project.screenshotUrl,
    // O "Connect GitHub" do Lovable batiza o repositório com este nome.
    lovableName: project.name,
    styleRegistered,
    signatureFound,
    signatureFixSent,
    agentQuestion: state === "awaiting" ? (question ?? null) : null,
    // Trabalhando ou parado, o card mostra onde o agente está; pronto, some.
    agentActivity: state === "done" ? null : agentActivityFrom(messages),
  });
}

/**
 * Responde ao agente parado, direto do painel. É uma mensagem ao agente —
 * GASTA CRÉDITO —, então passa pela mesma chave do `.env` da geração, e a
 * rota exige confirmação explícita.
 *
 * @param {string} projectId pasta do Drive
 * @param {string} lovableId projeto no Lovable
 * @param {unknown} message
 * @param {{ call?: typeof callTool, gate?: () => { enabled: boolean, reason: string | null }, watch?: typeof watchGeneration }} [deps]
 */
export async function replyToAgent(projectId, lovableId, message, deps = {}) {
  const { call = callTool, gate = generationGate, watch = watchGeneration } = deps;
  const texto = typeof message === "string" ? message.trim() : "";
  if (!texto) throw httpError(400, "Escreva a resposta para o agente");
  if (texto.length > 4000) throw httpError(400, "Resposta longa demais (máx. 4000 caracteres)");

  const liberacao = gate();
  if (!liberacao.enabled) throw httpError(423, liberacao.reason);

  const geracao = ((await listGenerations())[projectId] ?? []).find(
    (item) => item.id === lovableId,
  );
  if (!geracao) throw httpError(404, "Geração não encontrada neste projeto");

  await call("send_message", { project_id: lovableId, message: texto, wait: false });

  const atualizada = await setGenerationAgent(projectId, lovableId, {
    agentState: "running",
    agentQuestion: null,
    // O relógio do card recomeça na resposta: é um trabalho novo.
    agentActivity: {
      startedAt: new Date().toISOString(),
      steps: 0,
      filesWritten: 0,
      current: null,
      phase: "planning",
    },
  });
  watch(projectId, lovableId);
  return atualizada;
}

/**
 * Começa a acompanhar uma geração. Chamar de novo para a mesma é inofensivo.
 */
export function watchGeneration(projectId, lovableId) {
  const key = `${projectId}:${lovableId}`;
  if (watching.has(key)) return;
  watching.add(key);

  const tick = async () => {
    try {
      const lista = (await listGenerations())[projectId] ?? [];
      const generation = lista.find((item) => item.id === lovableId);
      if (!generation) return watching.delete(key);

      const expirou = Date.now() - Date.parse(generation.createdAt) > GIVE_UP_MS;
      const atualizada = await checkOnce(projectId, generation);

      if (atualizada.agentState === "done" || expirou) {
        watching.delete(key);
        return;
      }
      const espera =
        atualizada.agentState === "awaiting"
          ? AWAITING_INTERVAL_MS
          : RUNNING_INTERVAL_MS;
      setTimeout(tick, espera).unref();
    } catch (err) {
      console.warn(`[lovable] acompanhamento de ${lovableId}: ${err?.message ?? err}`);
      setTimeout(tick, AWAITING_INTERVAL_MS).unref();
    }
  };

  setTimeout(tick, RUNNING_INTERVAL_MS).unref();
}

/**
 * Gerações de antes de o nome ser guardado: busca uma vez (`get_project` é
 * gratuita). É o nome que acha o repositório no GitHub.
 */
async function backfillLovableNames(todas) {
  for (const [projectId, lista] of Object.entries(todas)) {
    for (const generation of lista) {
      // Site vinculado de fora do Lovable: não há projeto lá para consultar.
      if (!generation.id || generation.lovableName || generation.id.startsWith("ext-")) continue;
      try {
        const { name } = readProject(
          await callTool("get_project", { project_id: generation.id }),
        );
        if (name) await setGenerationAgent(projectId, generation.id, { lovableName: name });
      } catch (err) {
        console.warn(`[lovable] nome de ${generation.id}: ${err?.message ?? err}`);
      }
    }
  }
}

/** Na subida, retoma as gerações que ainda estavam em andamento. */
export async function resumeGenerationWatch() {
  const todas = await listGenerations();
  void backfillLovableNames(todas);
  for (const [projectId, lista] of Object.entries(todas)) {
    for (const generation of lista) {
      const recente =
        Date.now() - Date.parse(generation.createdAt) <= GIVE_UP_MS;
      if (
        generation.id &&
        recente &&
        (generation.agentState === "running" ||
          generation.agentState === "awaiting")
      ) {
        watchGeneration(projectId, generation.id);
      }
    }
  }
}
