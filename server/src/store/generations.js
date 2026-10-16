import { randomBytes } from "node:crypto";
import { EXTERNAL_PREFIX, isExternalSite } from "../../../shared/external-site.js";
import { httpError } from "../http.js";
import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * Sites gerados no Lovable
 *
 * O link do projeto só chega uma vez, na resposta do `create_project`. Se ele
 * não for gravado aqui, recuperá-lo depois custa uma busca manual no Lovable —
 * então guardamos por pasta do Drive, em lista, porque a mesma coleta pode ser
 * gerada mais de uma vez.
 * ------------------------------------------------------------------ */

export async function recordGeneration(projectId, generation) {
  const data = await read();
  const entry = {
    id: generation.id ?? null,
    url: generation.url ?? null,
    previewUrl: generation.previewUrl ?? null,
    displayName: generation.displayName ?? null,
    workspaceId: generation.workspaceId ?? null,
    workspaceName: generation.workspaceName ?? null,
    attachments: generation.attachments ?? 0,
    promptChars: generation.promptChars ?? 0,
    createdAt: new Date().toISOString(),
    /** Quem clicou em "Gerar" — o responsável pelo site na linha do tempo. */
    createdBy: generation.createdBy ?? null,
    // ---- Link público do cliente -------------------------------------------
    // `previewUrl` acima é o preview interno do Lovable: ele exige sessão e
    // devolve 401 a qualquer visitante. O que vai ao cliente é o link do botão
    // "Share preview", colado aqui — o MCP do Lovable não tem tool que o crie.
    sharePreviewUrl: null,
    /** Estado da última sonda: "alive" | "dead" | "unknown". */
    previewState: "unknown",
    previewDetail: null,
    previewCheckedAt: null,
    /** Link curto do BetterLinks — estável, repontado quando o share troca. */
    shortLinkId: null,
    shortSlug: null,
    shortUrl: null,
    /**
     * Quando o link foi de fato mandado ao cliente, e por quem — a pergunta
     * que antes só o histórico do WhatsApp respondia.
     */
    deliveredAt: null,
    deliveredBy: null,
    ...AGENT_DEFAULTS,
    // Nasce trabalhando: o create_project volta antes de o agente terminar.
    agentState: "running",
  };

  data.generations[projectId] = [...(data.generations[projectId] ?? []), entry];
  await flush();
  return withDefaults(entry);
}

/**
 * Vincula um site feito fora do painel — no Lovable sem o "Gerar", ou em
 * qualquer repositório da organização. Ele nasce pronto (não há agente a
 * acompanhar) e, a partir daqui, segue o mesmo caminho dos gerados: área de
 * aprovação, link do cliente, entrega e publicação no domínio.
 *
 * @param {string} projectId
 * `createdAt`: quando o site nasceu — a criação do projeto no Lovable, que o
 * painel consulta ao vincular. Sem ela, vale a hora do vínculo. Um site antigo
 * vinculado hoje não pode contar como "gerado hoje" no Dashboard nem no
 * relatório.
 *
 * @param {{ id: string, url?: string | null, repoFullName?: string | null,
 *   lovableName?: string | null, displayName?: string | null,
 *   by?: string | null, delivered?: boolean, createdAt?: string | null }} site
 */
export async function linkGeneration(projectId, site) {
  const data = await read();
  const lista = data.generations[projectId] ?? [];
  if (lista.some((item) => item.id === site.id)) {
    throw httpError(409, "Este site já está vinculado a este projeto.");
  }
  const agora = new Date().toISOString();
  const entry = {
    ...PREVIEW_DEFAULTS,
    id: site.id,
    url: site.url ?? null,
    previewUrl: null,
    displayName: site.displayName ?? null,
    workspaceId: null,
    workspaceName: null,
    attachments: 0,
    promptChars: 0,
    // Uma data no futuro seria erro de relógio: vale a do vínculo.
    createdAt: site.createdAt && site.createdAt < agora ? site.createdAt : agora,
    origin: "linked",
    linkedAt: agora,
    linkedBy: site.by ?? null,
    repoFullName: site.repoFullName ?? null,
    lovableName: site.lovableName ?? null,
    // Já existe: não há agente trabalhando nele.
    agentState: "done",
    // Entrega declarada por quem vinculou — o link foi mandado fora do painel.
    deliveredAt: site.delivered ? agora : null,
    deliveredBy: site.delivered ? (site.by ?? null) : null,
  };
  data.generations[projectId] = [...lista, entry];
  await flush();
  return withDefaults(entry);
}

