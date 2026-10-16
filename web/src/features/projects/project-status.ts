import type { ClaudeSummary, DevArea, Generation, ManualEtapa, Project } from "@/lib/api";
import { formatDate, parseProjectName, pluralize } from "@/lib/format";

/**
 * O estado do projeto numa palavra — o classificador.
 *
 * O card espalhava a mesma informação por três lugares — um chip do site, um
 * ícone de entrega, um ícone do link e uma caixa "pronto" —, e nenhum deles
 * respondia sozinho "em que pé está isso?". Aqui a pergunta tem uma resposta,
 * e a ordem é a do fluxo de trabalho: o que está mais adiante ganha.
 *
 * Isto diz **qual** é o estado e **por quê** (`detail`). O que a tela faz com
 * ele — a etapa visível, o selo, a cor, o contador do "Fazer agora" e o botão —
 * mora em `stage.ts`, a fonte única que todas as telas leem.
 */

export type ProjectStage =
  /** A etapa escolhida à mão (ver `manualStageOf`): vale até o próximo fato. */
  | "manual-material"
  | "manual-geracao"
  | "manual-link"
  | "manual-cliente"
  | "manual-publicacao"
  | "manual-no-ar"
  | "deploy-failed"
  | "deploying"
  | "claude-interrupted"
  | "claude-failed"
  | "claude-approval"
  | "claude-paused"
  | "live"
  | "dev-failed"
  | "delivered-broken"
  | "delivered"
  | "ready"
  | "awaiting-input"
  | "claude-building"
  | "claude-briefing"
  | "claude-queued"
  | "building"
  | "dev-publishing"
  | "link-broken"
  | "connect-github"
  | "github-failed"
  | "generated"
  | "claude-brief-refused"
  | "claude-brief-ready"
  | "briefed"
  | "empty"
  | "collected"
  | "panel-collected"
  | "to-github"
  | "other-collection"
  | "storage";

/** Os estados na ordem do fluxo — a mesma da precedência abaixo. */
export const stageOrder: ProjectStage[] = [
  "manual-material",
  "manual-geracao",
  "manual-link",
  "manual-cliente",
  "manual-publicacao",
  "manual-no-ar",
  "deploy-failed",
  "deploying",
  "claude-interrupted",
  "claude-failed",
  "claude-approval",
  "claude-paused",
  "live",
  "dev-failed",
  "delivered-broken",
  "delivered",
  "ready",
  "awaiting-input",
  "claude-building",
  "claude-briefing",
  "claude-queued",
  "building",
  "dev-publishing",
  "link-broken",
  "connect-github",
  "github-failed",
  "generated",
  "claude-brief-refused",
  "claude-brief-ready",
  "briefed",
  "collected",
  "panel-collected",
  "empty",
  "to-github",
  "other-collection",
  "storage",
];

/**
 * O nome interno de cada estado — o que os avisos e os testes citam. A tela
 * mostra a etapa (`stage.ts`), não este nome.
 */
export const stageLabels: Record<ProjectStage, string> = {
  "manual-material": "Material (à mão)",
  "manual-geracao": "Geração (à mão)",
  "manual-link": "Link (à mão)",
  "manual-cliente": "Cliente (à mão)",
  "manual-publicacao": "Publicação (à mão)",
  "manual-no-ar": "No ar (à mão)",
  "deploy-failed": "Publicação falhou",
  deploying: "Publicando",
  "claude-interrupted": "Geração interrompida",
  "claude-failed": "Geração falhou",
  "claude-approval": "Direção para aprovar",
  "claude-paused": "Site para continuar",
  live: "No ar",
  "dev-failed": "Prévia falhou",
  "delivered-broken": "Link entregue caiu",
  delivered: "Com o cliente",
  ready: "Pronto para enviar",
  "awaiting-input": "Agente parado",
  "claude-building": "Gerando com o Claude",
  "claude-briefing": "Gerando briefing",
  "claude-queued": "Na fila do Claude",
  building: "Gerando no Lovable",
  "dev-publishing": "Publicando prévia",
  "link-broken": "Link não abre",
  "connect-github": "Conectar ao GitHub",
  "github-failed": "Envio ao GitHub falhou",
  generated: "Site gerado",
  "claude-brief-refused": "Briefing recusado",
  "claude-brief-ready": "Briefing para revisar",
  empty: "Sem material",
  briefed: "Briefing pronto",
  collected: "Material coletado",
  "panel-collected": "Material no painel",
  "to-github": "Enviar ao GitHub",
  "other-collection": "Site em outra coleta",
  storage: "Arquivos",
};

