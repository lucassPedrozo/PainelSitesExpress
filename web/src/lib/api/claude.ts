import type { Generation } from "./generations";
import type { BuildFile } from "./lovable";
import type { BriefFile } from "./projects";
import type { StockSelection } from "./lovable";
import { get, request, send } from "./http";

/* ---- Motor Claude — briefing, geração, acompanhamento e fila ---------- */

/*
 * O painel envolve o motor: o que é do painel (a fila, o resumo do card) vem
 * com nomes em inglês, como o resto da API; o que vem do motor ou do executor
 * (o briefing, as etapas, as execuções) chega como eles escrevem, em
 * português — `tipo`, `estado`, `erros`. Não é traduzido no caminho.
 */

/** O pedido que o painel digita ao claude, no lugar de uma pessoa. */
export type ClaudeRequestType = "analisar" | "cliente" | "ajuste" | "continuar" | "briefing";

/** Como uma execução terminou — ou `rodando`, enquanto não terminou. */
export type ClaudeRunStatus =
  | "rodando"
  | "sucesso"
  | "falha"
  | "cancelada"
  | "aguardando_aprovacao"
  | "interrompida";

/** Um pedido na fila do Claude: esperando, rodando ou interrompido por um reinício. */
export type ClaudeQueueItem = {
  id: string;
  estado: "esperando" | "rodando" | "interrompida";
  tipo: ClaudeRequestType;
  /** A frase digitada ao claude — a mesma do runbook do motor. */
  frase: string;
  criadoEm: string;
  inicio: string | null;
  projectId: string | null;
  /** Quem pediu: o nome da chave de acesso. */
  por: string | null;
  slug: string | null;
  execucaoId: string | null;
  /** A etapa do motor em que a execução está (direção, geração, revisão, ajuste). */
  etapa: string | null;
  /** Só no resumo do projeto: 1 é o próximo a rodar. */
  posicao?: number | null;
};

/** O que o motor Claude tem de um projeto — o bastante para o card. */
export type ClaudeSummary = {
  /** A pasta de trabalho do projeto, escolhida pelo painel. */
  folder: string;
  /** O site no motor; `null` antes da primeira geração. */
  slug: string | null;
  queue: ClaudeQueueItem | null;
  material: {
    copiedAt: string;
    by: string | null;
    files: number;
    bytes: number;
    /** O que ficou de fora da cópia, e por quê. */
    skipped: string[];
  } | null;
  briefing: {
    state: "ok" | "refused" | "missing";
    errors: number;
    warnings: number;
    checkedAt: string;
  } | null;
  site: {
    /** A direção criativa espera a aprovação de uma pessoa. */
    awaitingApproval: boolean;
    /** Etapa que ficou aberta: a execução terminou no meio dela. */
    openStage: string | null;
    delivered: boolean;
    situation: string | null;
    checkedAt: string;
  } | null;
  lastRun: {
    id: string | null;
    type: ClaudeRequestType;
    status: Exclude<ClaudeRunStatus, "rodando">;
    message: string;
    at: string;
    durationMs: number | null;
  } | null;
  /** O último envio do site ao GitHub — feito por alguém ou pelo painel, sozinho. */
  push?: {
    state: "sent" | "failed";
    at: string;
    by: string | null;
    /** O painel enviou sozinho, logo depois de a geração ser validada. */
    automatic: boolean;
    repoFullName?: string;
    sha?: string;
    /** O motivo da falha, ou o aviso de que a prévia não foi publicada. */
    message: string | null;
  } | null;
};

export type ClaudeGate = { enabled: boolean; reason: string | null };

export type ClaudeStatus = {
  /** O pacote do motor está nesta cópia do painel? */
  installed: boolean;
  reason: string | null;
  /** A trava do gasto (`CLAUDE_ENABLE_GENERATION`). */
  generation: ClaudeGate;
  /** O motor que a tela de geração traz marcado (`GENERATION_ENGINE`). */
  defaultEngine: "lovable" | "claude" | "own";
  queue: {
    /** Voltou pausada de um reinício: nada roda até alguém retomar. */
    paused: boolean;
    running: ClaudeQueueItem | null;
    waiting: ClaudeQueueItem[];
    interrupted: ClaudeQueueItem[];
    last: { item: ClaudeQueueItem; status: ClaudeRunStatus; mensagem: string | null } | null;
  };
  /** Build ou captura em andamento nesta máquina. */
  task: string | null;
};