/**
 * Registra o site que o motor Claude acabou de gerar e validar — ou, num site
 * já registrado (um ajuste), a hora da versão nova.
 *
 * O id leva o prefixo dos sites de fora do Lovable: nada no painel consulta
 * este site lá. Daqui em diante ele segue o caminho dos outros — repositório,
 * área de aprovação, entrega e domínio.
 *
 * @param {string} projectId
 * @param {{ slug: string, displayName?: string | null, by?: string | null }} site
 *   `slug`: a pasta do site na pasta de trabalho do motor
 */
export async function recordClaudeSite(projectId, site) {
  const data = await read();
  const lista = data.generations[projectId] ?? [];
  const agora = new Date().toISOString();

  const existente = lista.find(
    (item) => item.engine === "claude" && item.claudeSlug === site.slug,
  );
  if (existente) {
    existente.claudeValidatedAt = agora;
    await flush();
    return withDefaults(existente);
  }

  const entry = {
    ...PREVIEW_DEFAULTS,
    id: `${EXTERNAL_PREFIX}${randomBytes(6).toString("hex")}`,
    /** O motor que fez o site. As gerações do Lovable não têm o campo. */
    engine: "claude",
    claudeSlug: site.slug,
    /** A última versão validada; maior que a do envio = há o que mandar ao GitHub. */
    claudeValidatedAt: agora,
    claudePushedAt: null,
    claudePushedSha: null,
    url: null,
    previewUrl: null,
    displayName: site.displayName ?? null,
    workspaceId: null,
    workspaceName: null,
    attachments: 0,
    promptChars: 0,
    createdAt: agora,
    createdBy: site.by ?? null,
    // O site já nasce pronto e validado: não há agente a acompanhar.
    agentState: "done",
    agentDoneAt: agora,
  };
  data.generations[projectId] = [...lista, entry];
  await flush();
  return withDefaults(entry);
}

/**
 * Marca que a versão validada do site do Claude foi ao GitHub. É a comparação
 * desta data com a da validação que diz se há algo novo a enviar.
 *
 * @param {string} projectId
 * @param {string} siteId
 * @param {{ at?: string, sha?: string | null }} [push]
 */
export async function setClaudeSitePushed(projectId, siteId, push = {}) {
  const data = await read();
  const entry = findGeneration(data, projectId, siteId);
  entry.claudePushedAt = push.at ?? new Date().toISOString();
  entry.claudePushedSha = push.sha ?? null;
  await flush();
  return withDefaults(entry);
}

/**
 * Troca o projeto do Lovable de um site já registrado — o cliente pediu
 * mudanças e o site foi refeito num projeto novo.
 *
 * Fica o que é do site para o cliente: o link curto (o endereço que ele já
 * recebeu continua valendo, reapontado para o novo Share preview) e a pasta
 * na área de aprovação. Sai o que era do projeto antigo: Share preview,
 * repositório, nome e estado do agente, e a entrega — o site novo ainda não
 * foi mostrado.
 *
 * @param {string} projectId
 * @param {string} lovableId o id atual
 * @param {{ id: string, url: string, lovableName: string | null }} novo
 * @returns {Promise<{ generation: ReturnType<typeof withDefaults>, previousRepo: string | null, previousBranch: string | null }>}
 */
export async function changeGenerationProject(projectId, lovableId, novo) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);
  const lista = data.generations[projectId] ?? [];
  if (novo.id !== lovableId && lista.some((item) => item.id === novo.id)) {
    throw httpError(409, "Esse projeto do Lovable já está registrado neste projeto do Drive.");
  }

  const previousRepo = entry.devArea?.repoFullName ?? entry.repoFullName ?? null;
  const previousBranch = entry.devArea?.branch ?? null;

  entry.id = novo.id;
  entry.url = novo.url;
  entry.previewUrl = null;
  entry.lovableName = novo.lovableName;
  entry.repoFullName = null;
  entry.sharePreviewUrl = null;
  entry.previewState = "unknown";
  entry.previewDetail = null;
  entry.previewCheckedAt = null;
  entry.deliveredAt = null;
  entry.deliveredBy = null;
  entry.agentState = "done";
  // A conclusão registrada era a do projeto antigo.
  entry.agentDoneAt = null;
  entry.agentQuestion = null;
  entry.agentActivity = null;
  entry.screenshotUrl = null;
  entry.signatureFound = null;
  entry.signatureFixSent = false;
  entry.styleRegistered = false;
  // A pasta continua do site; o repositório que publicava nela, não.
  entry.devArea = entry.devArea?.slug
    ? { slug: entry.devArea.slug, url: entry.devArea.url ?? null, state: "retired" }
    : null;
  entry.projectChangedAt = new Date().toISOString();

  await flush();
  return { generation: withDefaults(entry), previousRepo, previousBranch };
}

