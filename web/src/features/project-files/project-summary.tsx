import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ExternalLink, FileText, Globe, History, Inbox, Loader2 } from "lucide-react";
import type { FileKind, Generation, Project } from "@/lib/api";
import { claudeImageUrl, fetchFolderFiles, fetchProjectBrief, fileThumbnailUrl, isPanelProject } from "@/lib/api";
import { describeMaterial, formatDate, formatDateTime, formatDay, pluralize } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { ViewBriefButton } from "./brief-prompt";
import { nextStep } from "@/features/projects/next-step";
import { OtherBriefsNotice } from "@/features/projects/other-briefs-notice";
import { devAreaOf, latestGeneration, liveSinceOf } from "@/features/projects/project-status";
import { projectTimeline } from "@/features/projects/project-timeline";
import { ETAPAS, stageOf, toneClass, type Etapa } from "@/features/projects/stage";
import { timelineIcons, timelineToneClass } from "@/features/projects/timeline-icons";
import type { ProjectActionHandlers } from "@/features/projects/project-actions";
import { useClaudeProject } from "@/features/claude/use-claude";
import { When } from "@/components/when";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientLink } from "./client-link";
import { ClaudeIcon } from "@/components/brand-icons";

/** As abas para onde o Resumo leva: o detalhe de cada bloco mora nelas. */
export type SummaryTarget = "files" | "timeline" | "claude";

/**
 * A aba "Resumo" do projeto: tudo o que se precisa saber dele numa tela.
 *
 * Na coluna principal, o que conduz o trabalho — o caminho até o domínio, o
 * link do cliente, o site do Claude, o briefing e a publicação. Ao lado, o que
 * se consulta — o material, com as miniaturas, e o que aconteceu por último.
 * Cada bloco leva à aba com o detalhe. Em diálogo estreito, as duas colunas
 * viram uma.
 */
