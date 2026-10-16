import { Fragment, memo, type ReactNode } from "react";
import { EyeOff, FolderTree, StickyNote, UserRound } from "lucide-react";
import type { Project } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import { describeMaterial, formatDate, pluralize, projectIdentity } from "@/lib/format";
import { Reason } from "@/components/disabled-hint";
import { When } from "@/components/when";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { groupByDate } from "./date-groups";
import { lastActivityOf } from "./last-activity";
import { ProjectActions, useStepBlock, type ProjectActionHandlers } from "./project-actions";
import { ProjectLinks, ProjectOrigin } from "./project-links";
import { ProjectTags } from "./project-tags";
import { SiteEngineBadges } from "./site-engine-badge";
import { StageBadge } from "./stage-badge";
import { stageOf, toneClass, type StageView } from "./stage";

/**
 * A lista de projetos: uma tabela a partir de 900px e, abaixo disso, cartões
 * compactos com a mesma informação na mesma ordem — projeto, etapa, última
 * atividade, próximo passo e a ação.
 *
 * A coluna do projeto é a que cresce: as outras têm largura fixa, a medida
 * do que cabe nelas (o selo mais longo, a frase do passo em três linhas, o
 * botão e o "⋯"). Dentro dela, três camadas — o domínio; uma
 * linha de apoio (o nome, quando é outro, e o material); e os selos (a
 * ferramenta do site e as tags) numa linha só deles. Abaixo de 1280px a
 * última atividade desce para baixo do selo de etapa, para o nome não ser
 * espremido. O botão da ação tem sempre a mesma largura. Um fio vertical
 * curto separa as colunas em cada linha (`cell-divider`), com o mesmo recuo
 * de 12px dos dois lados e sem encostar nas linhas horizontais.
 *
 * As faixas de data (Hoje, Ontem, 7 dias…) são uma barra cinza dentro da
 * tabela; a partir de 1968px (`margem:`), quando sobra espaço à esquerda do
 * contêiner, o nome da faixa sai para a margem, sobre um fio que continua a
 * borda onde a faixa começa — com 2px, um degrau acima do 1px que separa os
 * projetos — e a barra fica só para o leitor de tela.
 *
 * Substitui a grade de cartões e a tabela antigas. A grade gastava seis
 * linhas fixas por projeto para dizer menos que uma linha daqui, e a
 * alternância entre as duas era mais um controle sem resposta nova.
 */

export type ProjectTableProps = {
  projects: Project[];
  tags: TagsController;
  /** Em quantos projetos cada tag está — o número ao lado dela no seletor. */
  tagUsage: Map<string, number>;
  onOpen: (project: Project) => void;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (projectId: string) => void;
  /**
   * As ações de cada projeto — um objeto estável (as linhas são memorizadas).
   * Sem a área de aprovação configurada, `onPublishToApprovalArea` vem vazio.
   */
  actions: ProjectActionHandlers;
  /**
   * A data que separa a lista em faixas (Hoje, Ontem, Últimos 7 dias…), quando
   * a ordem é por data. `null`: a lista corre sem faixas — nenhuma faixa
   * descreveria a ordem por prioridade ou por nome.
   */
  groupDate?: ((project: Project) => Date) | null;
  /** O "agora" das faixas: o instante da leitura, o mesmo do rodapé. */
  reference: number;
};