export type ProjectStatus = {
  stage: ProjectStage;
  label: string;
  /** O porquê da etapa, em uma frase — o que falta ou o que está acontecendo. */
  detail: string;
  /** Estados que pedem ação de alguém. */
  attention: boolean;
};

/**
 * Site vinculado que não veio do Lovable (o id foi criado pelo painel): não
 * há editor, Share preview nem agente — o link do cliente é a área de
 * aprovação.
 */
export const isExternalSite = (site: Generation | undefined): boolean =>
  Boolean(site?.id?.startsWith("ext-"));

/** Site que o Claude Code gerou nesta máquina, pelo motor do painel. */
export const isClaudeSite = (site: Generation | undefined): boolean => site?.engine === "claude";

/** As etapas do motor Claude, na língua de quem opera. */
export const claudeStageLabels: Record<string, string> = {
  direcao: "direção criativa",
  geracao: "geração",
  revisao: "revisão",
  critica: "crítica",
  refino: "refino",
  ajuste: "ajuste",
  // A edição livre de um site de repositório.
  preparar: "buscando a última versão no GitHub",
  editar: "o Claude está editando",
  conferir: "conferindo o build",
  enviar: "enviando ao GitHub",
};

export const claudeStageLabel = (etapa: string | null | undefined) =>
  etapa ? (claudeStageLabels[etapa] ?? etapa) : null;

/** "rodada 1 de 2" — `null` quando não se sabe em que rodada o site está. */
export const claudeRoundLabel = (rodada: number | null | undefined, rodadas: number | null | undefined) =>
  rodada && rodadas ? `rodada ${rodada} de ${rodadas}` : null;

/**
 * A rodada de um pedido de crítica ou de refino, pelo resumo do card. O resumo
 * é refeito ao fim de cada execução, então diz a fase em que o site entrou —
 * a do pedido que está na fila. Se ele fala de outra fase, a rodada não é dita.
 */
export const claudeRoundOf = (
  tipo: "criticar" | "refinar",
  site: ClaudeSummary["site"] | undefined,
): string | null =>
  site?.phase === (tipo === "criticar" ? "critica" : "refino") ? claudeRoundLabel(site.round, site.rounds) : null;

/** "Em crítica · rodada 1 de 2", "Em refino": o andamento das rodadas. */
export const claudeRoundTitle = (tipo: "criticar" | "refinar", site: ClaudeSummary["site"] | undefined) =>
  [tipo === "criticar" ? "Em crítica" : "Em refino", claudeRoundOf(tipo, site)].filter(Boolean).join(" · ");

/** A geração mais recente é a que vale; as antigas ficam no modal. */
export const latestGeneration = (project: Project): Generation | undefined =>
  project.generations.at(-1);

/**
 * A área de aprovação do site, se ele está nela. `retired` é de um site
 * substituído por outro gerado depois — a pasta passou a ser do novo.
 */
export const devAreaOf = (site: Generation | undefined): DevArea | null =>
  site?.devArea && site.devArea.state !== "retired" ? site.devArea : null;

/**
 * O endereço que vai ao cliente. `clientUrl` vem pronto da API; o link curto
 * é o mesmo endereço nos dados de antes dele.
 */
export const clientUrlOf = (site: Generation | undefined): string | null =>
  site?.clientUrl ?? site?.shortUrl ?? null;

/**
 * No ar é ter um envio real que terminou com sucesso — configurar não basta,
 * e disparar também não: o build ou o FTP ainda podem falhar.
 */
export const isLive = (project: Project) =>
  Boolean(project.publication?.lastDeployAt);

/** Desde quando o site está no domínio: a primeira publicação, não a última. */
export const liveSinceOf = (project: Project): string | null =>
  project.publication?.firstDeployAt ?? project.publication?.lastDeployAt ?? null;

