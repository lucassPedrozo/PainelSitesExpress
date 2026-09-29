import type { DevArea, Generation, Project } from "@/lib/api";

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
  | "live"
  | "dev-failed"
  | "delivered-broken"
  | "delivered"
  | "ready"
  | "awaiting-input"
  | "building"
  | "dev-publishing"
  | "link-broken"
  | "connect-github"
  | "generated"
  | "briefed"
  | "empty"
  | "collected";

/**
 * Os estados na ordem do fluxo — a mesma da precedência abaixo. O filtro por
 * estado lista nesta ordem.
 */
export const stageOrder: ProjectStage[] = [
  "deploy-failed",
  "deploying",
  "live",
  "dev-failed",
  "delivered-broken",
  "delivered",
  "ready",
  "awaiting-input",
  "building",
  "dev-publishing",
  "link-broken",
  "connect-github",
  "generated",
  "briefed",
  "collected",
  "empty",
];

export const stageLabels: Record<ProjectStage, string> = {
  "deploy-failed": "Publicação falhou",
  deploying: "Publicando",
  live: "No ar",
  "dev-failed": "Prévia falhou",
  "delivered-broken": "Link entregue caiu",
  delivered: "Entregue",
  ready: "Pronto para enviar",
  "awaiting-input": "Parado no Lovable",
  building: "Gerando no Lovable",
  "dev-publishing": "Publicando prévia",
  "link-broken": "Link não abre",
  "connect-github": "Conectar ao GitHub",
  generated: "Site gerado",
  empty: "Sem material",
  briefed: "Briefing pronto",
  collected: "Material coletado",
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

  if (site?.origin === "linked" && !site.sharePreviewUrl) {
    return {
      stage: "generated",
      label: "Site vinculado",
      detail: "Site feito fora do painel. Publique a prévia na área de aprovação para ter o link do cliente.",
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
};
