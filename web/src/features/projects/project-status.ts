import type { ClaudeSummary, DevArea, Generation, Project } from "@/lib/api";
import { pluralize } from "@/lib/format";

/**
 * O estado do projeto numa palavra.
 *
 * O card espalhava a mesma informação por três lugares — um chip do site, um
 * ícone de entrega, um ícone do link e uma caixa "pronto" —, e nenhum deles
 * respondia sozinho "em que pé está isso?". Aqui a pergunta tem uma resposta,
 * e a ordem é a do fluxo de trabalho: o que está mais adiante ganha.
 */

export type ProjectStage =
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
  | "generated"
  | "claude-brief-refused"
  | "claude-brief-ready"
  | "briefed"
  | "empty"
  | "collected"
  | "to-github"
  | "storage";

/**
 * Os estados na ordem do fluxo — a mesma da precedência abaixo. O filtro por
 * estado lista nesta ordem.
 */
export const stageOrder: ProjectStage[] = [
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
  "generated",
  "claude-brief-refused",
  "claude-brief-ready",
  "briefed",
  "collected",
  "empty",
  "to-github",
  "storage",
];

export const stageLabels: Record<ProjectStage, string> = {
  "deploy-failed": "Publicação falhou",
  deploying: "Publicando",
  "claude-interrupted": "Geração interrompida",
  "claude-failed": "Geração falhou",
  "claude-approval": "Direção para aprovar",
  "claude-paused": "Site para continuar",
  live: "No ar",
  "dev-failed": "Prévia falhou",
  "delivered-broken": "Link entregue caiu",
  delivered: "Entregue",
  ready: "Pronto para enviar",
  "awaiting-input": "Parado no Lovable",
  "claude-building": "Gerando com o Claude",
  "claude-briefing": "Gerando briefing",
  "claude-queued": "Na fila do Claude",
  building: "Gerando no Lovable",
  "dev-publishing": "Publicando prévia",
  "link-broken": "Link não abre",
  "connect-github": "Conectar ao GitHub",
  generated: "Site gerado",
  "claude-brief-refused": "Briefing recusado",
  "claude-brief-ready": "Briefing para revisar",
  empty: "Sem material",
  briefed: "Briefing pronto",
  collected: "Material coletado",
  "to-github": "Enviar ao GitHub",
  storage: "Arquivos",
};

