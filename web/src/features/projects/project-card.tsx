import { memo, type ReactNode } from "react";
import { StageBadge } from "@/features/projects/stage-badge";
import type { Project } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import {
  describeMaterial,
  formatBytes,
  formatDate,
  kindLabels,
  projectIdentity,
  relativeTime,
} from "@/lib/format";
import {
  clientUrlOf,
  isLive,
  latestGeneration,
  projectStatus,
} from "@/features/projects/project-status";
import { FileIcon } from "@/components/file-icon";
import {
  ProjectActions,
  type ProjectActionHandlers,
} from "@/features/projects/project-actions";
import { ProjectSite } from "@/features/projects/project-site";
import { ProjectProgress } from "@/features/projects/project-progress-view";
import { progressOf } from "@/features/projects/project-progress";
import { ProjectTags } from "@/features/projects/project-tags";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * O card do projeto.
 *
 * Antes eram cinco faixas com padding próprio — título, ícones de tipo, tags,
 * site e rodapé —, e nada dizia de relance em que pé o projeto estava: o
 * estado vivia espalhado num chip, dois ícones e uma caixa de seleção. Agora
 * há três zonas e **um** selo de estado, no canto do título, onde o olho passa
 * primeiro.
 *
 * Memoizado: abrir um projeto muda estado que vive no `App`, e sem isto os
 * 60+ cards re-renderizavam junto — cada um com o seu seletor de tags e menu.
 */
