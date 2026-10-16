import { useMemo, useState } from "react";
import { History } from "lucide-react";
import type { Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { EmptyNotice } from "@/components/page-header";
import { When } from "@/components/when";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { projectTimeline, type TimelineEvent } from "./project-timeline";
import { timelineIcons, timelineToneClass } from "./timeline-icons";

export type ActivityItem = TimelineEvent & { project: Project };

const chaveDe = (item: ActivityItem) => `${item.project.id}-${item.key}`;

/**
 * Os acontecimentos mais recentes de todos os projetos — a linha do tempo de
 * cada um, vista de uma vez. Filtrada pela data do acontecimento, e não pela
 * do projeto: uma publicação que falhou ontem num site de seis meses
 * aparece.
 */
export function recentActivity(projects: Project[], limit: number): ActivityItem[] {
  return projects
    .flatMap((project) => projectTimeline(project).map((event) => ({ ...event, project })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/** A coluna "Atividade recente" da tela Projetos. Clicar abre o projeto na linha do tempo. */
export function ActivityFeed({
  projects,
  loading,
  onOpen,
  className,
}: {
  projects: Project[];
  loading: boolean;
  onOpen: (project: Project) => void;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const items = useMemo(() => recentActivity(projects, all ? 25 : 8), [projects, all]);
  // O que já esteve na coluna. Um item que não estava (algo acabou de
  // acontecer, ou "Mostrar mais") entra deslizando; na primeira leitura,
  // nada se mexe. O estado é ajustado durante o render, quando a lista muda:
  // a marca de "novo" fica no item até a próxima mudança, e a animação não
  // é cortada no meio.
  const chaves = loading ? null : items.map(chaveDe).join("|");
  const [lida, setLida] = useState<string | null>(null);
  const [memoria, setMemoria] = useState<{ vistos: Set<string>; novos: Set<string> } | null>(null);
  if (chaves !== null && chaves !== lida) {
    setLida(chaves);
    const atuais = items.map(chaveDe);
    setMemoria((antes) =>
      antes
        ? { vistos: new Set([...antes.vistos, ...atuais]), novos: new Set(atuais.filter((chave) => !antes.vistos.has(chave))) }
        : { vistos: new Set(atuais), novos: new Set() },
    );
  }
  const novo = (item: ActivityItem) => memoria?.novos.has(chaveDe(item)) ?? false;

  return (
    <Card className={cn("gap-2 py-4", className)}>
      <h2 className="px-4 text-sm font-semibold">Atividade recente</h2>
      {loading ? (
        <div className="space-y-3 px-4 pt-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyNotice icon={<History />} title="Nada aconteceu ainda" className="py-6" />
      ) : (
        <ul className="px-2">
          {items.map((item) => {
            const Icon = timelineIcons[item.icon];
            const nome = projectIdentity(item.project).label;
            return (
              <li key={chaveDe(item)} className={cn(novo(item) && "animate-rise [--rise-from:-6px]")}>
                <button
                  type="button"
                  onClick={() => onOpen(item.project)}
                  className="grid w-full grid-icon-row items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span className={cn("grid size-8 place-items-center rounded-full", timelineToneClass[item.tone])}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui leading-snug font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={nome}>
                      {nome}
                      {item.by ? ` · ${item.by}` : ""}
                    </span>
                  </span>
                  <When at={item.at} className="pt-0.5 text-2xs text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && items.length >= 8 && (
        <Button variant="ghost" size="sm" className="mx-4" onClick={() => setAll((value) => !value)}>
          {all ? "Mostrar menos" : "Mostrar mais"}
        </Button>
      )}
    </Card>
  );
}