/** Uma linha do log, já traduzida do stream do claude e filtrada pelo servidor. */
export type ClaudeLogLine = {
  tipo:
    | "sessao"
    | "etapa"
    | "ferramenta"
    | "comando"
    | "imagem"
    | "texto"
    | "saida"
    | "erro"
    | "aviso"
    | "resultado";
  texto: string;
};

export type ClaudeEvents = {
  /** Devolvido na consulta seguinte, para vir só o que é novo. */
  cursor: string;
  /** A tela troca o que tinha pelo que veio, em vez de acrescentar. */
  reset: boolean;
  /** O pedido da fila a que as linhas pertencem. */
  item: string | null;
  events: Array<{ ts: string; legiveis: ClaudeLogLine[] }>;
};

/** Uma execução do `claude -p` no projeto. */
export type ClaudeRun = {
  id: string;
  data: string;
  tipo: ClaudeRequestType;
  pedido: string;
  status: ClaudeRunStatus;
  modelo: string | null;
  etapa: string | null;
  etapaAberta: string | null;
  duracaoMs: number | null;
  /**
   * ESTIMATIVA DO CLAUDE CODE, a preço de API. O consumo de verdade sai da
   * assinatura; este número nunca é somado a outro custo.
   */
  custoEstimadoUsd: number | null;
  turnos: number | null;
  mensagem: string | null;
  /** Retomou a sessão anterior do site. */
  retomou: boolean;
  /** A sessão a retomar não existia mais: abriu uma nova com o mesmo pedido. */
  sessaoNovaPorFalha: boolean;
  por: string | null;
  slug: string | null;
};

/** As opções do site, gravadas no próprio briefing. */
export type ClaudeSiteOptions = {
  multiplas_paginas: boolean;
  banco_de_imagens: boolean;
  skills: string[];
  observacoes: string;
};

/** O briefing do motor. Só os campos que a tela edita têm tipo; o resto passa adiante. */
export type ClaudeBriefing = {
  empresa?: { nome?: string; ramo?: string; cidade?: string; fundacao?: number | string; descricao?: string };
  objetivo?: string;
  publico?: string;
  diferenciais?: string[];
  servicos?: Array<{ nome?: string; descricao?: string; preco?: string }>;
  sobre?: string;
  contato?: {
    whatsapp?: string;
    telefone?: string;
    email?: string;
    endereco?: string;
    horario?: string;
    instagram?: string;
  };
  tom_desejado?: string;
  preferencias_visuais?: string;
  imagens?: Array<{ arquivo?: string; descricao?: string }>;
  [campo: string]: unknown;
};

/** Tudo o que entra na criação do site, para conferir antes de gastar. */
export type ClaudeReview = {
  pasta: string;
  /** Há um briefing na pasta do cliente? */
  existe: boolean;
  /** Caminho relativo à pasta de trabalho do motor. */
  arquivo: string | null;
  /** Pendências que impedem a geração. */
  erros: string[];
  /** O site sai, mas mais pobre. */
  avisos: string[];
  resumo: string[];
  /** Os sites que este briefing já gerou. */
  projetos: string[];
  briefing: ClaudeBriefing | null;
  fotos: Array<{ arquivo: string; descricao: string; existe: boolean; caminho: string }>;
  opcoes: ClaudeSiteOptions | null;
  skillsDisponiveis: string[];
  maxSkills: number;
  bancos: string[];
  aprovacaoHumana: boolean;
};

export type ClaudeStage = {
  n: number;
  etapa: string;
  modo: string;
  modelo: string;
  status: "aberta" | "concluida" | "falhou";
  chamadas: number;
  limite: number;
  builds: number;
  errosBuild: number;
  inicio: string;
  fim: string | null;
  pedido: string | null;
  motivoFalha: string | null;
};