export function ProjectTable({
  projects,
  tags,
  tagUsage,
  onOpen,
  onTagsChange,
  selectedIds,
  onToggleSelect,
  actions,
  groupDate = null,
  reference,
}: ProjectTableProps) {
  const selecting = selectedIds.size > 0;
  const faixas = groupDate
    ? groupByDate(projects, groupDate, reference)
    : [{ key: "todos", label: "", short: "", items: projects }];
  // A cascata de chegada: a posição na lista, até a 8ª (160ms no total).
  const ordem = new Map(projects.map((project, index) => [project.id, index]));
  const row = (project: Project) => ({
    key: project.id,
    delay: Math.min(ordem.get(project.id) ?? 0, 8) * 20,
    project,
    tags,
    tagUsage,
    onOpen,
    onTagsChange,
    selected: selectedIds.has(project.id),
    selecting,
    onToggleSelect,
    actions,
  });

  return (
    <>
      <table className="hidden w-full table-fixed text-sm tabela:table">
        <caption className="sr-only">Projetos, com a etapa, a última atividade e o próximo passo de cada um</caption>
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-40" />
          <col className="hidden w-44 xl:table-column" />
          <col className="w-72" />
          <col className="w-64" />
        </colgroup>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-2 pl-4 text-left">
              <span className="sr-only">Seleção</span>
            </th>
            <Th>Projeto</Th>
            <Th>Etapa</Th>
            <Th className="hidden xl:table-cell">Última atividade</Th>
            <Th>Situação</Th>
            <Th className="pr-4 text-right">Ação</Th>
          </tr>
        </thead>
        <tbody>
          {faixas.map((faixa) => (
            <Fragment key={faixa.key}>
              {groupDate && (
                <tr className="border-b margem:border-b-0">
                  {/* Presa ao topo enquanto a faixa rola: diz de quando é o que está na tela.
                      Ocupa as colunas visíveis — cinco, e seis quando a da última atividade
                      aparece: passar disso criaria uma coluna fantasma, que espreme as outras.
                      Com o nome na margem, ela continua aqui só para o leitor de tela. */}
                  {[
                    { span: 5, className: "xl:hidden" },
                    { span: 6, className: "hidden xl:table-cell margem:sr-only" },
                  ].map((celula) => (
                    <th
                      key={celula.span}
                      colSpan={celula.span}
                      scope="colgroup"
                      className={cn(
                        "sticky top-14 z-10 bg-muted px-4 py-1.5 text-left text-xs font-semibold",
                        celula.className,
                      )}
                    >
                      {faixa.label}
                      <span className="ml-2 font-normal text-muted-foreground tabular-nums">{faixa.items.length}</span>
                    </th>
                  ))}
                </tr>
              )}
              {faixa.items.map((project, index) => {
                const props = row(project);
                return <ProjectRow {...props} key={props.key} margin={groupDate && index === 0 ? faixa.short : undefined} />;
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="tabela:hidden">
        {faixas.map((faixa) => (
          <section key={faixa.key} aria-label={faixa.label || "Projetos"}>
            {groupDate && (
              <h3 className="sticky top-26 z-10 border-b bg-muted px-4 py-1.5 text-xs font-semibold md:top-14">
                {faixa.label}
                <span className="ml-2 font-normal text-muted-foreground tabular-nums">{faixa.items.length}</span>
              </h3>
            )}
            <ul className="divide-y border-b last:border-b-0" aria-label={faixa.label || "Projetos"}>
              {faixa.items.map((project) => {
                const props = row(project);
                return <ProjectCardItem {...props} key={props.key} />;
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/**
 * O nome da faixa na margem, à esquerda do cartão: assentado sobre um fio que
 * continua a borda de cima da linha onde a faixa começa. Só a partir de
 * `margem:`; abaixo disso a faixa é a barra cinza. É só desenho — o leitor
 * de tela lê a barra.
 */
function MarginLabel({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="absolute right-full bottom-full hidden w-lane truncate border-b-2 pr-3 pb-1 text-right text-section text-foreground margem:block"
    >
      {children}
    </span>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-3 py-2 text-left font-medium", className)}>
      {children}
    </th>
  );
}

type RowProps = {
  project: Project;
  tags: TagsController;
  /** Em quantos projetos cada tag está — o número ao lado dela no seletor. */
  tagUsage: Map<string, number>;
  onOpen: (project: Project) => void;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: (projectId: string) => void;
  actions: ProjectActionHandlers;
  /** O nome curto da faixa de data, na primeira linha dela: vai para a margem. */
  margin?: string;
  /**
   * O atraso da chegada, em ms. Uma linha sobe esmaecendo só quando entra na
   * tela (outra aba, outro filtro, a primeira leitura); a releitura da lista
   * não a anima de novo.
   */
  delay?: number;
};

/**
 * O que vai na linha do projeto: quem ele é (o domínio; o nome só quando é
 * outro), o material e a última atividade. Calculado uma vez por render.
 */
function useRowData(project: Project) {
  const identity = projectIdentity(project);
  const stage = stageOf(project);
  const activity = lastActivityOf(project);
  const title = identity.domain ?? identity.label;
  const subtitle = identity.label !== title ? identity.label : "";
  const material = materialOf(project);
  return { identity, stage, activity, title, subtitle, material };
}

/** O responsável e a observação interna, quando a equipe os definiu. */
function ProjectNotes({ project, className }: { project: Project; className?: string }) {
  const responsavel = project.details?.responsible ?? null;
  const nota = project.details?.note ?? null;
  const oculto = project.details?.hidden ?? null;
  if (!responsavel && !nota && !oculto) return null;
  return (
    <div className={cn("flex min-w-0 items-center gap-x-3 overflow-hidden text-xs text-muted-foreground", className)}>
      {oculto && (
        <span className="inline-flex shrink-0 items-center gap-1">
          <EyeOff className="size-3" aria-hidden />
          Oculto{oculto.by ? ` por ${oculto.by}` : ""} em {formatDate(oculto.at)}
        </span>
      )}
      {responsavel && (
        <span className="inline-flex shrink-0 items-center gap-1 text-foreground/80">
          <UserRound className="size-3" aria-hidden />
          <span className="sr-only">Responsável:</span>
          {responsavel}
        </span>
      )}
      {nota && (
        <span className="inline-flex max-w-full min-w-0 items-center gap-1" title={nota}>
          <StickyNote className="size-3 shrink-0" aria-hidden />
          <span className="sr-only">Observação:</span>
          <span className="truncate">{nota}</span>
        </span>
      )}
    </div>
  );
}

/** O material numa frase curta: a contagem real e se há briefing. */
function materialOf(project: Project): { main: string; sub: string | null; full: string } {
  const full = describeMaterial(project);
  if (project.fileCount === 0 && project.folderCount === 0) {
    return { main: project.source === "panel" ? "Sem arquivos" : "Pasta vazia", sub: null, full };
  }
  const briefing =
    project.claude?.briefing?.state === "ok"
      ? "briefing do Claude"
      : project.brief
        ? "com briefing"
        : project.source === "panel"
          ? null
          : "sem briefing";
  return { main: pluralize(project.fileCount, "arquivo"), sub: briefing, full };
}

function NextStepText({
  project,
  stage,
  approvalAreaReady,
  className,
}: {
  project: Project;
  stage: StageView;
  approvalAreaReady: boolean;
  className?: string;
}) {
  const { reason } = useStepBlock(project, approvalAreaReady);
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      {/* Só o porquê: o selo diz onde o projeto está e o botão, o que fazer —
          o passo por extenso aqui repetia os dois. Com um motivo de bloqueio,
          ele toma o lugar da segunda linha: a altura da linha é fixa. */}
      <p
        className={cn("text-sm", stage.problem ? toneClass[stage.tone].text : "text-foreground/85", reason ? "line-clamp-1" : "line-clamp-2")}
        title={stage.detail}
      >
        {stage.detail}
      </p>
      {reason && (
        <Reason className="[&>span]:line-clamp-1" >
          {reason}
        </Reason>
      )}
    </div>
  );
}

function ActivityText({
  activity,
  className,
  compact = false,
}: {
  activity: ReturnType<typeof lastActivityOf>;
  className?: string;
  /** Sob o selo de etapa: menor, e nada quando não há atividade. */
  compact?: boolean;
}) {
  if (!activity) return compact ? null : <span className="text-muted-foreground">—</span>;
  return (
    <div className={cn("min-w-0 space-y-0.5", compact && "text-xs", className)}>
      <When at={activity.at} className={compact ? "text-foreground" : "font-medium"} />
      <p
        className={cn("text-xs text-muted-foreground", compact ? "line-clamp-1" : "line-clamp-2")}
        title={[activity.title, activity.detail].filter(Boolean).join(" · ")}
      >
        {activity.title}
        {activity.by ? ` · ${activity.by}` : ""}
      </p>
    </div>
  );
}

function ProjectName({
  title,
  subtitle,
  fullName,
  onClick,
}: {
  title: string;
  /** O nome do projeto, quando é outro que o domínio: vai ao lado dele, mais leve. */
  subtitle: string;
  fullName: string;
  onClick: () => void;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {/* A linha inteira responde ao clique, mas é este botão que entra na
          ordem do teclado. */}
      <button
        type="button"
        className="block max-w-full min-w-0 shrink-0 truncate rounded-sm text-left font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        title={fullName}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {title}
      </button>
      {subtitle && (
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={subtitle}>
          {subtitle}
        </span>
      )}
    </div>
  );
}

const ProjectRow = memo(function ProjectRow({
  project,
  tags,
  tagUsage,
  onOpen,
  onTagsChange,
  selected,
  selecting,
  onToggleSelect,
  actions,
  margin,
  delay = 0,
}: RowProps) {
  const { identity, stage, activity, title, subtitle, material } = useRowData(project);
  const abrir = () => (selecting ? onToggleSelect(project.id) : onOpen(project));
  const fullName = identity.renamed ? `${identity.label} · pasta: ${project.name}` : project.name || title;

  return (
    <tr
      onClick={abrir}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group/row h-row animate-rise cursor-pointer border-b align-top transition-colors last:border-b-0 hover:bg-muted/50",
        selected && "bg-primary/5 hover:bg-primary/8",
        // A primeira linha de cada faixa: a borda de cima é a linha da data,
        // que na margem leva o nome da faixa.
        margin && "margem:border-t-2",
      )}
    >
      <td className="relative py-4 pr-3 pl-4">
        {margin && <MarginLabel>{margin}</MarginLabel>}
        <Checkbox
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelect(project.id)}
          aria-label={`Selecionar ${title}`}
          className="mt-0.5"
        />
      </td>
      <td className="cell-divider px-3 py-4">
        <ProjectName title={title} subtitle={subtitle} fullName={fullName} onClick={abrir} />
        <ProjectOrigin project={project} material={material} className="mt-1" />
        {/* Os selos numa linha só deles, com as anotações da equipe no fim: a
            linha tem altura fixa, e o que não cabe vira "+N" ou reticências. */}
        <div className="mt-2 flex h-5 min-w-0 items-center gap-1.5 overflow-hidden">
          <SiteEngineBadges project={project} />
          <ProjectTags project={project} tags={tags} usage={tagUsage} onChange={onTagsChange} singleLine quietAdd className="min-w-0 shrink" />
          <ProjectNotes project={project} className="ml-1.5 shrink" />
        </div>
      </td>
      <td className="cell-divider px-3 py-4">
        <StageBadge view={stage} />
        {/* Sem a coluna própria (abaixo de 1280px), a última atividade fica sob a etapa. */}
        <ActivityText activity={activity} className="mt-2 xl:hidden" compact />
      </td>
      <td className="cell-divider hidden px-3 py-4 xl:table-cell">
        <ActivityText activity={activity} />
      </td>
      <td className="cell-divider px-3 py-4">
        <NextStepText project={project} stage={stage} approvalAreaReady={Boolean(actions.onPublishToApprovalArea)} />
      </td>
      <td className="cell-divider py-4 pr-4 pl-3">
        {/* Sob o botão do passo, na mesma largura: o fio e o "⋯" ficam à direita dele. */}
        <ProjectActions project={project} {...actions} uniform below={<ProjectLinks project={project} />} />
      </td>
    </tr>
  );
});

const ProjectCardItem = memo(function ProjectCardItem({
  project,
  tags,
  tagUsage,
  onOpen,
  onTagsChange,
  selected,
  selecting,
  onToggleSelect,
  actions,
  delay = 0,
}: RowProps) {
  const { identity, stage, activity, title, subtitle, material } = useRowData(project);
  const abrir = () => (selecting ? onToggleSelect(project.id) : onOpen(project));
  const fullName = identity.renamed ? `${identity.label} · pasta: ${project.name}` : project.name || title;

  return (
    <li
      onClick={abrir}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "h-card animate-rise cursor-pointer space-y-2.5 overflow-hidden px-4 py-3.5 transition-colors pointer-coarse:h-card-touch",
        selected && "bg-primary/5",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelect(project.id)}
          aria-label={`Selecionar ${title}`}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <ProjectName title={title} subtitle={subtitle} fullName={fullName} onClick={abrir} />
        </div>
        <StageBadge view={stage} className="max-w-1/2" />
      </div>
      <ProjectOrigin project={project} material={material} className="pl-7" />
      <p className="truncate pl-7 text-xs text-muted-foreground">
        {activity ? (
          <>
            <When at={activity.at} className="text-foreground" /> · {activity.title}
          </>
        ) : (
          "—"
        )}
      </p>
      <NextStepText
        project={project}
        stage={stage}
        approvalAreaReady={Boolean(actions.onPublishToApprovalArea)}
        className="pl-7"
      />
      {/* Os selos numa linha deles, como na tabela, com as anotações no fim. */}
      <div className="flex h-5 min-w-0 items-center gap-1.5 overflow-hidden pl-7">
        <SiteEngineBadges project={project} />
        <ProjectTags project={project} tags={tags} usage={tagUsage} onChange={onTagsChange} singleLine className="min-w-0 shrink" />
        <ProjectNotes project={project} className="ml-1.5 shrink" />
      </div>
      <ProjectActions project={project} {...actions} uniform className="pl-7" />
      <ProjectLinks project={project} layout="row" className="pl-7" />
    </li>
  );
});

/** A lista enquanto carrega: o desenho das linhas, sem números inventados. */
export function ProjectTableSkeleton() {
  return (
    <div className="divide-y" aria-busy="true" aria-label="Carregando os projetos">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="size-4 rounded-sm" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
          <Skeleton className="hidden h-6 w-24 rounded-full tabela:block" />
          <Skeleton className="hidden h-8 w-48 tabela:block" />
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Nada para mostrar: diz o que está filtrando e como desfazer. */
export function ProjectTableEmpty({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <FolderTree className="size-5" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="font-medium">{title}</p>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      {action}
    </div>
  );
}
