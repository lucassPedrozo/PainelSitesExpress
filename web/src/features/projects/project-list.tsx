import { Fragment, memo, type ReactNode } from "react";
import { StageBadge } from "@/features/projects/stage-badge";
import type { Project } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import { groupAnchor, type DatedGroup } from "@/features/projects/date-groups";
import {
  describeMaterial,
  formatDate,
  projectIdentity,
  relativeTime,
} from "@/lib/format";
import type { ProjectActionHandlers } from "@/features/projects/project-actions";
import { ProjectActions } from "@/features/projects/project-actions";
import { ProjectCard } from "@/features/projects/project-card";
import { ProjectSite } from "@/features/projects/project-site";
import { ProjectProgress } from "@/features/projects/project-progress-view";
import { isInProgress } from "@/features/projects/project-progress";
import { ProjectTags } from "@/features/projects/project-tags";
import { isLive, projectStatus } from "@/features/projects/project-status";
import { queueGroupOf, queueToneClass } from "@/features/projects/work-queue";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

/**
 * As duas visões da lista de projetos — grade e tabela — e o cabeçalho das
 * faixas de data.
 *
 * Saíram do `App.tsx` junto com as regras: o arquivo passava de 900 linhas
 * misturando estado, filtro, ordenação e duas árvores de JSX. Aqui fica só
 * apresentação, e os itens continuam memoizados — é o que mantém o clique num
 * card independente do tamanho da lista.
 */

/** O número do grupo, na cor da urgência dele (a mesma do selo de etapa). */
function GroupCount({ groupKey, count }: { groupKey: string; count: number }) {
  const tone = queueGroupOf(groupKey)?.tone ?? null;
  return (
    <span
      className={cn(
        "text-sm font-medium tabular-nums",
        tone ? queueToneClass[tone] : "text-muted-foreground",
      )}
    >
      {count}
    </span>
  );
}

/**
 * O título de um grupo: o nome em peso de título e, ao lado, quantos projetos
 * ele tem. Era uma legenda miúda em caixa alta, mais apagada que qualquer
 * campo dos cards — e na fila o número do grupo é justamente o que se procura.
 */
export function GroupHeading({
  id,
  groupKey,
  label,
  count,
  action,
}: {
  id?: string;
  groupKey: string;
  label: string;
  count: number;
  /** Ação sobre o grupo inteiro — "gerar em lote", na fila. */
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 id={id} className="text-sm leading-tight font-semibold">
        {label}
      </h2>
      <GroupCount groupKey={groupKey} count={count} />
      <Separator className="flex-1" />
      {action}
    </div>
  );
}

export type ListProps = {
  projects: Project[];
  /** `null` quando a ordenação não é por data — a lista sai corrida. */
  groups: Array<DatedGroup<Project>> | null;
  tags: TagsController;
  onOpen: (project: Project) => void;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  renderGroupAction?: (group: DatedGroup<Project>) => ReactNode;
  /** Projetos marcados para ação em massa. */
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (projectId: string) => void;
} & ProjectActionHandlers;

const CARD_GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function ProjectGrid({
  projects,
  groups,
  tags,
  onOpen,
  onTagsChange,
  renderGroupAction,
  selectedIds,
  onToggleSelect,
  ...actions
}: ListProps) {
  const selecting = Boolean(selectedIds && selectedIds.size > 0);
  const cards = (list: Project[]) =>
    list.map((project) => (
      <ProjectCard
        key={project.id}
        project={project}
        tags={tags}
        onOpen={onOpen}
        onTagsChange={onTagsChange}
        selected={selectedIds?.has(project.id) ?? false}
        selecting={selecting}
        onToggleSelect={onToggleSelect}
        {...actions}
      />
    ));

  if (!groups) return <div className={CARD_GRID}>{cards(projects)}</div>;

  return (
    // Mais espaço entre grupos do que entre o título e os cards dele: é o
    // intervalo que diz onde um grupo acaba. `scroll-mt` deixa o cabeçalho
    // fixo de fora quando o resumo rola até aqui.
    <div className="space-y-8">
      {groups.map((group) => (
        <section
          key={group.key}
          id={groupAnchor(group.key)}
          aria-labelledby={`${groupAnchor(group.key)}-titulo`}
          tabIndex={-1}
          className="scroll-mt-32 space-y-3 outline-none md:scroll-mt-24"
        >
          <GroupHeading
            id={`${groupAnchor(group.key)}-titulo`}
            groupKey={group.key}
            label={group.label}
            count={group.items.length}
            action={renderGroupAction?.(group)}
          />
          <div className={CARD_GRID}>{cards(group.items)}</div>
        </section>
      ))}
    </div>
  );
}