/** O site no motor: etapas, capturas e, esperando aprovação, a direção criativa. */
export type ClaudeSite = {
  slug: string;
  situacao: string;
  etapaAberta: string | null;
  aguardandoAprovacao: boolean;
  entregue: boolean;
  /** O resumo da direção criativa, enquanto ela espera aprovação. */
  brief: string | null;
  fotosPropostas: Array<{
    ref: string;
    uso: string;
    alt: string;
    autor: string;
    pagina: string;
    miniatura: string | null;
  }>;
  etapas: ClaudeStage[];
  temDist: boolean;
  /** Nomes dos arquivos das capturas, para `claudeImageUrl`. */
  telas: string[];
  filme: string[];
};

export type ClaudeProjectDetail = {
  installed: boolean;
  reason: string | null;
  generation: ClaudeGate;
  project: ClaudeSummary | null;
  review: ClaudeReview | null;
  site: ClaudeSite | null;
  /** Da mais recente para a mais antiga. */
  runs: ClaudeRun[];
};

/** O material do projeto, classificado — a lista tem os campos dos anexos do Lovable. */
export type ClaudeMaterial = {
  prompt: {
    found: boolean;
    text: string;
    file: (BriefFile & { webViewLink: string }) | null;
    others: number;
  };
  files: BuildFile[];
  limits: {
    maxArquivos: number;
    maxBytesPorArquivo: number;
    maxBytesTotal: number;
    maxCaracteresDoTexto: number;
    maxCaracteresDasObservacoes: number;
  };
  engine: "claude";
  generation: ClaudeGate;
};

export type ClaudeBriefingPlan = {
  folder: string;
  /** A frase que seria digitada ao claude. */
  phrase: string;
  /** Sites citados nas observações: só eles ganham leitura de páginas. */
  sites: string[];
  files: Array<{ id: string; name: string; kind: string; size: number | null; exportedToPdf: boolean }>;
  totalBytes: number;
  unknownSizes: number;
  infoChars: number;
  notes: string;
  stockImages: Array<{ id: number; path: string; term: string; section: string | null; user: string; pageUrl: string | null }>;
};

export type ClaudeSitePlan = {
  folder: string;
  phrase: string;
  exists: boolean;
  errors: string[];
  warnings: string[];
  summary: string[];
  previousSites: string[];
  humanApproval: boolean;
};

export type ClaudeBriefingInput = {
  /** Ausente: os arquivos recomendados. */
  fileIds?: string[];
  /** O texto das informações do site. Ausente: o do formulário de coleta. */
  texto?: string;
  observacoes?: string;
  stockImages?: StockSelection[];
};

const base = (projectId: string) => `/api/projects/${projectId}/claude`;

/* ---- o motor e a fila ------------------------------------------------- */

export const fetchClaudeStatus = () => get<ClaudeStatus>("/api/claude/status");

export const fetchClaudeEvents = (cursor: string) =>
  get<ClaudeEvents>(`/api/claude/events?cursor=${encodeURIComponent(cursor)}`);

/** Cancela a execução em andamento. Não gasta: interrompe o gasto. */
export const cancelClaudeRun = () => send<{ cancelled: boolean }>("POST", "/api/claude/queue/cancel", {});

/** Libera a fila pausada. CONSOME A ASSINATURA do Claude Code. */
export const resumeClaudeQueue = () =>
  send<{ paused: boolean }>("POST", "/api/claude/queue/resume", { confirm: true });

export const removeClaudeQueueItem = (itemId: string) =>
  send<{ removed: ClaudeQueueItem }>("DELETE", `/api/claude/queue/${encodeURIComponent(itemId)}`);

/** Retoma uma execução interrompida. CONSOME A ASSINATURA. */
export const resumeInterruptedClaudeRun = (itemId: string) =>
  send<{ item: ClaudeQueueItem }>(
    "POST",
    `/api/claude/queue/interrupted/${encodeURIComponent(itemId)}/resume`,
    { confirm: true },
  );

export const discardInterruptedClaudeRun = (itemId: string) =>
  send<{ discarded: ClaudeQueueItem }>(
    "DELETE",
    `/api/claude/queue/interrupted/${encodeURIComponent(itemId)}`,
  );

/* ---- o projeto no motor ----------------------------------------------- */