export function ProjectSummary({
  project,
  focusShareInput,
  actions,
  onGenerationChange,
  onOpenTab,
}: {
  project: Project;
  focusShareInput: boolean;
  actions: ProjectActionHandlers;
  onGenerationChange: (project: Project, generation: Generation) => void;
  onOpenTab: (tab: SummaryTarget) => void;
}) {
  const site = latestGeneration(project);
  const step = nextStep(project);

  return (
    <div className="@container">
      <div className="grid gap-x-10 gap-y-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
        <div className="min-w-0 space-y-8">
          <ProjectPath project={project} />

          {site?.id && (
            <ClientLink
              project={project}
              generation={site}
              stepKind={step.kind}
              focusInput={focusShareInput}
              onUpdated={(atualizada) => onGenerationChange(project, atualizada)}
            />
          )}

          {project.claude?.site && <ClaudeSitePreview project={project} onOpen={() => onOpenTab("claude")} />}

          <BriefSection project={project} compact={Boolean(site)} onOpenClaude={() => onOpenTab("claude")} />

          <PublicationSection project={project} />
        </div>

        <aside className="min-w-0 space-y-8" aria-label="Material e atividade">
          <MaterialSection project={project} onOpenFiles={() => onOpenTab("files")} onFindDomain={actions.onFindDomain} />
          <RecentSection project={project} onOpenTimeline={() => onOpenTab("timeline")} />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Blocos
 * ------------------------------------------------------------------ */

function Section({
  id,
  title,
  icon,
  meta,
  action,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  /** Uma informação curta ao lado do título: o nome do arquivo, a situação. */
  meta?: ReactNode;
  /** O atalho para o detalhe, à direita. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <header className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 id={id} className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </h3>
        {meta && <div className="min-w-0 text-xs text-muted-foreground">{meta}</div>}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** O atalho de um bloco para a aba com o detalhe. */
function GoTo({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-mr-2 text-muted-foreground" onClick={onClick}>
      {children}
      <ArrowRight />
    </Button>
  );
}

function Item({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * O caminho até o domínio
 * ------------------------------------------------------------------ */

const CAMINHO: Etapa[] = ["material", "geracao", "link", "cliente", "publicacao", "no-ar"];

/** Quando cada etapa se cumpriu — só as que têm uma data que a diga de fato. */
function pathDates(project: Project): Partial<Record<Etapa, string | null>> {
  const site = latestGeneration(project);
  return {
    material: project.createdTime,
    geracao: site ? (site.origin === "linked" ? (site.linkedAt ?? site.createdAt) : site.createdAt) : null,
    link: devAreaOf(site)?.publishedAt ?? null,
    cliente: site?.deliveredAt ?? null,
    publicacao: project.publication?.configuredAt ?? null,
    "no-ar": liveSinceOf(project),
  };
}

/**
 * As seis etapas, da chegada do material ao domínio no ar: as feitas com a
 * data, a atual no tom dela — ou no do problema, quando há —, e as que faltam
 * apagadas. Projeto só de arquivos não tem caminho: não vira site.
 */
function ProjectPath({ project }: { project: Project }) {
  const stage = stageOf(project);
  if (stage.etapa === "arquivos") return null;
  const atual = CAMINHO.indexOf(stage.etapa);
  const datas = pathDates(project);

  return (
    <section aria-labelledby="resumo-caminho">
      <h3 id="resumo-caminho" className="sr-only">
        Caminho do site
      </h3>
      <ol className="grid grid-cols-3 gap-y-5 @2xl:grid-cols-6">
        {CAMINHO.map((etapa, indice) => {
          // No ar é o fim do caminho: chegar nele é tê-lo cumprido.
          const estado =
            indice < atual || (indice === atual && etapa === "no-ar" && !stage.problem)
              ? "feita"
              : indice === atual
                ? "atual"
                : "falta";
          const def = ETAPAS[etapa];
          const Icon = estado === "feita" ? Check : estado === "atual" && stage.running ? Loader2 : estado === "atual" ? stage.icon : def.icon;
          const data = estado === "feita" ? datas[etapa] : null;
          return (
            <li
              key={etapa}
              aria-current={estado === "atual" ? "step" : undefined}
              className="relative flex min-w-0 flex-col items-center px-1 text-center"
            >
              {/* O fio entre as etapas só existe com as seis numa linha. */}
              {indice > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-4 right-1/2 hidden h-0.5 w-full -translate-y-1/2 @2xl:block",
                    indice <= atual ? "bg-success/50" : "bg-border",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative grid size-8 place-items-center rounded-full ring-4 ring-popover [&_svg]:size-4",
                  estado === "feita"
                    ? "bg-success-soft text-success"
                    : estado === "atual"
                      ? toneClass[stage.tone].soft
                      : "bg-muted text-muted-foreground/60",
                )}
              >
                <Icon className={cn(estado === "atual" && stage.running && "animate-spin")} aria-hidden />
              </span>
              <span
                className={cn(
                  "mt-2 text-xs font-medium",
                  estado === "falta" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {def.label}
              </span>
              <span
                title={data ? formatDateTime(data) : undefined}
                className={cn(
                  "min-h-4 max-w-full truncate text-2xs",
                  estado === "atual" ? cn("font-medium", toneClass[stage.tone].text) : "text-muted-foreground",
                )}
              >
                {estado === "atual"
                  ? stage.problem
                    ? stage.label
                    : stage.running
                      ? "em andamento"
                      : "agora"
                  : data
                    ? formatDay(data)
                    : null}
              </span>
              <span className="sr-only">
                {estado === "feita" ? ", feita" : estado === "atual" ? ", é onde o projeto está" : ", ainda não"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * O site do Claude
 * ------------------------------------------------------------------ */

/** As primeiras telas do site gerado pelo Claude: como ele está, sem abrir a aba. */
function ClaudeSitePreview({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const detail = useClaudeProject(project.id);
  const site = detail.data?.site ?? null;
  const telas = [...(site?.telas ?? [])]
    // O desktop primeiro: é a vista que diz mais do site de relance.
    .sort((a, b) => Number(/celular|mobile/i.test(a)) - Number(/celular|mobile/i.test(b)))
    .slice(0, 3);

  return (
    <Section
      id="resumo-site-claude"
      title="Site do Claude"
      icon={<ClaudeIcon />}
      meta={site && <Badge variant={site.entregue ? "success" : "outline"}>{site.situacao}</Badge>}
      action={<GoTo onClick={onOpen}>Abrir na aba Claude</GoTo>}
    >
      {detail.isPending ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, indice) => (
            <Skeleton key={indice} className="aspect-video rounded-lg" />
          ))}
        </div>
      ) : detail.error ? (
        <p className="text-xs text-destructive">Não foi possível ler o site no motor Claude.</p>
      ) : telas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma tela fotografada ainda. Fotografe o site na aba Claude.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {telas.map((arquivo) => (
            <li key={arquivo}>
              <button
                type="button"
                onClick={onOpen}
                className="group block w-full overflow-hidden rounded-lg border bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label={`Ver a tela ${arquivo.replace(/\.png$/i, "")} na aba Claude`}
              >
                <img
                  src={claudeImageUrl(project.id, "telas", arquivo)}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full object-cover object-top transition group-hover:opacity-90"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * O briefing
 * ------------------------------------------------------------------ */

/**
 * O texto do "Informações do Site", à vista: é o que vai ao gerar, e o que se
 * confere antes. Com o site já feito ele encolhe — vira consulta.
 */
function BriefSection({
  project,
  compact,
  onOpenClaude,
}: {
  project: Project;
  compact: boolean;
  onOpenClaude: () => void;
}) {
  const brief = useQuery({
    queryKey: queryKeys.brief(project.id),
    queryFn: () => fetchProjectBrief(project.id),
    enabled: Boolean(project.brief),
    staleTime: 5 * 60_000,
  });

  if (!project.brief) {
    const claude = project.claude?.briefing?.state;
    return (
      <Section
        id="resumo-briefing"
        title="Briefing"
        icon={<FileText />}
        action={project.claude && <GoTo onClick={onOpenClaude}>Abrir na aba Claude</GoTo>}
      >
        <p className="text-sm text-muted-foreground">
          {claude === "ok"
            ? "Escrito pelo Claude a partir do material e aceito pela conferência."
            : claude === "refused"
              ? "O Claude escreveu o briefing, e a conferência pediu correções."
              : isPanelProject(project)
                ? "O Claude escreve o briefing a partir dos arquivos do projeto."
                : "A pasta não tem o arquivo “Informações do Site”: descreva o site ao gerar."}
        </p>
      </Section>
    );
  }

  return (
    <Section
      id="resumo-briefing"
      title="Briefing"
      icon={<FileText />}
      meta={
        <span className="block truncate" title={project.brief.name}>
          {project.brief.name}
        </span>
      }
      action={<ViewBriefButton project={project} />}
    >
      {brief.isPending ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4" aria-busy="true" aria-label="Lendo o briefing">
          {Array.from({ length: 5 }).map((_, indice) => (
            <Skeleton key={indice} className={cn("h-3.5", indice % 2 ? "w-2/3" : "w-5/6")} />
          ))}
        </div>
      ) : brief.error ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <p>Não foi possível ler o briefing no Drive.</p>
          <Button variant="link" size="xs" onClick={() => void brief.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <pre
            className={cn(
              "overflow-y-auto rounded-lg border bg-muted/30 px-4 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap",
              compact ? "max-h-48" : "max-h-96",
            )}
            tabIndex={0}
            aria-label={`Texto de ${project.brief.name}`}
          >
            {brief.data.text}
          </pre>
          <OtherBriefsNotice others={brief.data.others} />
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * A publicação no domínio
 * ------------------------------------------------------------------ */

function PublicationSection({ project }: { project: Project }) {
  const publicacao = project.publication;
  if (!publicacao) return null;
  const desde = liveSinceOf(project);
  return (
    <Section id="resumo-publicacao" title="Publicação no domínio" icon={<Globe />}>
      <dl className="grid gap-x-6 gap-y-3 text-sm @lg:grid-cols-2">
        <Item label="Domínio">
          <a
            href={`https://${publicacao.domain}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 underline-offset-2 hover:underline"
          >
            <span className="truncate">{publicacao.domain}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        </Item>
        <Item label="Repositório">
          <span className="block truncate" title={publicacao.repoFullName}>
            {publicacao.repoFullName}
          </span>
        </Item>
        <Item label="No ar desde">{desde ? formatDate(desde) : "Ainda não foi ao ar"}</Item>
        {publicacao.lastDeployAt && publicacao.lastDeployAt !== desde && (
          <Item label="Última publicação">
            <When at={publicacao.lastDeployAt} />
          </Item>
        )}
        {publicacao.lastAttempt?.status === "failure" && (
          <Item label="Última tentativa" className="@lg:col-span-2">
            <span className="text-destructive">
              Falhou <When at={publicacao.lastAttempt.at} />
            </span>
            {publicacao.lastAttempt.runUrl && (
              <>
                {" · "}
                <a href={publicacao.lastAttempt.runUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  ver no GitHub
                </a>
              </>
            )}
          </Item>
        )}
      </dl>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * O material
 * ------------------------------------------------------------------ */

/** "3 imagens", "1 PDF": os tipos que chegaram, na ordem em que mais importam. */
const KIND_WORDS: Array<[FileKind, string, string]> = [
  ["image", "imagem", "imagens"],
  ["pdf", "PDF", "PDFs"],
  ["doc", "documento", "documentos"],
  ["archive", "compactado", "compactados"],
  ["video", "vídeo", "vídeos"],
  ["sheet", "planilha", "planilhas"],
  ["slides", "apresentação", "apresentações"],
  ["audio", "áudio", "áudios"],
  ["other", "outro", "outros"],
];

/** Material complementado: um arquivo que entrou mais de uma hora depois da pasta. */
const COMPLEMENTO_MS = 60 * 60_000;

function MaterialSection({
  project,
  onOpenFiles,
  onFindDomain,
}: {
  project: Project;
  onOpenFiles: () => void;
  onFindDomain?: (domain: string) => void;
}) {
  const tipos = KIND_WORDS.flatMap(([kind, um, varios]) => {
    const n = project.kinds[kind] ?? 0;
    return n > 0 ? [pluralize(n, um, varios)] : [];
  });
  const chegou = Date.parse(project.createdTime);
  const ultimo = project.lastAdded ? Date.parse(project.lastAdded) : Number.NaN;
  const complementado = Number.isFinite(ultimo) && Number.isFinite(chegou) && ultimo - chegou > COMPLEMENTO_MS;
  const vazio = project.fileCount === 0 && project.folderCount === 0;

  return (
    <Section
      id="resumo-material"
      title="Material"
      icon={<Inbox />}
      action={!vazio && <GoTo onClick={onOpenFiles}>Arquivos</GoTo>}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Item label="Recebido">
          <When at={project.createdTime} />
        </Item>
        <Item label={isPanelProject(project) ? "No painel" : "Na pasta do Drive"}>{describeMaterial(project)}</Item>
        {complementado && (
          <Item label="Último arquivo" className="col-span-2">
            <When at={project.lastAdded} /> <span className="text-muted-foreground">— chegou depois do envio</span>
          </Item>
        )}
      </dl>

      {tipos.length > 0 && (
        <ul aria-label="Tipos de arquivo" className="flex flex-wrap gap-1.5">
          {tipos.map((tipo) => (
            <li key={tipo} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {tipo}
            </li>
          ))}
        </ul>
      )}

      {(project.kinds.image ?? 0) > 0 && <MaterialThumbs project={project} onOpenFiles={onOpenFiles} />}

      {project.domain && project.domainCollections > 1 && onFindDomain && (
        <Button variant="link" size="xs" className="px-0" onClick={() => onFindDomain(project.domain!)}>
          Ver as {pluralize(project.domainCollections, "coleta")} de {project.domain}
        </Button>
      )}
    </Section>
  );
}

const MINIATURAS = 6;

/**
 * As imagens da pasta, em miniatura: o material de relance, sem abrir a aba.
 * A lista é a mesma que a aba Arquivos lê — uma busca só para as duas.
 */
function MaterialThumbs({ project, onOpenFiles }: { project: Project; onOpenFiles: () => void }) {
  const folder = useQuery({
    queryKey: queryKeys.folderFiles(project.id),
    queryFn: async () => (await fetchFolderFiles(project.id)).files,
  });

  if (folder.isPending) {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 3 }).map((_, indice) => (
          <Skeleton key={indice} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }
  if (folder.error) return <p className="text-xs text-destructive">Não foi possível ler as imagens da pasta.</p>;

  const imagens = folder.data.filter((file) => file.kind === "image" && file.hasThumbnail);
  if (imagens.length === 0) return null;
  const mostradas = imagens.slice(0, MINIATURAS);
  const resto = imagens.length - mostradas.length;

  return (
    <ul aria-label="Imagens da pasta" className="grid grid-cols-3 gap-1.5">
      {mostradas.map((file, indice) => {
        const ultima = indice === mostradas.length - 1 && resto > 0;
        return (
          <li key={file.id}>
            <button
              type="button"
              onClick={onOpenFiles}
              title={file.name}
              aria-label={ultima ? `Ver as outras ${resto} imagens na aba Arquivos` : `Ver ${file.name} na aba Arquivos`}
              className="group relative block w-full overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <img
                src={fileThumbnailUrl(file, 240)}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-square w-full object-cover transition group-hover:opacity-90"
              />
              {ultima && (
                <span className="absolute inset-0 grid place-items-center bg-foreground/55 text-sm font-semibold text-background">
                  +{resto}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * O que aconteceu por último
 * ------------------------------------------------------------------ */

const RECENTES = 5;

function RecentSection({ project, onOpenTimeline }: { project: Project; onOpenTimeline: () => void }) {
  const eventos = projectTimeline(project).slice(-RECENTES).reverse();
  if (eventos.length === 0) return null;

  return (
    <Section
      id="resumo-atividade"
      title="Atividade"
      icon={<History />}
      action={<GoTo onClick={onOpenTimeline}>Linha do tempo</GoTo>}
    >
      <ol className="space-y-3">
        {eventos.map((evento) => {
          const Icon = timelineIcons[evento.icon];
          const linha = [evento.detail, evento.by].filter(Boolean).join(" · ");
          return (
            <li key={evento.key} className="grid grid-icon-row items-start gap-2.5">
              <span className={cn("grid size-7 place-items-center rounded-full", timelineToneClass[evento.tone])}>
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-ui leading-snug font-medium">{evento.title}</span>
                {linha && (
                  <span className="block truncate text-xs text-muted-foreground" title={linha}>
                    {linha}
                  </span>
                )}
              </span>
              <When at={evento.at} className="pt-0.5 text-2xs whitespace-nowrap text-muted-foreground" />
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