/** Uma pergunta longa do agente cabe numa frase do card. */
const quote = (text: string, max = 140) => {
  const one = text.replace(/\s+/g, " ").trim();
  return `“${one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one}”`;
};

const status = (stage: ProjectStage, detail: string, attention: boolean, label = stageLabels[stage]): ProjectStatus => ({
  stage,
  label,
  detail,
  attention,
});

/**
 * O instante do fato mais recente do projeto: gerar, vincular, terminar a
 * construção, trocar de projeto, enviar ao cliente, publicar a prévia ou o
 * domínio, mandar ao GitHub, o material ir ao Claude, uma execução do Claude.
 * Conferências periódicas (o link, o agente) não contam: não são passos.
 */
export function lastFactAt(project: Project): number | null {
  const instantes: Array<string | null | undefined> = [];
  for (const site of project.generations) {
    instantes.push(
      site.createdAt,
      site.linkedAt,
      site.agentDoneAt,
      site.projectChangedAt,
      site.deliveredAt,
      site.claudeValidatedAt,
      site.claudePushedAt,
      site.devArea?.configuredAt,
      site.devArea?.lastRun?.at,
      site.devArea?.publishedAt,
    );
  }
  const publicacao = project.publication;
  if (publicacao) {
    instantes.push(publicacao.configuredAt, publicacao.lastDeployAt, publicacao.lastAttempt?.at);
    for (const disparo of publicacao.deploys ?? []) instantes.push(disparo.at);
  }
  const claude = project.claude;
  if (claude) {
    instantes.push(claude.material?.copiedAt, claude.lastRun?.at, claude.push?.at, claude.queue?.criadoEm, claude.queue?.inicio);
  }
  let ultimo: number | null = null;
  for (const iso of instantes) {
    const time = iso ? Date.parse(iso) : Number.NaN;
    if (Number.isFinite(time) && (ultimo === null || time > ultimo)) ultimo = time;
  }
  return ultimo;
}

/**
 * A etapa escolhida à mão, enquanto vale: até acontecer no projeto algo mais
 * novo que a escolha (`lastFactAt`). Depois disso o painel volta a calcular
 * — quem corrigiu o selo não precisa lembrar de desfazer.
 */
export function manualStageOf(project: Project): { etapa: ManualEtapa; at: string; by: string | null } | null {
  const manual = project.details?.stage ?? null;
  if (!manual) return null;
  const escolhida = Date.parse(manual.at);
  if (!Number.isFinite(escolhida)) return null;
  const fato = lastFactAt(project);
  return fato !== null && fato > escolhida ? null : manual;
}