export const fetchClaudeProject = (projectId: string) => get<ClaudeProjectDetail>(base(projectId));

export const fetchClaudeMaterial = (projectId: string, refresh = false) =>
  get<ClaudeMaterial>(`${base(projectId)}/material${refresh ? "?refresh=1" : ""}`);

export const fetchClaudeRunLog = (projectId: string, runId: string) =>
  get<{ run: ClaudeRun; lines: ClaudeLogLine[] }>(
    `${base(projectId)}/runs/${encodeURIComponent(runId)}/log`,
  );

/** Tela ou quadro do filme do site, foto do material ou miniatura de foto proposta. */
export const claudeImageUrl = (
  projectId: string,
  tipo: "telas" | "filme" | "material" | "miniatura",
  caminho: string,
  versao?: string | number,
) =>
  `${base(projectId)}/images/${tipo}?path=${encodeURIComponent(caminho)}${
    versao === undefined ? "" : `&v=${encodeURIComponent(String(versao))}`
  }`;

/** Ensaio: o que seria copiado e o comando que rodaria. Não gasta. */
export const previewClaudeBriefing = (projectId: string, body: ClaudeBriefingInput) =>
  send<{ dryRun: true; plan: ClaudeBriefingPlan; command: string; generation: ClaudeGate }>(
    "POST",
    `${base(projectId)}/briefing/preview`,
    body,
  );

/** Copia o material e pede o briefing. CONSOME A ASSINATURA do Claude Code. */
export const requestClaudeBriefing = (projectId: string, body: ClaudeBriefingInput) =>
  send<{
    item: ClaudeQueueItem;
    plan: ClaudeBriefingPlan;
    material: { arquivos: number; bytes: number; pulados: string[] };
  }>("POST", `${base(projectId)}/briefing`, { ...body, confirm: true });

/** Grava o briefing corrigido; a conferência volta na resposta. Não gasta. */
export const saveClaudeBriefing = (projectId: string, briefing: ClaudeBriefing) =>
  send<{ review: ClaudeReview }>("PUT", `${base(projectId)}/briefing`, { briefing });

export const saveClaudeOptions = (projectId: string, opcoes: ClaudeSiteOptions) =>
  send<{ review: ClaudeReview }>("PUT", `${base(projectId)}/options`, { opcoes });

/** Ensaio da geração do site. Não gasta. */
export const previewClaudeSite = (projectId: string, refazer = false) =>
  send<{ dryRun: true; plan: ClaudeSitePlan; command: string; generation: ClaudeGate }>(
    "POST",
    `${base(projectId)}/generate/preview`,
    { refazer },
  );

/** Gera o site a partir do briefing. CONSOME A ASSINATURA. */
export const generateClaudeSite = (
  projectId: string,
  body: { refazer?: boolean; opcoes?: ClaudeSiteOptions } = {},
) => send<{ item: ClaudeQueueItem }>("POST", `${base(projectId)}/generate`, { ...body, confirm: true });

/** Pede um ajuste no site gerado. CONSOME A ASSINATURA. */
export const adjustClaudeSite = (
  projectId: string,
  pedido: string,
  anexos?: ClaudeAdjustAttachments,
) =>
  send<{ item: ClaudeQueueItem }>("POST", `${base(projectId)}/adjust`, {
    pedido,
    confirm: true,
    ...(anexos ? { anexos } : {}),
  });

/** Uma imagem guardada no painel para acompanhar um pedido de ajuste. */
export type ClaudeAttachment = { draft: string; file: string; name: string; size: number };

/** As imagens que seguem com o pedido; `use` manda o Claude pôr a imagem no site. */
export type ClaudeAdjustAttachments = {
  draft: string;
  items: Array<{ file: string; name: string; use: boolean }>;
};

const attachmentsUrl = (projectId: string, query: Record<string, string>) =>
  `${base(projectId)}/adjust/attachments?${new URLSearchParams(query)}`;

/** Sobe uma imagem do pedido de ajuste; o corpo vai cru. Não usa o Claude. */
export const uploadClaudeAttachment = (projectId: string, file: File, draft?: string | null) =>
  request<ClaudeAttachment>(
    attachmentsUrl(projectId, { name: file.name, ...(draft ? { draft } : {}) }),
    { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file },
  );