export function ProjectTable({
  projects,
  groups,
  tags,
  onOpen,
  onTagsChange,
  renderGroupAction,
  selectedIds,
  onToggleSelect,
  ...actions
}: ListProps) {
  const selecting = Boolean(selectedIds && selectedIds.size > 0);
  const linha = (project: Project) => (
    <ProjectRow
      key={project.id}
      project={project}
      tags={tags}
      onOpen={onOpen}
      onTagsChange={onTagsChange}
      selected={selectedIds?.has(project.id) ?? false}
      selecting={selecting}
      onToggleSelect={onToggleSelect}
      {...actions}
    />
  );
  return (
    <Card className="overflow-x-auto p-0">
      {/* Largura mínima que deixa a coluna do nome legível: com menos, as
          colunas fixas tomavam tudo e o nome virava "jdre…". A tabela rola. */}
      <table className="w-full min-w-4xl text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {onToggleSelect && (
              <th className="w-8 py-2.5 pl-3">
                <span className="sr-only">Seleção</span>
              </th>
            )}
            <th className="px-4 py-2.5 text-left font-medium">Projeto</th>
            <th className="w-52 px-4 py-2.5 text-left font-medium">Etapa</th>
            <th className="w-56 px-4 py-2.5 text-left font-medium">Link e tags</th>
            <th className="w-32 px-4 py-2.5 text-left font-medium">Datas</th>
            <th className="w-px px-4 py-2.5 text-right font-medium whitespace-nowrap">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map((group) => (
                <Fragment key={group.key}>
                  {/* O mesmo título da grade, numa linha da tabela. */}
                  <tr
                    id={groupAnchor(group.key)}
                    tabIndex={-1}
                    className="scroll-mt-32 border-t bg-muted/30 outline-none md:scroll-mt-24"
                  >
                    <td colSpan={onToggleSelect ? 6 : 5} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm leading-tight font-semibold">{group.label}</span>
                        <GroupCount groupKey={group.key} count={group.items.length} />
                        <span className="ml-auto">{renderGroupAction?.(group)}</span>
                      </div>
                    </td>
                  </tr>
                  {group.items.map(linha)}
                </Fragment>
              ))
            : projects.map(linha)}
        </tbody>
      </table>
    </Card>
  );
}

/** Memoizada pelo mesmo motivo do card: ver [ProjectCard]. */
const ProjectRow = memo(function ProjectRow({
  project,
  tags,
  onOpen,
  onTagsChange,
  selected = false,
  selecting = false,
  onToggleSelect,
  ...actions
}: {
  project: Project;
  tags: TagsController;
  onOpen: (project: Project) => void;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  selected?: boolean;
  selecting?: boolean;
  onToggleSelect?: (projectId: string) => void;
} & ProjectActionHandlers) {
  const { label, collectedAt, renamed } = projectIdentity(project);
  const status = projectStatus(project);
  const isEmpty = project.fileCount === 0 && project.folderCount === 0;
  const emCurso = isInProgress(project);
  const abrir = () => (selecting && onToggleSelect ? onToggleSelect(project.id) : onOpen(project));

  return (
    <>
    <tr
      onClick={abrir}
      className={cn(
        "group cursor-pointer border-t transition hover:bg-muted/50",
        selected && "bg-info/5",
      )}
    >
      {onToggleSelect && (
        <td className="w-8 py-2 pl-3 align-top">
          <Checkbox
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => onToggleSelect(project.id)}
            aria-label={`Selecionar ${label}`}
            className={cn(
              "mt-0.5 transition-opacity",
              !selecting && !selected && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          />
        </td>
      )}
      {/* Projeto: nome, material e o que falta — o material era coluna
          própria, mas é contexto do nome, não critério de leitura. */}
      <td className="max-w-0 px-4 py-2">
        <button
          type="button"
          className="block max-w-full truncate rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          title={renamed ? `${label} · pasta: ${project.name}` : project.name}
          onClick={(event) => {
            event.stopPropagation();
            abrir();
          }}
        >
          {label}
        </button>
        <p
          className="truncate text-xs text-muted-foreground"
          title={isEmpty ? "Pasta vazia" : describeMaterial(project)}
        >
          {isEmpty ? "pasta vazia" : describeMaterial(project)}
        </p>
      </td>

      {/* Estado: o selo do card e, embaixo, o que falta. */}
      <td className="px-4 py-2">
        <StageBadge project={project} size="sm" />
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={status.detail}>
          {status.detail}
        </p>
      </td>

      {/* Largura presa: sem ela, o link do cliente (longo, com o prefixo do
          encurtador) alargava a coluna e espremia o nome do projeto até
          "deat…", empurrando as ações para fora da tabela. */}
      <td className="w-56 max-w-56 px-4 py-2">
        <div className="min-w-0 space-y-1.5">
          {(project.generations.length > 0 || isLive(project)) && (
            <ProjectSite project={project} />
          )}
          <ProjectTags project={project} tags={tags} onChange={onTagsChange} singleLine />
        </div>
      </td>

      {/* Datas: coleta e última atividade eram duas colunas para dois valores
          curtos que se leem juntos. */}
      <td className="px-4 py-2 text-xs text-muted-foreground">
        <p className="tabular-nums">
          {collectedAt
            ? collectedAt.toLocaleDateString("pt-BR")
            : formatDate(project.createdTime)}
        </p>
        <p title={`Última atividade: ${formatDate(project.lastActivity)}`}>
          {relativeTime(project.lastActivity)}
        </p>
      </td>

      <td className="px-4 py-2">
        <div className="flex justify-end">
          <ProjectActions project={project} {...actions} />
        </div>
      </td>
    </tr>
    {/* O andamento ganha uma linha inteira: na coluna do nome ele saía
        espremido ("Parad…", "Planej…"). */}
    {emCurso && (
      <tr onClick={abrir} className={cn("cursor-pointer", selected && "bg-info/5")}>
        <td colSpan={onToggleSelect ? 6 : 5} className={cn("pb-2.5 pr-4", onToggleSelect ? "pl-11" : "pl-4")}>
          <ProjectProgress project={project} className="max-w-2xl" />
        </td>
      </tr>
    )}
    </>
  );
});
