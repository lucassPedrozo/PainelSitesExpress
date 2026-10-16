import type { ClaudeSummary, Generation, Project } from "@/lib/api";
import { describeMaterial, pluralize, timeOf } from "@/lib/format";
import { clientUrlOf, latestGeneration, liveSinceOf } from "./project-status";

/**
 * A linha do tempo do projeto: o que aconteceu, quando e por quem — do
 * recebimento do material ao site no ar.
 *
 * O selo do card responde "em que pé está"; faltava responder "como chegou
 * aqui": quanto tempo o material esperou para virar site, quem gerou, quando
 * o cliente recebeu o link. Tudo sai de datas que o painel já guarda (a pasta
 * no Drive, a geração, a área de aprovação, a entrega, a publicação), então a
 * linha vale também para os projetos antigos. O que não foi registrado na
 * época — quem gerou os sites de antes deste recurso — aparece como não
 * registrado, e não como palpite.
 */

export type TimelineTone = "neutral" | "info" | "success" | "danger";

export type TimelineIcon =
  | "received"
  | "brief"
  | "material"
  | "generated"
  | "linked"
  | "built"
  | "changed"
  | "approval"
  | "delivered"
  | "configured"
  | "deploy"
  | "live"
  | "failed"
  | "claude"
  /** Site gerado no Lovable: a marca dele, como a do Claude nos sites do motor. */
  | "lovable";

export type TimelineEvent = {
  key: string;
  /** Quando aconteceu (ISO). */
  at: string;
  icon: TimelineIcon;
  tone: TimelineTone;
  title: string;
  detail: string | null;
  /** Quem fez. `null`: o painel fez sozinho, ou o passo não tem autor. */
  by: string | null;
  /** O passo tem um responsável, mas ele não foi registrado na época. */
  byMissing: boolean;
  href: string | null;
  hrefLabel: string | null;
};

type EventInput = Pick<TimelineEvent, "key" | "icon" | "title"> &
  Partial<Omit<TimelineEvent, "key" | "icon" | "title" | "at">> & {
    at: string | null | undefined;
  };

/** Material que chega até uma hora depois da pasta ainda é o envio original. */
const SAME_DELIVERY_MS = 60 * 60_000;

/** "18 min", "5 h 12 min", "3 dias 4 h", "21 dias". */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  }

  const days = Math.floor(hours / 24);
  const text = `${days} ${days === 1 ? "dia" : "dias"}`;
  // Depois de uma semana as horas viram ruído.
  return days < 7 && hours % 24 ? `${text} ${hours % 24} h` : text;
}