export const removeClaudeAttachment = (projectId: string, draft: string, file: string) =>
  send<null>("DELETE", attachmentsUrl(projectId, { draft, file }));

/** Continua um site que parou com etapa aberta. CONSOME A ASSINATURA. */
export const continueClaudeSite = (projectId: string) =>
  send<{ item: ClaudeQueueItem }>("POST", `${base(projectId)}/continue`, { confirm: true });

/** Aprova a direção criativa e segue para a geração. CONSOME A ASSINATURA. */
export const approveClaudeDirection = (projectId: string) =>
  send<{ aprovado: boolean; mensagens: string[]; item: ClaudeQueueItem }>(
    "POST",
    `${base(projectId)}/approve`,
    { confirm: true },
  );

/** Fecha como falha a etapa que ficou aberta. Não gasta. */
export const abortClaudeStage = (projectId: string, motivo = "") =>
  send<{ site: ClaudeSite }>("POST", `${base(projectId)}/abort`, { motivo });

export const refuseClaudeStockPhoto = (projectId: string, ref: string) =>
  send<{ site: ClaudeSite }>("POST", `${base(projectId)}/stock-photos/refuse`, { ref });

/** Build e validação do site, nesta máquina. Não usa o Claude. */
export const validateClaudeSite = (projectId: string) =>
  send<{ ok: boolean; texto: string }>("POST", `${base(projectId)}/validate`, {});

/** Fotografa (`telas`) ou filma (`filme`) o site. Não usa o Claude. */
export const captureClaudeSite = (projectId: string, tipo: "telas" | "filme") =>
  send<{ telas?: string[]; filme?: string[] }>("POST", `${base(projectId)}/captures/${tipo}`, {});

/* ---- o site a caminho do GitHub --------------------------------------- */

/** Para onde o site iria, quantos arquivos e o que impede o envio. */
export type ClaudePushPlan = {
  /** Token e organização do GitHub estão nas Configurações? */
  configured: boolean;
  organization: string | null;
  /** O repositório que o site já tem; `null` se ainda vai ser criado. */
  repoFullName: string | null;
  suggestedRepoName: string;
  /** A área de aprovação está configurada? Sem ela o site vai, mas fica sem link. */
  approvalArea: boolean;
  files: number;
  totalBytes: number;
  /** Arquivos de configuração que no projeto são de um template anterior: vão os atuais. */
  outdated: string[];
  /** O que bloqueia o envio: pacote fora do template, credencial dentro do site. */
  problems: string[];
  validatedAt: string | null;
  pushedAt: string | null;
};

export type ClaudePushResult = {
  generation: Generation;
  repository: { fullName: string; url: string; created: boolean };
  commit: { sha: string; changed: boolean; files: number; uploaded: number };
  outdated: string[];
  /** Por que a prévia não foi publicada; o envio vale mesmo assim. */
  warning: string | null;
};

/** Os sites feitos na ferramenta antiga que há nos arquivos do projeto, para trazer ao motor. */
export type ClaudeAdoptPlan = {
  possible: boolean;
  reason: string | null;
  sources: Array<{ path: string; files: number; bytes: number }>;
};

export const fetchClaudeAdoptPlan = (projectId: string) => get<ClaudeAdoptPlan>(`${base(projectId)}/adopt`);

/** Traz o site para o motor Claude. Só copia e registra: não dispara o Claude. */
export const adoptClaudeSite = (projectId: string, sourcePath: string) =>
  send<{ slug: string; files: number; bytes: number; stages: number; generation: Generation }>(
    "POST",
    `${base(projectId)}/adopt`,
    { sourcePath },
  );

export const fetchClaudePushPlan = (projectId: string) =>
  get<ClaudePushPlan>(`${base(projectId)}/repository`);

/**
 * Manda o site validado ao GitHub: cria o repositório na organização, ou
 * atualiza o que o site já tem, e segue para a área de aprovação.
 */
export const pushClaudeSite = (projectId: string, input: { repoName?: string; private?: boolean } = {}) =>
  send<ClaudePushResult>("POST", `${base(projectId)}/repository`, input);