/**
 * O que o agente do Lovable está fazendo com o site, conferido pelo painel
 * depois do "Gerar" — antes era preciso abrir o Lovable para saber.
 * `agentState`: "running" | "awaiting" (parado esperando alguém no editor) |
 * "done" | "unknown" (gerações anteriores ao acompanhamento).
 */
const AGENT_DEFAULTS = {
  agentState: "unknown",
  agentCheckedAt: null,
  /**
   * Quando o agente terminou pela última vez. `agentCheckedAt` não serve: é a
   * hora da última conferência, não a da conclusão.
   */
  agentDoneAt: null,
  screenshotUrl: null,
  /** A linha "Já usado" deste site já entrou na Workspace Knowledge. */
  styleRegistered: false,
  /** A assinatura Joinvix está no código? `null` enquanto não conferido. */
  signatureFound: null,
  /** O painel já pediu ao agente para pôr a assinatura (uma vez só). */
  signatureFixSent: false,
  /** O que o agente perguntou quando parou — `null` fora de "awaiting". */
  agentQuestion: null,
  /** Nome do projeto no Lovable — o repositório do GitHub nasce com ele. */
  lovableName: null,
  /**
   * O que o agente está fazendo no trabalho em curso — ver `lovable/activity.js`.
   * `null` fora de "running".
   */
  agentActivity: null,
};

/**
 * Os campos do link público nasceram depois das primeiras gerações, então o
 * padrão é preenchido na leitura — a tela recebe sempre o mesmo formato, sem
 * precisar tratar `undefined` campo por campo.
 */
const PREVIEW_DEFAULTS = {
  sharePreviewUrl: null,
  previewState: "unknown",
  previewDetail: null,
  previewCheckedAt: null,
  shortLinkId: null,
  shortSlug: null,
  shortUrl: null,
  deliveredAt: null,
  deliveredBy: null,
  /**
   * De onde o site veio: `panel` (gerado pelo "Gerar") ou `linked` (feito
   * fora do painel e vinculado depois — ver `linkGeneration`).
   */
  origin: "panel",
  linkedAt: null,
  linkedBy: null,
  /** `null` nas gerações de antes de o painel guardar quem gerou. */
  createdBy: null,
  /** Repositório do GitHub confirmado para este site, ao publicar. */
  repoFullName: null,
  /**
   * A publicação na área de desenvolvimento — `null` enquanto o site não
   * entrou nela. Ver `setGenerationDevArea`.
   */
  devArea: null,
  ...AGENT_DEFAULTS,
};

/**
 * O endereço que vai ao cliente: a pasta na área de desenvolvimento, depois
 * da primeira publicação conferida; senão o link curto dos sites de antes
 * dela, que continuam valendo para quem já os recebeu.
 */
const clientUrlOf = (entry) =>
  (entry.devArea?.publishedSha ? entry.devArea.url : null) ?? entry.shortUrl ?? null;

const withDefaults = (entry) => {
  const completa = { ...PREVIEW_DEFAULTS, ...entry };
  return { ...completa, clientUrl: clientUrlOf(completa) };
};

export async function listGenerations() {
  const { generations } = await read();
  return Object.fromEntries(
    Object.entries(generations).map(([projectId, lista]) => [
      projectId,
      lista.map(withDefaults),
    ]),
  );
}

/** Guarda o link de share e o link curto que o mascara. */
export async function setGenerationPreview(projectId, lovableId, patch) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);

  entry.sharePreviewUrl = patch.sharePreviewUrl ?? entry.sharePreviewUrl;
  if (patch.shortLinkId !== undefined) entry.shortLinkId = patch.shortLinkId;
  if (patch.shortSlug !== undefined) entry.shortSlug = patch.shortSlug;
  if (patch.shortUrl !== undefined) entry.shortUrl = patch.shortUrl;

  await flush();
  return withDefaults(entry);
}

/** Resultado da sonda: é ela que decide se o link pode ir ao cliente. */
export async function setGenerationPreviewState(projectId, lovableId, probe) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);

  entry.previewState = probe.state;
  entry.previewDetail = probe.detail ?? null;
  entry.previewCheckedAt = probe.checkedAt ?? new Date().toISOString();

  await flush();
  return withDefaults(entry);
}

function findGeneration(data, projectId, lovableId) {
  const entry = (data.generations[projectId] ?? []).find(
    (item) => item.id === lovableId,
  );
  if (!entry) throw httpError(404, "Geração não encontrada neste projeto");
  return entry;
}

/**
 * Um site feito fora do painel passa a ser um site do motor Claude: a pasta
 * dele foi trazida para a pasta de trabalho do motor. Se o projeto já tem esse
 * site registrado como "de fora" (enviado ou vinculado, com repositório e
 * área de aprovação), é esse registro que muda — o repositório, o link do
 * cliente e a publicação continuam os mesmos. Senão, nasce um registro novo.
 *
 * @param {string} projectId
 * @param {{ slug: string, displayName?: string | null, by?: string | null }} site
 */