export function projectStatus(project: Project): ProjectStatus {
  // A etapa corrigida à mão vence o cálculo, até o próximo fato.
  const manual = manualStageOf(project);
  if (manual) {
    return status(
      `manual-${manual.etapa}`,
      `Etapa definida à mão${manual.by ? ` por ${manual.by}` : ""} em ${formatDate(manual.at)}. O painel volta a calcular no próximo passo registrado.`,
      false,
    );
  }

  const site = latestGeneration(project);
  const tentativa = project.publication?.lastAttempt;
  const area = devAreaOf(site);
  const clienteUrl = clientUrlOf(site);

  // A publicação mais recente falhou. Vem antes de "No ar": se já havia uma
  // versão publicada ela continua lá, mas o que se pediu não chegou — e só
  // quem abrisse o GitHub descobriria.
  if (tentativa?.status === "failure") {
    return status(
      "deploy-failed",
      isLive(project)
        ? "O domínio segue com a versão anterior. O erro está na execução do GitHub."
        : "O site não foi ao ar. O erro está na execução do GitHub.",
      true,
    );
  }

  if (tentativa?.status === "pending") {
    return status("deploying", "Build e envio por FTP em andamento; o painel avisa quando terminar.", false);
  }

  // O motor Claude deixou algo esperando uma pessoa. Vem antes de "No ar",
  // pelo mesmo motivo da publicação que falhou: o que se pediu não chegou, e
  // só quem abrisse o projeto descobriria.
  const claude = project.claude ?? null;
  const fila = claude?.queue ?? null;
  if (fila?.estado === "interrompida") {
    return status("claude-interrupted", "Um reinício do painel interrompeu a execução do Claude. Retome ou descarte.", true);
  }
  if (claude && !fila) {
    if (claude.site?.awaitingApproval) {
      return status(
        "claude-approval",
        "A direção criativa está pronta; o site só é gerado depois que alguém aprovar ou escolher outra rota.",
        true,
      );
    }
    if (claude.site?.openStage) {
      return status(
        "claude-failed",
        `A execução terminou com a etapa de ${claudeStageLabel(claude.site.openStage)} aberta. Continue de onde parou ou encerre a etapa.`,
        true,
      );
    }
    // O ajuste foi validado, mas o repositório ainda tem a versão de antes:
    // o que se pediu não chegou ao link do cliente. Acontece quando quem
    // pediu não pode publicar, ou quando o envio automático falhou.
    if (
      isClaudeSite(site) &&
      site?.repoFullName &&
      site.claudeValidatedAt &&
      (!site.claudePushedAt || site.claudeValidatedAt > site.claudePushedAt)
    ) {
      return claude.push?.state === "failed"
        ? status("github-failed", `O envio ao GitHub falhou: ${claude.push.message ?? "veja o projeto na aba Claude."}`, true)
        : status(
            "to-github",
            "Há uma versão validada que ainda não foi ao GitHub; o link do cliente segue com a anterior.",
            true,
          );
    }
    // Uma falha só toma o card quando não sobrou nada aproveitável: o
    // briefing que já estava aceito, ou o site que já existia, continuam valendo.
    const semBriefing = claude.lastRun?.type === "analisar" && claude.briefing?.state !== "ok";
    const semSite = claude.lastRun?.type !== "analisar" && !isClaudeSite(site);
    if (claude.lastRun?.status === "falha" && (semBriefing || semSite)) {
      return status(
        "claude-failed",
        semBriefing
          ? "O Claude não entregou um briefing aceito. Veja o erro e peça de novo."
          : "A geração do site falhou. Veja o erro antes de pedir de novo.",
        true,
      );
    }
    // O site ainda não foi entregue e não há nada na fila: a sequência parou
    // no meio — a trava foi desligada, ou uma execução não fez o site andar.
    // Sem isto o card voltaria a "Briefing para revisar", como se nada
    // tivesse sido gerado.
    if (claude.site?.next) {
      const rodada = claudeRoundLabel(claude.site.round, claude.site.rounds);
      return status(
        "claude-paused",
        claude.site.next === "criticar"
          ? `Parou antes da crítica${rodada ? ` da ${rodada}` : ""}: o site está escrito e revisado. Continuar consome a assinatura.`
          : claude.site.next === "refinar"
            ? `Parou antes do refino${rodada ? ` da ${rodada}` : ""}: a crítica já apontou o que corrigir. Continuar consome a assinatura.`
            : "A criação do site parou antes de terminar. Continuar consome a assinatura.",
        true,
      );
    }
  }

  // No ar ganha de tudo: o cliente já vê o site no domínio dele, e o link de
  // preview do Lovable — vivo ou morto — deixou de ser o que ele acessa. Antes
  // um site publicado aparecia como "Link não abre", e o alarme falso ensinava
  // a ignorar o vermelho.
  if (isLive(project)) {
    const desde = liveSinceOf(project);
    return status(
      "live",
      // O selo já diz "No ar" e o domínio é o título da linha: aqui, só desde quando.
      desde ? `Publicado no domínio desde ${formatDate(desde)}.` : "Publicado no domínio.",
      false,
    );
  }

  // A publicação na área de aprovação falhou. Vem antes de "Entregue": o
  // cliente pode estar olhando a versão anterior sem que ninguém saiba que a
  // nova não chegou. O motivo vem do log da execução.
  if (area?.state === "failed") {
    return status(
      "dev-failed",
      [
        area.publishedSha
          ? "A última publicação na área de aprovação falhou; o link segue com a versão anterior."
          : "A publicação na área de aprovação falhou.",
        area.detail,
      ]
        .filter(Boolean)
        .join(" "),
      true,
    );
  }

  // O cliente recebeu um link que parou de abrir. Antes "Entregue" vinha
  // primeiro e pintava de verde justamente o caso mais urgente do painel.
  if (site?.deliveredAt && site.previewState === "dead") {
    return status(
      "delivered-broken",
      area
        ? "O cliente recebeu um link que não abre mais. Verifique; se continuar fora, veja a última publicação."
        : "O cliente recebeu um link que não abre mais. Crie um novo Share preview; o link curto enviado continua o mesmo.",
      true,
    );
  }

  if (site?.deliveredAt) {
    return status(
      "delivered",
      `Enviado em ${formatDate(site.deliveredAt)}${site.deliveredBy ? ` por ${site.deliveredBy}` : ""}. Publique quando o cliente aprovar.`,
      false,
    );
  }

  // O link abre: é mandar. A conferência é a sonda do painel, que roda
  // sozinha — a caixa "pronto" que existia aqui só repetia essa resposta.
  if (clienteUrl && site?.previewState === "alive") {
    return status("ready", "O link do cliente abre: falta enviar.", false);
  }

  // O agente parou esperando alguém no editor (aprovação ou checagem de
  // crédito) e não retoma sozinho. A pergunta dele, quando o painel a leu,
  // já diz o que responder.
  if (site?.agentState === "awaiting") {
    return status(
      "awaiting-input",
      site.agentQuestion
        ? `O agente perguntou: ${quote(site.agentQuestion)}`
        : "O agente do Lovable parou e espera uma resposta.",
      true,
    );
  }

  // Um pedido na fila do Claude, ou rodando: o painel acompanha sozinho.
  if (fila?.estado === "rodando") {
    if (fila.tipo === "analisar") {
      return status("claude-briefing", "O Claude está lendo o material e escrevendo o briefing.", false);
    }
    // Nas rodadas o site ainda está sendo criado: o andamento diz em qual
    // delas, e o card não oferece o envio ao GitHub nem o link do cliente.
    if (fila.tipo === "criticar" || fila.tipo === "refinar") {
      return status(
        "claude-building",
        fila.tipo === "criticar"
          ? "Uma conversa do Claude que não escreveu o site avalia o resultado."
          : "O Claude está corrigindo no site o que a crítica apontou.",
        false,
        claudeRoundTitle(fila.tipo, claude?.site),
      );
    }
    return status(
      "claude-building",
      fila.tipo === "ajuste" ? "O Claude está aplicando o ajuste no site." : "O Claude está construindo o site.",
      false,
    );
  }
  if (fila?.estado === "esperando") {
    const vez = fila.posicao ? `: é o ${fila.posicao}º a rodar` : "";
    if (fila.tipo === "criticar" || fila.tipo === "refinar") {
      const rodada = claudeRoundOf(fila.tipo, claude?.site);
      return status(
        "claude-queued",
        `${fila.tipo === "criticar" ? "A crítica" : "O refino"}${rodada ? ` da ${rodada}` : ""} espera a vez na fila do Claude${vez}.`,
        false,
      );
    }
    // O ajuste roda ao lado da criação de outros sites; o que cria um site
    // espera uma vaga de criação.
    return status("claude-queued", `Pedido na fila do Claude${vez}.`, false);
  }

  if (site?.agentState === "running") {
    return status("building", "O Lovable está construindo o site; o painel avisa quando terminar.", false);
  }

  // O build e o envio para a pasta do cliente. O painel confere sozinho a
  // cada push — cada edição no Lovable publica de novo.
  if (area?.state === "publishing") {
    return status("dev-publishing", "Build e envio para a área de aprovação em andamento.", false);
  }

  // Link quebrado passa à frente de "site gerado": é o único estado em que
  // algo já feito parou de funcionar, e ninguém descobre sem olhar.
  if (site && (site.sharePreviewUrl || area?.publishedSha) && site.previewState === "dead") {
    return status(
      "link-broken",
      area
        ? "A pasta do site na área de aprovação não abre. Verifique ou publique de novo."
        : "O Share preview não abre mais. Crie um novo no Lovable e reaponte o link.",
      true,
    );
  }

  // O repositório nasce da conexão com o GitHub, feita no Lovable — o MCP
  // não faz isso. Com o repositório de pé, o painel publica sozinho.
  if (area?.state === "waiting-repo") {
    return status("connect-github", "Conecte o projeto ao GitHub no Lovable; o painel publica a prévia sozinho.", true);
  }

  // O Claude gerou e validou o site, e o código ainda mora só nesta máquina.
  if (isClaudeSite(site) && !site?.repoFullName) {
    return claude?.push?.state === "failed"
      ? status("github-failed", `O envio ao GitHub falhou: ${claude.push.message ?? "veja o projeto na aba Claude."}`, true)
      : status("to-github", "O site está só nesta máquina; envie ao GitHub para publicar a prévia.", true);
  }

  if (site?.origin === "linked" && !site.sharePreviewUrl) {
    return status(
      "generated",
      "Site feito fora do painel. Publique a prévia na área de aprovação para ter o link do cliente.",
      true,
      "Site vinculado",
    );
  }

  // No GitHub, mas fora da área de aprovação: o link do cliente nasce nela,
  // e não no Lovable — este site nunca esteve lá.
  if (isClaudeSite(site)) {
    return status(
      "generated",
      "O código está no GitHub. Publique a prévia na área de aprovação para ter o link do cliente.",
      true,
    );
  }

  if (site) {
    return status(
      "generated",
      site.sharePreviewUrl
        ? "O link foi colado e ainda não foi conferido."
        : "Falta criar o link do cliente no Lovable (Share preview).",
      true,
    );
  }

  // Sem site nesta pasta, mas o domínio tem um em outra coleta: o cliente
  // mandou o material de novo e o site foi feito a partir da outra. Pedir
  // "Gerar" aqui faria um segundo site para o mesmo domínio.
  const doDominio = project.domainSite;
  if (doDominio) {
    const quando = parseProjectName(doDominio.projectName).collectedAt;
    return status(
      "other-collection",
      `O site de ${project.domain ?? "este domínio"} está na coleta${quando ? ` de ${formatDate(quando.toISOString())}` : " mais recente"}. Esta não precisa de outra geração.`,
      false,
    );
  }

  // Sem site ainda, mas com o briefing que o Claude escreveu: recusado pela
  // conferência, é corrigir; aceito, é revisar e gerar.
  if (claude?.briefing?.state === "refused") {
    return status(
      "claude-brief-refused",
      `A conferência apontou ${pluralize(claude.briefing.errors, "pendência")} no briefing. Corrija para poder gerar o site.`,
      true,
    );
  }
  if (claude?.briefing?.state === "ok") {
    return status("claude-brief-ready", "O Claude escreveu o briefing e a conferência aceitou. Revise e gere o site.", true);
  }

  // Criado no painel, sem site registrado: não há coleta nem briefing a
  // esperar. Com um site pronto entre os arquivos (ou ainda nada), o passo é
  // mandá-lo ao GitHub; com material e nenhum site, é gerar com o Claude; e o
  // projeto só de arquivos não cobra passo nenhum.
  if (project.source === "panel") {
    if (project.purpose === "files") {
      return status("storage", "Projeto só de arquivos, criado no painel.", false);
    }
    if (project.hasSite === false && project.fileCount > 0) {
      return status(
        "panel-collected",
        "Arquivos no painel e nenhum site pronto: o Claude escreve o briefing a partir deles.",
        false,
      );
    }
    return status(
      "to-github",
      project.fileCount > 0
        ? "Projeto criado no painel. Envie o site ao GitHub para publicar a prévia e, depois, o domínio."
        : "Projeto criado no painel, ainda sem arquivos. Envie o site (uma pasta ou um .zip) ao GitHub.",
      true,
    );
  }

  if (project.fileCount === 0 && project.folderCount === 0) {
    return status("empty", "A pasta do Drive está vazia: o cliente ainda não enviou o material.", true);
  }

  if (project.brief) {
    return status("briefed", "Material e briefing no lugar.", false);
  }

  return status("collected", "Sem o arquivo “Informações do Site”: descreva o site ao gerar.", false);
}
