import { recordGeneration } from "../store/generations.js";
import { httpError } from "../http.js";
import { GenerationGuard } from "./generation-guard.js";
import { callTool } from "./mcp.js";
import { generationGate, planFor } from "./package.js";
import { listSignatureFiles } from "./signature.js";
import { uploadAttachment, uploadSignature } from "./upload.js";

/**
 * Montagem e disparo da geração do site no Lovable.
 *
 * Regra de ouro deste módulo: `create_project` é a ÚNICA chamada que consome
 * crédito, e ela mora numa função só, atrás de duas travas — a confirmação
 * explícita da rota e a chave `LOVABLE_ENABLE_GENERATION`. O modo de ensaio
 * (`dryRun`) não toca no Lovable: monta o plano só com dados do Drive, em
 * `package.js`; os anexos sobem por `upload.js`.
 */

/** Workspaces da conta — `list_workspaces` é gratuita. */
export async function listWorkspaces() {
  const result = await callTool("list_workspaces", {});
  return (result?.workspaces ?? []).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan ?? null,
    projectCount: workspace.num_projects ?? 0,
    role: workspace.membership?.role ?? null,
  }));
}

/**
 * Monta o `generateSite` com as dependências explícitas.
 *
 * A produção usa as reais (Drive, MCP do Lovable, store). Os testes trocam
 * cada uma por um dublê, porque este é o caminho que gasta crédito: as travas
 * contra geração duplicada precisam ser provadas sem chamar o Lovable.
 *
 * @param {object} [deps]
 * @param {typeof planFor} [deps.plan]
 * @param {typeof uploadAttachment} [deps.upload]
 * @param {typeof callTool} [deps.call]
 * @param {typeof recordGeneration} [deps.record]
 * @param {() => { enabled: boolean, reason: string | null }} [deps.gate]
 * @param {GenerationGuard} [deps.guard]
 * @param {typeof listSignatureFiles} [deps.signatures]
 * @param {typeof uploadSignature} [deps.uploadLocal]
 */
export function createSiteGenerator({
  plan = planFor,
  upload = uploadAttachment,
  call = callTool,
  record = recordGeneration,
  gate = generationGate,
  guard = new GenerationGuard(),
  signatures = listSignatureFiles,
  uploadLocal = uploadSignature,
} = {}) {
  async function run(projectId, { prompt, fileIds, workspaceId, workspaceName }) {
    const { text, attachments } = await plan(projectId, prompt, fileIds);

    const liberacao = gate();
    if (!liberacao.enabled) throw httpError(423, liberacao.reason);

    // `workspace_id` só é opcional para quem tem um workspace elegível. Com
    // mais de um, o Lovable devolve `available_workspaces` em vez de criar —
    // então a escolha é exigida aqui, antes de gastar qualquer coisa.
    if (!workspaceId) {
      throw httpError(400, "Escolha o workspace do Lovable antes de gerar");
    }

    const uploaded = [];
    for (const file of attachments) {
      uploaded.push(await upload(file));
    }
    // A assinatura Joinvix vai em todo site: a Knowledge (§8) só a aplica
    // quando as imagens chegam com a mensagem.
    for (const file of await signatures()) {
      uploaded.push(await uploadLocal(file));
    }

    // ---- Ponto único de consumo de crédito --------------------------------
    let created;
    try {
      created = await call("create_project", {
        workspace_id: workspaceId,
        initial_message: text,
        ...(uploaded.length
          ? {
              // O schema pede objetos, não ids soltos.
              files: uploaded.map((item) => ({
                file_id: item.fileId,
                file_name: item.name,
                mime_type: item.mimeType,
              })),
            }
          : {}),
      });
    } catch (err) {
      // Recusa explícita do Lovable: nada foi criado, pode tentar de novo.
      if (err?.notProcessed) throw err;

      // Sem resposta confiável, o site pode existir e o crédito ter saído.
      guard.markUncertain(projectId);
      throw httpError(
        err?.status ?? 502,
        `${err?.message ?? "A chamada ao Lovable falhou."} O site pode ter sido criado mesmo assim: ` +
          `confira a lista de projetos no Lovable antes de tentar de novo. ` +
          `Nova geração deste projeto fica bloqueada por ${guard.holdMinutes} min.`,
      );
    }
    // -----------------------------------------------------------------------

    if (created?.available_workspaces) {
      throw httpError(409, "O Lovable pediu para escolher o workspace de novo");
    }

    // Grava antes de responder: o link vem só nesta resposta, e perdê-lo
    // significaria caçar o projeto na mão dentro do Lovable depois.
    let saved;
    try {
      saved = await record(projectId, {
        id: created?.id,
        url: created?.url,
        previewUrl: created?.preview_url,
        displayName: created?.display_name,
        workspaceId: created?.workspace_id ?? workspaceId,
        workspaceName: workspaceName ?? null,
        attachments: uploaded.length,
        promptChars: text.length,
      });
    } catch (err) {
      // O crédito já saiu e o site existe. Gerar de novo duplicaria, e o link
      // só chegou nesta resposta — então ele vai para o log e para a mensagem.
      guard.markUncertain(projectId);
      console.error(
        `[lovable] site criado mas não gravado (projeto ${projectId}):`,
        JSON.stringify(created),
        err,
      );
      throw httpError(
        500,
        `O site foi criado no Lovable${created?.url ? ` (${created.url})` : ""}, mas o painel não conseguiu registrá-lo. ` +
          "Não gere de novo: o link ficou no log do servidor.",
      );
    }

    return {
      project: created,
      generation: saved,
      attachments: uploaded.map(({ name, bytes }) => ({ name, bytes })),
      promptChars: text.length,
      createdAt: saved.createdAt,
    };
  }

  /**
   * Cria o site no Lovable. CONSOME CRÉDITO — é o único caminho do painel que
   * consome. Só roda com a geração habilitada no .env.
   */
  return async function generateSite(projectId, input) {
    // Reservado antes de qualquer leitura: o segundo clique é recusado na hora,
    // sem esperar a varredura do Drive nem os uploads da primeira chamada.
    const release = guard.acquire(projectId);
    try {
      return await run(projectId, input);
    } finally {
      release();
    }
  };
}

/** O gerador de produção: uma trava por processo, para todos os projetos. */
export const generateSite = createSiteGenerator();