export async function adoptClaudeSite(projectId, site) {
  const data = await read();
  const lista = data.generations[projectId] ?? [];
  const ultimo = lista.at(-1);
  if (!ultimo || !isExternalSite(ultimo) || ultimo.engine === "claude") {
    return recordClaudeSite(projectId, site);
  }
  ultimo.engine = "claude";
  ultimo.claudeSlug = site.slug;
  // Há uma versão a mandar: a que está no repositório (se há) foi enviada
  // crua, sem a configuração do template.
  ultimo.claudeValidatedAt = new Date().toISOString();
  ultimo.claudePushedAt = null;
  ultimo.claudePushedSha = null;
  ultimo.claudeAdoptedAt = ultimo.claudeValidatedAt;
  ultimo.claudeAdoptedBy = site.by ?? null;
  await flush();
  return withDefaults(ultimo);
}

/** Remove um site da lista do projeto — o projeto no Lovable não é tocado. */
export async function forgetGeneration(projectId, lovableId) {
  const data = await read();
  const current = data.generations[projectId] ?? [];
  const next = current.filter((item) => item.id !== lovableId);

  if (next.length === current.length) {
    throw httpError(404, "Geração não encontrada neste projeto");
  }

  if (next.length) data.generations[projectId] = next;
  else delete data.generations[projectId];

  await flush();
}

/**
 * Marca (ou desmarca) que o link foi entregue ao cliente.
 *
 * Exige `alive`: registrar entrega de um link que não abre seria gravar uma
 * informação falsa justamente no campo em que se vai confiar depois.
 */
export async function setGenerationDelivered(
  projectId,
  lovableId,
  { delivered, by },
) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);

  if (delivered) {
    if (entry.previewState !== "alive") {
      throw httpError(
        409,
        "O link do cliente não está aberto. Verifique-o antes de registrar a entrega.",
      );
    }
    entry.deliveredAt = new Date().toISOString();
    entry.deliveredBy = by ?? null;
  } else {
    entry.deliveredAt = null;
    entry.deliveredBy = null;
  }

  await flush();
  return withDefaults(entry);
}

/** Liga o site ao repositório do GitHub — confirmado por quem publicou. */
export async function setGenerationRepository(projectId, lovableId, repoFullName) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);
  entry.repoFullName = repoFullName;
  await flush();
  return withDefaults(entry);
}

/** Grava o que o acompanhamento do agente descobriu. */
export async function setGenerationAgent(projectId, lovableId, patch) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);
  const agora = new Date().toISOString();

  // Só a passagem para "pronto" marca a conclusão: as conferências seguintes
  // repetem o estado e não podem empurrar a data para a frente.
  if (patch.agentState === "done" && entry.agentState !== "done") {
    entry.agentDoneAt = agora;
  }

  for (const key of [
    "agentState",
    "screenshotUrl",
    "styleRegistered",
    "signatureFound",
    "signatureFixSent",
    "agentQuestion",
    "lovableName",
    "agentActivity",
  ]) {
    if (patch[key] !== undefined) entry[key] = patch[key];
  }
  entry.agentCheckedAt = agora;

  await flush();
  return withDefaults(entry);
}

/**
 * Grava o que o painel sabe da área de desenvolvimento deste site.
 *
 * `devArea`:
 * - `state`: "waiting-repo" (falta conectar ao GitHub no Lovable) |
 *   "publishing" | "live" | "failed" — a última execução do workflow;
 * - `slug`, `url`: a pasta e o endereço do cliente;
 * - `repoFullName`, `branch`, `templateVersion`, `configuredAt`;
 * - `lastRun`: `{ at, status, runUrl, sha }` da execução mais recente;
 * - `publishedSha`, `publishedAt`: o commit que o painel conferiu no ar.
 *
 * Com a pasta conferida, o link do cliente é ela: a sonda grava o mesmo
 * `previewState` que o link curto usava, e é ele que libera o envio.
 *
 * @param {string} projectId
 * @param {string} lovableId
 * @param {Record<string, unknown>} patch campos de `devArea`
 * @param {{ state: string, detail?: string | null, checkedAt?: string } | null} [probe]
 */
export async function setGenerationDevArea(projectId, lovableId, patch, probe = null) {
  const data = await read();
  const entry = findGeneration(data, projectId, lovableId);

  entry.devArea = { ...(entry.devArea ?? {}), ...patch };
  if (probe) {
    entry.previewState = probe.state;
    entry.previewDetail = probe.detail ?? null;
    entry.previewCheckedAt = probe.checkedAt ?? new Date().toISOString();
  }

  await flush();
  return withDefaults(entry);
}