function generationEvents(site: Generation, index: number): EventInput[] {
  const key = `site-${site.id ?? index}`;
  const name = site.lovableName ?? site.displayName;
  const area = site.devArea;
  const events: EventInput[] = [];

  if (site.origin === "linked") {
    events.push({
      key: `${key}-linked`,
      at: site.linkedAt ?? site.createdAt,
      icon: "linked",
      title: "Site vinculado ao projeto",
      detail: ["Feito fora do painel", site.repoFullName ?? name].filter(Boolean).join(" · "),
      by: site.linkedBy ?? null,
    });
  } else if (site.engine === "claude") {
    // O site do Claude só entra na lista depois de entregue — gerado, validado
    // e passado pelas rodadas de crítica e refino: não há "construção" a
    // acompanhar depois, como no Lovable.
    events.push({
      key: `${key}-generated`,
      at: site.createdAt,
      icon: "claude",
      tone: "info",
      title: "Site gerado pelo Claude",
      detail: site.claudeSlug ? `Gerado e validado nesta máquina · ${site.claudeSlug}` : "Gerado e validado nesta máquina",
      by: site.createdBy ?? null,
      byMissing: !site.createdBy,
    });
    const validado = timeOf(site.claudeValidatedAt);
    const criado = timeOf(site.createdAt);
    if (validado !== null && criado !== null && validado > criado) {
      events.push({
        key: `${key}-adjusted`,
        at: site.claudeValidatedAt,
        icon: "built",
        title: "Nova versão validada",
        detail: "Um ajuste pedido ao Claude terminou e passou na validação.",
      });
    }
  } else {
    events.push({
      key: `${key}-generated`,
      at: site.createdAt,
      icon: "lovable",
      tone: "info",
      title: "Site gerado no Lovable",
      detail:
        [
          name,
          site.attachments > 0
            ? `${site.attachments} ${site.attachments === 1 ? "anexo" : "anexos"}`
            : null,
          site.workspaceName,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      by: site.createdBy ?? null,
      byMissing: !site.createdBy,
    });
  }

  const created = timeOf(site.createdAt);
  const done = timeOf(site.agentDoneAt);
  if (done !== null && site.engine !== "claude") {
    events.push({
      key: `${key}-built`,
      at: site.agentDoneAt,
      icon: "built",
      title: "Construção concluída no Lovable",
      detail:
        created !== null && done > created
          ? `O agente levou ${formatSpan(done - created)} desde a geração.`
          : null,
    });
  }

  if (site.projectChangedAt) {
    events.push({
      key: `${key}-changed`,
      at: site.projectChangedAt,
      icon: "changed",
      title: "Projeto do Lovable trocado",
      detail: "O site foi refeito num projeto novo; o endereço do cliente continuou o mesmo.",
    });
  }

  if (area?.configuredAt) {
    events.push({
      key: `${key}-approval`,
      at: area.configuredAt,
      icon: "approval",
      title: "Publicação na área de aprovação configurada",
      detail: area.repoFullName,
      by: area.configuredBy ?? null,
    });
  }
  if (area?.publishedAt) {
    events.push({
      key: `${key}-approval-live`,
      at: area.publishedAt,
      icon: "approval",
      tone: "success",
      title: "Prévia no ar na área de aprovação",
      detail: "A versão mais recente que o painel conferiu no link.",
      href: area.url,
      hrefLabel: "abrir a prévia",
    });
  }
  if (area?.lastRun?.status === "failure") {
    events.push({
      key: `${key}-approval-failed`,
      at: area.lastRun.at,
      icon: "failed",
      tone: "danger",
      title: "Publicação da prévia falhou",
      detail: area.detail,
      href: area.lastRun.runUrl,
      hrefLabel: "ver no GitHub",
    });
  }

  if (site.deliveredAt) {
    events.push({
      key: `${key}-delivered`,
      at: site.deliveredAt,
      icon: "delivered",
      tone: "success",
      title: "Link enviado ao cliente",
      detail: clientUrlOf(site),
      by: site.deliveredBy,
    });
  }

  return events;
}

function publicationEvents(project: Project): EventInput[] {
  const publication = project.publication;
  if (!publication) return [];
  const events: EventInput[] = [];

  events.push({
    key: "publication-configured",
    at: publication.configuredAt,
    icon: "configured",
    title: "Publicação no domínio configurada",
    detail: `${publication.domain} · ${publication.repoFullName}`,
    by: publication.configuredBy ?? null,
  });

  for (const deploy of publication.deploys ?? []) {
    events.push({
      key: `deploy-${deploy.at}`,
      at: deploy.at,
      icon: "deploy",
      title: deploy.dryRun ? "Simulação de publicação" : "Publicação disparada",
      detail: deploy.dryRun
        ? "Build e conferência do FTP, sem enviar arquivos."
        : publication.domain,
      by: deploy.by,
    });
  }

  // Duas datas, dois nomes: quando o site foi ao ar pela primeira vez (o fim
  // do projeto, a do Dashboard) e a última publicação — cada edição no
  // Lovable publica de novo. Antes as duas se chamavam "Site no ar".
  const desde = liveSinceOf(project);
  if (desde) {
    events.push({
      key: "publication-first",
      at: desde,
      icon: "live",
      tone: "success",
      // O domínio é o título do projeto em toda tela: a frase não o repete.
      title: "Site no ar no domínio",
      detail: "A primeira publicação que terminou com sucesso.",
      href: `https://${publication.domain}`,
      hrefLabel: "abrir o site",
    });
  }
  if (publication.lastDeployAt && publication.lastDeployAt !== desde) {
    events.push({
      key: "publication-live",
      at: publication.lastDeployAt,
      icon: "live",
      tone: "success",
      title: "Publicado de novo no domínio",
      detail: "A publicação mais recente que terminou com sucesso.",
      href: `https://${publication.domain}`,
      hrefLabel: "abrir o site",
    });
  }

  const attempt = publication.lastAttempt;
  if (attempt?.status === "failure") {
    events.push({
      key: "publication-failed",
      at: attempt.at,
      icon: "failed",
      tone: "danger",
      title: "Publicação falhou",
      detail: publication.lastDeployAt
        ? "O domínio segue com a versão anterior."
        : "O site não foi ao ar.",
      href: attempt.runUrl,
      hrefLabel: "ver no GitHub",
    });
  } else if (attempt?.status === "pending") {
    events.push({
      key: "publication-pending",
      at: attempt.at,
      icon: "deploy",
      tone: "info",
      title: `Publicando em ${publication.domain}`,
      detail: "Build e envio por FTP em andamento.",
      href: attempt.runUrl,
      hrefLabel: "ver no GitHub",
    });
  }

  return events;
}

/** O que cada execução do Claude deixou, pelo tipo e pelo resultado. */
function claudeRunTitle(run: NonNullable<ClaudeSummary["lastRun"]>): { title: string; tone: TimelineTone } {
  if (run.status === "falha") return { title: "Execução do Claude falhou", tone: "danger" };
  if (run.status === "cancelada") return { title: "Execução do Claude cancelada", tone: "neutral" };
  if (run.status === "interrompida") return { title: "Execução do Claude interrompida", tone: "danger" };
  if (run.status === "aguardando_aprovacao") return { title: "Direção criativa pronta para aprovar", tone: "info" };
  const titles: Record<string, string> = {
    analisar: "Briefing escrito pelo Claude",
    cliente: "Site escrito pelo Claude",
    continuar: "Site escrito pelo Claude",
    criticar: "Crítica do site concluída",
    refinar: "Refino do site concluído",
    ajuste: "Ajuste concluído pelo Claude",
  };
  return { title: titles[run.type] ?? "Execução do Claude concluída", tone: "info" };
}

/**
 * Os marcos do motor Claude. Sem eles, um projeto há dias no motor tinha como
 * último acontecimento "Projeto criado". O resumo do card guarda a última
 * execução, o material copiado, o pedido na fila e o último envio ao GitHub —
 * é o que entra; a lista completa das execuções fica na aba Claude.
 */
function claudeEvents(claude: ClaudeSummary): EventInput[] {
  const events: EventInput[] = [];
  if (claude.material) {
    events.push({
      key: "claude-material",
      at: claude.material.copiedAt,
      icon: "claude",
      title: "Material enviado ao Claude",
      detail: pluralize(claude.material.files, "arquivo"),
      by: claude.material.by,
    });
  }
  if (claude.lastRun) {
    const { title, tone } = claudeRunTitle(claude.lastRun);
    events.push({
      key: `claude-run-${claude.lastRun.id ?? claude.lastRun.at}`,
      at: claude.lastRun.at,
      icon: claude.lastRun.status === "falha" ? "failed" : "claude",
      tone,
      title,
      detail: claude.lastRun.status === "falha" ? claude.lastRun.message || null : null,
    });
  }
  if (claude.queue && claude.queue.estado !== "interrompida") {
    events.push({
      key: `claude-queue-${claude.queue.id}`,
      at: claude.queue.criadoEm,
      icon: "claude",
      title: "Pedido na fila do Claude",
      detail: claude.queue.encadeado ? "Posto na fila pelo painel, na sequência do site." : null,
      by: claude.queue.por,
    });
  }
  if (claude.push) {
    events.push({
      key: `claude-push-${claude.push.at}`,
      at: claude.push.at,
      icon: claude.push.state === "failed" ? "failed" : "deploy",
      tone: claude.push.state === "failed" ? "danger" : "neutral",
      title: claude.push.state === "failed" ? "Envio ao GitHub falhou" : "Site enviado ao GitHub",
      detail: claude.push.state === "failed" ? claude.push.message : (claude.push.repoFullName ?? null),
      by: claude.push.automatic ? null : claude.push.by,
    });
  }
  return events;
}

/** Os acontecimentos do projeto, do mais antigo ao mais recente. */
export function projectTimeline(project: Project): TimelineEvent[] {
  const material = describeMaterial(project);
  const hoje = material === "Pasta vazia" ? "Hoje a pasta está vazia." : `Hoje: ${material}.`;
  const inputs: EventInput[] = [
    {
      key: "received",
      at: project.createdTime,
      icon: "received",
      title: project.source === "panel" ? "Projeto criado" : "Material recebido",
      detail:
        project.source === "panel"
          ? `Criado no painel${project.owner ? ` por ${project.owner}` : ""}. ${hoje}`
          : `Pasta da coleta criada no Drive. ${hoje}`,
    },
  ];

  // Um documento do Google editado depois de chegar (o briefing corrigido no
  // próprio Drive): a API diz quando, e é atividade de verdade no projeto.
  const chegou = timeOf(project.lastAdded) ?? timeOf(project.createdTime);
  const editado = timeOf(project.lastActivity);
  if (project.source !== "panel" && editado !== null && chegou !== null && editado - chegou > 60_000) {
    inputs.push({
      key: "drive-edited",
      at: project.lastActivity,
      icon: "material",
      title: "Documento editado no Drive",
      detail: "O arquivo mais recente alterado na pasta.",
    });
  }

  if (project.brief?.createdTime) {
    inputs.push({
      key: "brief",
      at: project.brief.createdTime,
      icon: "brief",
      title: "Briefing recebido",
      detail: project.brief.name,
    });
  }

  const received = timeOf(project.createdTime);
  const added = timeOf(project.lastAdded);
  if (
    added !== null &&
    received !== null &&
    added - received > SAME_DELIVERY_MS &&
    project.lastAdded !== project.brief?.createdTime
  ) {
    inputs.push({
      key: "material",
      at: project.lastAdded,
      icon: "material",
      title: "Material complementado",
      detail: "O arquivo mais recente adicionado à pasta.",
    });
  }

  project.generations.forEach((site, index) => {
    inputs.push(...generationEvents(site, index));
  });
  if (project.claude) inputs.push(...claudeEvents(project.claude));
  inputs.push(...publicationEvents(project));

  return inputs
    .flatMap((input) => {
      const at = input.at;
      if (!at || timeOf(at) === null) return [];
      return [
        {
          tone: "neutral" as const,
          detail: null,
          by: null,
          byMissing: false,
          href: null,
          hrefLabel: null,
          ...input,
          at,
        },
      ];
    })
    // A ordenação é estável: no mesmo instante, vale a ordem do fluxo acima.
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export type TimelineSummary = {
  receivedAt: string | null;
  /** O site que vale é o mais recente; `null` enquanto nenhum foi gerado. */
  generation: {
    /** Quem gerou (ou vinculou); `null` quando não foi registrado. */
    by: string | null;
    linked: boolean;
  } | null;
  /** Quanto cada trecho do fluxo levou — só os que já se completaram. */
  spans: Array<{ label: string; ms: number }>;
};

/** O resumo no topo da linha: quem gerou e quanto cada trecho levou. */
export function timelineSummary(project: Project): TimelineSummary {
  const site = latestGeneration(project);
  const first = project.generations[0];
  const spans: TimelineSummary["spans"] = [];

  const span = (label: string, from: string | null | undefined, to: string | null | undefined) => {
    const start = timeOf(from);
    const end = timeOf(to);
    if (start !== null && end !== null && end >= start) {
      spans.push({ label, ms: end - start });
    }
  };

  // O primeiro site diz quanto o material esperou; o mais recente é o que
  // foi ao cliente.
  span("Do recebimento à geração", project.createdTime, first?.createdAt);
  span("Da geração ao envio ao cliente", site?.createdAt, site?.deliveredAt);
  span("Do recebimento ao ar", project.createdTime, liveSinceOf(project));

  return {
    receivedAt: project.createdTime ?? null,
    generation: site
      ? {
          by: (site.origin === "linked" ? site.linkedBy : site.createdBy) ?? null,
          linked: site.origin === "linked",
        }
      : null,
    spans,
  };
}