export const ProjectCard = memo(function ProjectCard({
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
  /** Marcado para uma ação em massa. */
  selected?: boolean;
  /** Há seleção em curso: a caixa fica sempre à vista, e o clique marca. */
  selecting?: boolean;
  onToggleSelect?: (projectId: string) => void;
} & ProjectActionHandlers) {
  const { label, domain, collectedAt, renamed } = projectIdentity(project);
  const status = projectStatus(project);
  const site = latestGeneration(project);
  const isEmpty = project.fileCount === 0 && project.folderCount === 0;
  const temLink = isLive(project) || Boolean(site && clientUrlOf(site));
  const emAndamento = progressOf(project) !== null;
  // Com seleção em curso, clicar marca — como numa lista de arquivos. Sem
  // ela, abre o projeto.
  const abrir = () => (selecting && onToggleSelect ? onToggleSelect(project.id) : onOpen(project));

  // Os ícones de tipo desceram para a linha de contexto. Como uma faixa
  // própria eles eram três números sem rótulo, repetindo em resolução menor a
  // contagem que já estava escrita acima.
  const kinds = Object.entries(project.kinds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Card
      onClick={abrir}
      className={cn(
        "group h-full cursor-pointer gap-0 overflow-hidden p-0 transition",
        "hover:border-foreground/20 hover:shadow-md",
        selected && "border-info ring-2 ring-info/30",
        status.attention && "ring-1 ring-inset ring-warning/20",
        (status.stage === "link-broken" ||
          status.stage === "delivered-broken" ||
          status.stage === "deploy-failed") &&
          "ring-destructive/30",
      )}
    >
      {/*
        Zona de conteúdo: o título com o selo de estado e, embaixo, **sempre
        os mesmos seis campos**, cada um numa linha de altura fixa. Campo sem
        informação fica em cinza dizendo isso, em vez de sumir — antes cada
        card tinha um desenho diferente conforme o que existia, e cards lado a
        lado não se alinhavam. Com as linhas fixas, todos têm a mesma altura.
      */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* ---- Identidade e estado --------------------------------------- */}
        {/*
          O título começa na mesma coluna dos rótulos abaixo. A caixa de
          seleção fica à direita, antes do selo: invisível até o mouse passar,
          ela ocupava o começo da linha e empurrava o título para dentro.
        */}
        <div className="flex h-6 items-center gap-2">
          {/* O card inteiro responde ao clique, mas é este botão que entra
              na ordem do teclado: sem ele, abrir um projeto exigia mouse. */}
          <h3 className="min-w-0 flex-1">
            <button
              type="button"
              className="relative block max-w-full truncate rounded-sm text-left text-[0.9375rem] leading-tight font-semibold after:absolute after:inset-x-0 after:-inset-y-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              title={renamed ? `${label} · pasta: ${project.name}` : project.name}
              onClick={(event) => {
                event.stopPropagation();
                abrir();
              }}
            >
              {label}
            </button>
          </h3>
          {onToggleSelect && (
            <Checkbox
              checked={selected}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => onToggleSelect(project.id)}
              aria-label={`Selecionar ${label}`}
              className={cn(
                "shrink-0 transition-opacity",
                !selecting && !selected && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            />
          )}
          <StageBadge project={project} size="sm" className="max-w-[45%]" />
        </div>

        {/* ---- Os campos, sempre os mesmos ------------------------------- */}
        <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-3 text-xs">
          <Field label="Coleta">
            <span className="truncate tabular-nums" title={isEmpty ? "Pasta vazia" : describeMaterial(project)}>
              {collectedAt
                ? collectedAt.toLocaleDateString("pt-BR")
                : `criada em ${formatDate(project.createdTime)}`}
              {!isEmpty && ` · ${formatBytes(project.totalSize)}`}
            </span>
          </Field>

          <Field label="Arquivos">
            {kinds.length > 0 ? (
              <span className="inline-flex min-w-0 items-center gap-x-2 overflow-hidden" title={describeMaterial(project)}>
                {kinds.map(([kind, count]) => (
                  <span
                    key={kind}
                    className="inline-flex shrink-0 items-center gap-0.5"
                    title={`${count} ${kindLabels[kind as never]}`}
                  >
                    <FileIcon kind={kind as never} className="size-3" />
                    <span className="tabular-nums">{count}</span>
                  </span>
                ))}
              </span>
            ) : (
              <Empty>Pasta vazia</Empty>
            )}
          </Field>

          <Field label="Domínio">
            {domain ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate" title={domain}>{domain}</span>
                {project.domain && project.domainCollections > 1 && (
                  <button
                    type="button"
                    className="relative inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-2xs text-muted-foreground transition-colors after:absolute after:-inset-x-1 after:-inset-y-2 hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    title={`${project.domain} tem ${project.domainCollections} coletas. Clique para ver só as deste domínio.`}
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.onFindDomain?.(project.domain!);
                    }}
                  >
                    {project.domainCollections} coletas
                  </button>
                )}
              </span>
            ) : (
              <Empty>{project.source === "panel" ? "Sem domínio no nome do projeto" : "Sem domínio no nome da pasta"}</Empty>
            )}
          </Field>

          <Field label="Site">
            {temLink ? (
              <ProjectSite project={project} inline className="min-w-0 flex-1" />
            ) : (
              <Empty>
                {site
                  ? "Link do cliente ainda não criado"
                  : project.source === "panel"
                    ? "Nenhum site enviado ao GitHub"
                    : "Nenhum site gerado"}
              </Empty>
            )}
          </Field>

          <Field label="Tags">
            <ProjectTags project={project} tags={tags} onChange={onTagsChange} singleLine className="flex-1" />
          </Field>

          {/* Com algo rodando, o andamento; senão, o que falta — a frase da
              etapa, que antes só aparecia ao passar o mouse sobre o selo. */}
          <Field label={emAndamento ? "Andamento" : "Próximo"}>
            {emAndamento ? (
              <ProjectProgress project={project} compact />
            ) : (
              <span
                className={cn("truncate", status.attention ? "text-foreground" : "text-muted-foreground")}
                title={status.detail}
              >
                {status.detail}
              </span>
            )}
          </Field>
        </dl>
      </div>

      {/* ---- Ações ----------------------------------------------------- */}
      <div className="flex items-center gap-1 border-t bg-muted/30 px-2 py-1.5">
        <ProjectActions project={project} {...actions} />
        {/*
          Sem `shrink-0`: se ainda faltar espaço, quem cede é o carimbo de
          tempo, truncando. O card tem `overflow-hidden`, então antes disso ele
          simplesmente era cortado pela borda, sem aviso.
        */}
        <span
          className="ml-auto min-w-0 truncate px-1 text-2xs text-muted-foreground"
          title={`Última atividade ${project.source === "panel" ? "nos arquivos" : "no Drive"}: ${formatDate(project.lastActivity)}`}
        >
          {/* Sem rótulo, "há 6 dias" competia com a data da coleta, logo acima. */}
          atividade {relativeTime(project.lastActivity)}
        </span>
      </div>
    </Card>
  );
});

/**
 * Uma linha de campo do card: rótulo à esquerda, valor numa linha só. Todas
 * têm a mesma altura — inclusive o andamento, cujas duas linhas compactas
 * (título e barra) cabem nela —, então o ritmo vertical é um só.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="truncate text-2xs text-muted-foreground">{label}</dt>
      <dd className="flex h-7 min-w-0 items-center">{children}</dd>
    </>
  );
}

/** O campo existe, mas não há o que mostrar nele. */
function Empty({ children }: { children: ReactNode }) {
  return <span className="truncate pr-0.5 text-muted-foreground italic">{children}</span>;
}