export type ProjectStatus = {
  stage: ProjectStage;
  label: string;
  /** Frase curta para o `title` — diz o que falta, não só onde está. */
  detail: string;
  /** Estados que pedem ação do operador aparecem destacados. */
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

/** "Em crítica · rodada 1 de 2", "Em refino": o selo e o andamento das rodadas. */
export const claudeRoundTitle = (tipo: "criticar" | "refinar", site: ClaudeSummary["site"] | undefined) =>
  [tipo === "criticar" ? "Em crítica" : "Em refino", claudeRoundOf(tipo, site)].filter(Boolean).join(" · ");

/** A geração mais recente é a que vale; as antigas ficam no modal. */
export const latestGeneration = (project: Project): Generation | undefined =>
  project.generations.at(-1);

/**
 * A área de desenvolvimento do site, se ele está nela. `retired` é de um site
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

export function projectStatus(project: Project): ProjectStatus {
  const site = latestGeneration(project);
  const tentativa = project.publication?.lastAttempt;
  const area = devAreaOf(site);
  const clienteUrl = clientUrlOf(site);

  // A publicação mais recente falhou. Vem antes de "No ar": se já havia uma
  // versão publicada ela continua lá, mas o que se pediu não chegou — e só
  // quem abrisse o GitHub descobriria.
  if (tentativa?.status === "failure") {
    return {
      stage: "deploy-failed",
      label: stageLabels["deploy-failed"],
      detail: isLive(project)
        ? "A última publicação falhou; o domínio segue com a versão anterior. Veja o erro no GitHub."
        : "A publicação falhou e o site não foi ao ar. Veja o erro no GitHub.",
      attention: true,
    };
  }

  if (tentativa?.status === "pending") {
    return {
      stage: "deploying",
      label: stageLabels.deploying,
      detail: "Build e envio por FTP em andamento. O painel confere sozinho e avisa aqui.",
      attention: false,
    };
  }

  // O motor Claude deixou algo esperando uma pessoa. Vem antes de "No ar",
  // pelo mesmo motivo da publicação que falhou: o que se pediu não chegou, e
  // só quem abrisse o projeto descobriria.
  const claude = project.claude ?? null;
  const fila = claude?.queue ?? null;
  if (fila?.estado === "interrompida") {
    return {
      stage: "claude-interrupted",
      label: stageLabels["claude-interrupted"],
      detail: "O painel foi reiniciado no meio de uma execução do Claude. Retome-a ou descarte-a.",
      attention: true,
    };
  }
  if (claude && !fila) {
    if (claude.site?.awaitingApproval) {
      return {
        stage: "claude-approval",
        label: stageLabels["claude-approval"],
        detail: "A direção criativa está pronta. O site só é gerado depois que alguém a aprovar ou escolher outra rota.",
        attention: true,
      };
    }
    if (claude.site?.openStage) {
      return {
        stage: "claude-failed",
        label: stageLabels["claude-failed"],
        detail: `A execução terminou com a etapa de ${claudeStageLabel(claude.site.openStage)} aberta. Continue de onde parou ou encerre a etapa.`,
        attention: true,
      };
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
      return {
        stage: "to-github",
        label: stageLabels["to-github"],
        detail:
          claude.push?.state === "failed" && claude.push.message
            ? `O envio ao GitHub falhou: ${claude.push.message}`
            : "Há uma versão validada que ainda não foi ao GitHub: o link do cliente segue com a anterior.",
        attention: true,
      };
    }
    // Uma falha só toma o card quando não sobrou nada aproveitável: o
    // briefing que já estava aceito, ou o site que já existia, continuam valendo.
    const semBriefing = claude.lastRun?.type === "analisar" && claude.briefing?.state !== "ok";
    const semSite = claude.lastRun?.type !== "analisar" && !isClaudeSite(site);
    if (claude.lastRun?.status === "falha" && (semBriefing || semSite)) {
      return {
        stage: "claude-failed",
        label: stageLabels["claude-failed"],
        detail: semBriefing
          ? "O Claude não entregou um briefing aceito. Veja o erro e peça de novo."
          : "A geração do site falhou. Veja o erro antes de pedir de novo.",
        attention: true,
      };
    }
    // O site ainda não foi entregue e não há nada na fila: a sequência parou
    // no meio — a trava foi desligada, ou uma execução não fez o site andar.
    // Sem isto o card voltaria a "Briefing para revisar", como se nada
    // tivesse sido gerado.
    if (claude.site?.next) {
      const rodada = claudeRoundLabel(claude.site.round, claude.site.rounds);
      return {
        stage: "claude-paused",
        label: stageLabels["claude-paused"],
        detail:
          claude.site.next === "criticar"
            ? `A criação do site parou antes da crítica${rodada ? ` da ${rodada}` : ""}: ele está escrito e revisado. Continue para ele ser entregue.`
            : claude.site.next === "refinar"
              ? `A criação do site parou antes do refino${rodada ? ` da ${rodada}` : ""}: a crítica já apontou o que corrigir. Continue para ele ser entregue.`
              : "A criação do site parou antes de terminar. Continue de onde parou.",
        attention: true,
      };
    }
  }

  // No ar ganha de tudo: o cliente já vê o site no domínio dele, e o link de
  // preview do Lovable — vivo ou morto — deixou de ser o que ele acessa. Antes
  // um site publicado aparecia como "Link não abre", e o alarme falso ensinava
  // a ignorar o vermelho.
  if (isLive(project)) {
    return {
      stage: "live",
      label: stageLabels["live"],
      detail: `Publicado em ${project.publication!.domain}.`,
      attention: false,
    };
  }

  // A publicação na área de desenvolvimento falhou. Vem antes de "Entregue":
  // o cliente pode estar olhando a versão anterior sem que ninguém saiba que
  // a nova não chegou.
  if (area?.state === "failed") {
    return {
      stage: "dev-failed",
      label: stageLabels["dev-failed"],
      // O motivo vem do log da execução — os scripts do workflow dizem o que
      // houve e o que fazer.
      detail: [
        area.publishedSha
          ? "A última publicação na área de aprovação falhou; o link segue com a versão anterior."
          : "A publicação na área de aprovação falhou.",
        area.detail,
      ]
        .filter(Boolean)
        .join(" "),
      attention: true,
    };
  }

  // O cliente recebeu um link que parou de abrir. Antes "Entregue" vinha
  // primeiro e pintava de verde justamente o caso mais urgente do painel.
  if (site?.deliveredAt && site.previewState === "dead") {
    return {
      stage: "delivered-broken",
      label: stageLabels["delivered-broken"],
      detail: area
        ? "O cliente recebeu um link que não abre mais. Verifique o link; se continuar fora, veja a última publicação no GitHub."
        : "O cliente recebeu um link que não abre mais. Crie um novo Share preview e reaponte — o link curto enviado continua o mesmo.",
      attention: true,
    };
  }

  if (site?.deliveredAt) {
    return {
      stage: "delivered",
      label: stageLabels["delivered"],
      detail: site.deliveredBy
        ? `Link enviado ao cliente por ${site.deliveredBy}.`
        : "Link enviado ao cliente.",
      attention: false,
    };
  }

  // O link abre: é mandar. A conferência é a sonda do painel, que roda
  // sozinha — a caixa "pronto" que existia aqui só repetia essa resposta.
  if (clienteUrl && site?.previewState === "alive") {
    return {
      stage: "ready",
      label: stageLabels["ready"],
      detail: "O link do cliente abre — falta enviar.",
      attention: false,
    };
  }

  // O agente parou esperando alguém no editor (aprovação ou checagem de
  // crédito) e não retoma sozinho — sem isto, só abrindo o Lovable se sabia.
  if (site?.agentState === "awaiting") {
    return {
      stage: "awaiting-input",
      label: stageLabels["awaiting-input"],
      detail: "O agente parou esperando uma resposta. Abra o projeto no Lovable e responda.",
      attention: true,
    };
  }

  // Um pedido na fila do Claude, ou rodando: o painel acompanha sozinho.
  if (fila?.estado === "rodando") {
    if (fila.tipo === "analisar") {
      return {
        stage: "claude-briefing",
        label: stageLabels["claude-briefing"],
        detail: "O Claude está lendo o material e escrevendo o briefing. O painel acompanha e avisa aqui.",
        attention: false,
      };
    }
    // Nas rodadas o site ainda está sendo criado: o selo diz em qual delas, e
    // o card não oferece o envio ao GitHub nem o link do cliente.
    if (fila.tipo === "criticar" || fila.tipo === "refinar") {
      return {
        stage: "claude-building",
        label: claudeRoundTitle(fila.tipo, claude?.site),
        detail:
          fila.tipo === "criticar"
            ? "Uma conversa do Claude que não escreveu o site avalia o resultado e aponta o que refinar. O painel acompanha e avisa aqui."
            : "O Claude está corrigindo no site o que a crítica apontou. O painel acompanha e avisa aqui.",
        attention: false,
      };
    }
    return {
      stage: "claude-building",
      label: stageLabels["claude-building"],
      detail:
        fila.tipo === "ajuste"
          ? "O Claude está aplicando o ajuste no site. O painel acompanha e avisa aqui."
          : "O Claude está construindo o site. O painel acompanha e avisa aqui.",
      attention: false,
    };
  }
  if (fila?.estado === "esperando") {
    const vez = fila.posicao ? `: é o ${fila.posicao}º a rodar` : "";
    if (fila.tipo === "criticar" || fila.tipo === "refinar") {
      const rodada = claudeRoundOf(fila.tipo, claude?.site);
      return {
        stage: "claude-queued",
        label: stageLabels["claude-queued"],
        detail: `${fila.tipo === "criticar" ? "A crítica" : "O refino"}${rodada ? ` da ${rodada}` : ""} do site espera a vez na fila do Claude${vez}. Uma execução por vez.`,
        attention: false,
      };
    }
    return {
      stage: "claude-queued",
      label: stageLabels["claude-queued"],
      // O ajuste roda ao lado da criação de outro site; o que cria um site espera a criação anterior.
      detail: `Pedido na fila do Claude${vez}.${fila.tipo === "ajuste" ? "" : " Uma execução por vez."}`,
      attention: false,
    };
  }

  if (site?.agentState === "running") {
    return {
      stage: "building",
      label: stageLabels.building,
      detail: "O Lovable está construindo o site. O painel confere sozinho e avisa aqui.",
      attention: false,
    };
  }

  // O build e o envio para a pasta do cliente. O painel confere sozinho a
  // cada push — cada edição no Lovable publica de novo.
  if (area?.state === "publishing") {
    return {
      stage: "dev-publishing",
      label: stageLabels["dev-publishing"],
      detail: "Build e envio para a área de desenvolvimento em andamento. O painel confere sozinho e avisa aqui.",
      attention: false,
    };
  }

  // Link quebrado passa à frente de "site gerado": é o único estado em que
  // algo já feito parou de funcionar, e ninguém descobre sem olhar.
  if (site && (site.sharePreviewUrl || area?.publishedSha) && site.previewState === "dead") {
    return {
      stage: "link-broken",
      label: stageLabels["link-broken"],
      detail: area
        ? "A pasta do site na área de desenvolvimento não abre. Verifique o link ou publique de novo."
        : "Crie um novo Share preview no Lovable e reaponte o link.",
      attention: true,
    };
  }

  // O repositório nasce da conexão com o GitHub, feita no Lovable — o MCP
  // não faz isso. Com o repositório de pé, o painel publica sozinho.
  if (area?.state === "waiting-repo") {
    return {
      stage: "connect-github",
      label: stageLabels["connect-github"],
      detail: "Conecte o projeto ao GitHub no Lovable. O painel publica sozinho na área de desenvolvimento.",
      attention: true,
    };
  }

  // O Claude gerou e validou o site, e o código ainda mora só nesta máquina.
  if (isClaudeSite(site) && !site?.repoFullName) {
    return {
      stage: "to-github",
      label: stageLabels["to-github"],
      detail:
        claude?.push?.state === "failed" && claude.push.message
          ? `O envio ao GitHub falhou: ${claude.push.message}`
          : "Site gerado pelo Claude e validado. Envie o código ao GitHub para publicar na área de aprovação.",
      attention: true,
    };
  }

  if (site?.origin === "linked" && !site.sharePreviewUrl) {
    return {
      stage: "generated",
      label: "Site vinculado",
      detail: "Site feito fora do painel. Publique a prévia na área de aprovação para ter o link do cliente.",
      attention: true,
    };
  }

  // No GitHub, mas fora da área de aprovação: o link do cliente nasce nela,
  // e não no Lovable — este site nunca esteve lá.
  if (isClaudeSite(site)) {
    return {
      stage: "generated",
      label: stageLabels["generated"],
      detail: "O código do site está no GitHub. Publique a prévia na área de aprovação para ter o link do cliente.",
      attention: true,
    };
  }

  if (site) {
    return {
      stage: "generated",
      label: stageLabels["generated"],
      detail: site.sharePreviewUrl
        ? "O link do cliente ainda não foi verificado."
        : "Falta criar o link do cliente no Lovable (Share preview).",
      attention: true,
    };
  }

  // Sem site ainda, mas com o briefing que o Claude escreveu: recusado pela
  // conferência, é corrigir; aceito, é revisar e gerar.
  if (claude?.briefing?.state === "refused") {
    return {
      stage: "claude-brief-refused",
      label: stageLabels["claude-brief-refused"],
      detail: `A conferência apontou ${pluralize(claude.briefing.errors, "pendência")} no briefing. Corrija para poder gerar o site.`,
      attention: true,
    };
  }
  if (claude?.briefing?.state === "ok") {
    return {
      stage: "claude-brief-ready",
      label: stageLabels["claude-brief-ready"],
      detail: "O Claude escreveu o briefing e a conferência aceitou. Revise e gere o site.",
      attention: true,
    };
  }

  // Criado no painel, sem site registrado: não há coleta nem briefing a
  // esperar. Ou é um site pronto que falta mandar ao GitHub, ou é só um lugar
  // para guardar material — e esse não cobra passo nenhum.
  if (project.source === "panel") {
    return project.purpose === "files"
      ? {
          stage: "storage",
          label: stageLabels.storage,
          detail: "Projeto de arquivos, criado no painel. Para publicar um site daqui, use “Enviar site ao GitHub” no menu.",
          attention: false,
        }
      : {
          stage: "to-github",
          label: stageLabels["to-github"],
          detail: "Projeto criado no painel. Envie o código do site ao GitHub para publicar a prévia e, depois, o domínio.",
          attention: true,
        };
  }

  if (project.fileCount === 0 && project.folderCount === 0) {
    return {
      stage: "empty",
      label: stageLabels["empty"],
      detail: "A pasta do Drive está vazia.",
      attention: true,
    };
  }

  if (project.brief) {
    return {
      stage: "briefed",
      label: stageLabels["briefed"],
      detail: "Material e briefing no lugar — dá para gerar o site.",
      attention: false,
    };
  }

  return {
    stage: "collected",
    label: stageLabels.collected,
    detail: 'Sem o arquivo "Informações do Site" — descreva o site ao gerar.',
    attention: false,
  };
}

/** Classes por estado. Só vermelho e âmbar chamam atenção; o resto informa. */
export const stageClass: Record<ProjectStage, string> = {
  "deploy-failed": "border-destructive/30 bg-destructive/10 text-destructive",
  deploying:
    "animate-pulse border-info/30 bg-info/10 text-info",
  "claude-interrupted": "border-warning/30 bg-warning/10 text-warning",
  "claude-failed": "border-destructive/30 bg-destructive/10 text-destructive",
  "claude-approval": "border-warning/30 bg-warning/10 text-warning",
  "claude-paused": "border-warning/30 bg-warning/10 text-warning",
  "claude-building": "animate-pulse border-info/30 bg-info/10 text-info",
  "claude-briefing": "animate-pulse border-info/30 bg-info/10 text-info",
  "claude-queued": "border-info/30 bg-info/10 text-info",
  "claude-brief-refused": "border-warning/30 bg-warning/10 text-warning",
  "claude-brief-ready": "border-warning/30 bg-warning/10 text-warning",
  live: "border-info/30 bg-info/10 text-info",
  "dev-failed": "border-destructive/30 bg-destructive/10 text-destructive",
  "dev-publishing":
    "animate-pulse border-info/30 bg-info/10 text-info",
  "connect-github":
    "border-warning/30 bg-warning/10 text-warning",
  "awaiting-input": "border-destructive/30 bg-destructive/10 text-destructive",
  building:
    "animate-pulse border-info/30 bg-info/10 text-info",
  "delivered-broken":
    "border-destructive/30 bg-destructive/10 text-destructive",
  delivered:
    "border-success/30 bg-success/10 text-success",
  ready:
    "border-success/30 bg-success/10 text-success",
  "link-broken": "border-destructive/30 bg-destructive/10 text-destructive",
  generated:
    "border-warning/30 bg-warning/10 text-warning",
  briefed: "border-border bg-muted text-muted-foreground",
  empty: "border-destructive/30 bg-destructive/10 text-destructive",
  collected: "border-border bg-muted text-muted-foreground",
  "to-github": "border-warning/30 bg-warning/10 text-warning",
  storage: "border-border bg-muted text-muted-foreground",
};
