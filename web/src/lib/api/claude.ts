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

/**
 * O pedido que o painel digita ao claude, no lugar de uma pessoa. `criticar` e
 * `refinar` são as rodadas depois do site escrito: quem critica é uma sessão
 * que não o escreveu, e quem refina é a que escreveu.
 */
export type ClaudeRequestType = "analisar" | "cliente" | "ajuste" | "continuar" | "criticar" | "refinar";

/** Os níveis do `--effort` do Claude Code, do mais raso ao mais fundo. */
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Onde o site está, do briefing à entrega. */
export type ClaudePipelinePhase =
  | "direcao"
  | "aprovacao"
  | "geracao"
  | "revisao"
  | "critica"
  | "refino"
  | "entregue";

/** O pedido que faz o site andar — o que "Continuar" põe na fila. */
export type ClaudeNextStep = "continuar" | "criticar" | "refinar";

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
  /** A etapa do motor em que a execução está (direção, geração, revisão, crítica, refino, ajuste). */
  etapa: string | null;
  /** O painel pôs na fila sozinho, na sequência de outra execução do mesmo site. */
  encadeado: boolean;
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
    /** O site passou por tudo: geração, revisão e as rodadas de crítica e refino. */
    delivered: boolean;
    situation: string | null;
    /** `null` nos resumos gravados antes das rodadas, até o card ser refeito. */
    phase: ClaudePipelinePhase | null;
    /** A rodada de crítica e refino em que o site está, de quantas. */
    round: number | null;
    rounds: number | null;
    /** O que "Continuar" poria na fila; `null` quando não há o que continuar. */
    next: ClaudeNextStep | null;
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
  defaultEngine: "lovable" | "claude";
  queue: {
    /** Voltou pausada de um reinício: nada roda até alguém retomar. */
    paused: boolean;
    /** A execução principal: a da criação de um site quando há uma, senão o ajuste mais antigo. */
    running: ClaudeQueueItem | null;
    /**
     * Todas as execuções em andamento: a principal e os ajustes que rodam ao
     * lado dela. Ausente em um servidor de antes dos ajustes em paralelo.
     */
    runningAll?: ClaudeQueueItem[];
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
  /** O nível de esforço com que a execução rodou. */
  esforco: string | null;
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

/**
 * As opções do site, gravadas no próprio briefing. Nas de criação (rodadas,
 * direção de arte, movimento, rota), `null` é "o padrão do painel".
 */
export type ClaudeSiteOptions = {
  multiplas_paginas: boolean;
  banco_de_imagens: boolean;
  skills: string[];
  observacoes: string;
  /** Rodadas de crítica e refino depois do site escrito. */
  rodadas: number | null;
  /** `sobria`, `autoral` ou `ousada`. */
  direcao_de_arte: string | null;
  /** `discreto`, `expressivo` ou `cinematografico`. */
  movimento: string | null;
  /** A criação para depois da direção criativa, para alguém escolher a rota. */
  escolher_rota: boolean | null;
  /** Sites que servem de norte: até 5 links, só de sites públicos, e o que olhar neles. */
  referencias: { links: string[]; notas: string };
};

/** O que vale para o site que não escolheu: as Configurações ou, sem elas, o motor. */
export type ClaudeSiteDefaults = {
  rodadas: number;
  direcao_de_arte: string;
  movimento: string;
  escolher_rota: boolean;
};

/** O modelo e o esforço das execuções de um projeto; `null` é "o padrão do painel". */
export type ClaudeRunChoices = { modelo: string | null; esforco: ClaudeEffort | null };

/** As opções de um projeto, com o que vale no lugar do que ele não escolheu. */
export type ClaudeOptions = {
  options: ClaudeRunChoices;
  defaults: ClaudeSiteDefaults & {
    modelo: string;
    esforco: string;
    /** Os modelos que a tela oferece; o servidor aceita outro id válido. */
    modelos: Array<{ id: string; rotulo: string }>;
    esforcos: ClaudeEffort[];
  };
  /** As opções do site; `null` enquanto não há briefing. */
  site: ClaudeSiteOptions | null;
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
  personalidade?: string;
  mundo_visual?: string;
  preferencias_visuais?: string;
  evitar?: string;
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
  padroes: ClaudeSiteDefaults;
  /** Alguém escolhe a rota deste cliente? A opção dele ou, sem ela, o padrão. */
  aprovacaoHumana: boolean;
};

export type ClaudeStage = {
  n: number;
  /** `direcao`, `geracao`, `revisao`, `critica`, `refino` ou `ajuste`. */
  etapa: string;
  /** Só na crítica e no refino: a rodada a que a etapa pertence. */
  rodada: number | null;
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

/** O parecer de uma rodada de crítica: quem o escreve é uma sessão que não escreveu o site. */
export type ClaudeCritique = {
  rodada: number;
  veredito: "refinar" | "aprovado";
  resumo: string;
  /** De 0 a 10 por critério; a partir de 8 o critério não pede mais trabalho. */
  notas: Record<string, number>;
  problemas: Array<{
    gravidade: "grave" | "media" | "leve";
    /** A seção e, se for o caso, a largura em que aparece. */
    onde: string;
    problema: string;
    correcao: string;
  }>;
};

/** Uma das rotas que a direção criativa considerou. */
export type ClaudeRoute = { n: number; nome: string; ideia: string; escolhida: boolean };

/** O site no motor: etapas, rodadas, capturas e, esperando aprovação, a direção criativa. */
export type ClaudeSite = {
  slug: string;
  situacao: string;
  etapaAberta: string | null;
  aguardandoAprovacao: boolean;
  entregue: boolean;
  /** Quantas rodadas o site tem, em qual está e em que fase. */
  pipeline: { rodadas: number; rodada: number; fase: ClaudePipelinePhase };
  /** O que "Continuar" poria na fila; `null` quando não há o que continuar. */
  proximo: ClaudeNextStep | null;
  /** O parecer da rodada mais recente; `null` antes da primeira crítica. */
  critica: ClaudeCritique | null;
  /** As rotas da direção criativa: a escolhida e as que alguém pode pedir no lugar. */
  rotas: ClaudeRoute[];
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
  /**
   * O site aceita várias páginas: um ajuste pode criar, tirar ou dividir
   * páginas. Ausente em um motor de antes de o painel deixar mudar isso.
   */
  multiplasPaginas?: boolean;
  /** As páginas que o site tem hoje além da inicial (os nomes dos arquivos, sem `.html`). */
  paginas?: string[];
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

/**
 * O modelo e o esforço que acompanham um pedido. Chave ausente deixa como está
 * no projeto; `null` volta ao padrão do painel. Num pedido que gasta, o que
 * veio é gravado no projeto quando ele entra na fila; num ensaio, vale só para
 * o comando mostrado.
 */
export type ClaudeRequestChoices = Partial<ClaudeRunChoices>;

const base =(projectId: string) => `/api/projects/${projectId}/claude`;

/* ---- o motor e a fila ------------------------------------------------- */

export const fetchClaudeStatus = () => get<ClaudeStatus>("/api/claude/status");

/** O que roda agora na fila, da principal aos ajustes ao lado dela. */
export const claudeRunningItems = (queue: ClaudeStatus["queue"]): ClaudeQueueItem[] =>
  queue.runningAll ?? (queue.running ? [queue.running] : []);

/** @param itemId o pedido da fila cujo log a tela quer; sem ele, o da execução principal */
export const fetchClaudeEvents = (cursor: string, itemId?: string | null) =>
  get<ClaudeEvents>(
    `/api/claude/events?cursor=${encodeURIComponent(cursor)}${itemId ? `&item=${encodeURIComponent(itemId)}` : ""}`,
  );

/**
 * Cancela uma execução em andamento — a do pedido dado, ou a principal. Não
 * gasta: interrompe o gasto.
 */
export const cancelClaudeRun = (itemId?: string) =>
  send<{ cancelled: boolean }>(
    "POST",
    `/api/claude/queue/cancel${itemId ? `?item=${encodeURIComponent(itemId)}` : ""}`,
    {},
  );

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

/** Tela do site, foto do material ou miniatura de foto proposta. */
export const claudeImageUrl = (
  projectId: string,
  tipo: "telas" | "material" | "miniatura",
  caminho: string,
  versao?: string | number,
) =>
  `${base(projectId)}/images/${tipo}?path=${encodeURIComponent(caminho)}${
    versao === undefined ? "" : `&v=${encodeURIComponent(String(versao))}`
  }`;

/** Ensaio: o que seria copiado e o comando que rodaria. Não gasta. */
export const previewClaudeBriefing = (projectId: string, body: ClaudeBriefingInput & ClaudeRequestChoices) =>
  send<{ dryRun: true; plan: ClaudeBriefingPlan; command: string; generation: ClaudeGate }>(
    "POST",
    `${base(projectId)}/briefing/preview`,
    body,
  );

/** Copia o material e pede o briefing. CONSOME A ASSINATURA do Claude Code. */
export const requestClaudeBriefing = (projectId: string, body: ClaudeBriefingInput & ClaudeRequestChoices) =>
  send<{
    item: ClaudeQueueItem;
    plan: ClaudeBriefingPlan;
    material: { arquivos: number; bytes: number; pulados: string[] };
  }>("POST", `${base(projectId)}/briefing`, { ...body, confirm: true });

/** Grava o briefing corrigido; a conferência volta na resposta. Não gasta. */
export const saveClaudeBriefing = (projectId: string, briefing: ClaudeBriefing) =>
  send<{ review: ClaudeReview }>("PUT", `${base(projectId)}/briefing`, { briefing });

/** O modelo e o esforço do projeto, os padrões e as opções do site. Só lê. */
export const fetchClaudeOptions = (projectId: string) => get<ClaudeOptions>(`${base(projectId)}/options`);

/**
 * Grava as opções do projeto: o modelo e o esforço das próximas execuções e,
 * em `site`, as opções do site (vão para o briefing). Não gasta. O servidor
 * recusa `site` com um pedido do projeto em andamento, ou sem briefing.
 */
export const saveClaudeOptions = (
  projectId: string,
  body: ClaudeRequestChoices & { site?: Partial<ClaudeSiteOptions> },
) => send<ClaudeOptions>("PUT", `${base(projectId)}/options`, body);

/** Ensaio da geração do site. Não gasta. */
export const previewClaudeSite = (
  projectId: string,
  body: { refazer?: boolean } & ClaudeRequestChoices = {},
) =>
  send<{ dryRun: true; plan: ClaudeSitePlan; command: string; generation: ClaudeGate }>(
    "POST",
    `${base(projectId)}/generate/preview`,
    body,
  );

/**
 * Gera o site a partir do briefing. CONSOME A ASSINATURA — nesta execução e
 * nas que o painel põe na fila sozinho depois dela, até o site ser entregue.
 */
export const generateClaudeSite = (
  projectId: string,
  body: { refazer?: boolean; opcoes?: Partial<ClaudeSiteOptions> } & ClaudeRequestChoices = {},
) => send<{ item: ClaudeQueueItem }>("POST", `${base(projectId)}/generate`, { ...body, confirm: true });

/**
 * O site já gerado passa a aceitar várias páginas, ou volta a ser de página
 * única. Não usa o Claude: muda o que o próximo ajuste pode fazer.
 */
export const setClaudeSiteType = (projectId: string, multiplasPaginas: boolean) =>
  send<{ multiplasPaginas: boolean; paginas: string[] }>("PUT", `${base(projectId)}/site/type`, {
    multiplas_paginas: multiplasPaginas,
  });

/** Pede um ajuste no site gerado. CONSOME A ASSINATURA. */
export const adjustClaudeSite = (
  projectId: string,
  pedido: string,
  anexos?: ClaudeAdjustAttachments,
  escolhas: ClaudeRequestChoices = {},
) =>
  send<{ item: ClaudeQueueItem }>("POST", `${base(projectId)}/adjust`, {
    ...escolhas,
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

/**
 * Põe na fila o passo que o site espera: a continuação de uma etapa aberta, a
 * crítica ou o refino — `item.tipo` diz qual. CONSOME A ASSINATURA.
 */
export const continueClaudeSite = (projectId: string, escolhas: ClaudeRequestChoices = {}) =>
  send<{ item: ClaudeQueueItem }>("POST", `${base(projectId)}/continue`, { ...escolhas, confirm: true });

/** Aprova a direção criativa e segue para a geração. CONSOME A ASSINATURA. */
export const approveClaudeDirection = (projectId: string) =>
  send<{ aprovado: boolean; mensagens: string[]; item: ClaudeQueueItem }>(
    "POST",
    `${base(projectId)}/approve`,
    { confirm: true },
  );

/**
 * Troca a rota criativa por outra das propostas (`rota`: o número dela): a
 * direção é refeita com ela na execução que entra na fila. CONSOME A ASSINATURA.
 */
export const chooseClaudeRoute = (projectId: string, rota: number) =>
  send<{ site: ClaudeSite; item: ClaudeQueueItem }>("POST", `${base(projectId)}/route`, {
    rota,
    confirm: true,
  });

/** Fecha como falha a etapa que ficou aberta. Não gasta. */
export const abortClaudeStage = (projectId: string, motivo = "") =>
  send<{ site: ClaudeSite }>("POST", `${base(projectId)}/abort`, { motivo });

export const refuseClaudeStockPhoto = (projectId: string, ref: string) =>
  send<{ site: ClaudeSite }>("POST", `${base(projectId)}/stock-photos/refuse`, { ref });

/** Build e validação do site, nesta máquina. Não usa o Claude. */
export const validateClaudeSite = (projectId: string) =>
  send<{ ok: boolean; texto: string }>("POST", `${base(projectId)}/validate`, {});

/** Fotografa as telas do site, no desktop e no celular. Não usa o Claude. */
export const captureClaudeSite = (projectId: string) =>
  send<{ telas: string[] }>("POST", `${base(projectId)}/captures/telas`, {});

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
