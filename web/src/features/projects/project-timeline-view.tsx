import { useMemo, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { Project } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { When } from "@/components/when";
import { cn } from "@/lib/utils";
import {
  formatSpan,
  projectTimeline,
  timelineSummary,
} from "./project-timeline";
import { timelineIcons, timelineToneClass } from "./timeline-icons";

/** Por que não há nome — escrito, e não num `title` que só o mouse via. */
const semRegistro = "gerações antigas, de antes de o painel guardar quem gerou";

/**
 * A linha do tempo no modal do projeto: no topo, quem gerou e quanto cada
 * trecho levou; abaixo, os acontecimentos em ordem, do recebimento ao mais
 * recente, cada um com a hora, o autor e a distância do anterior.
 */
export function ProjectTimeline({
  project,
  className,
}: {
  project: Project;
  className?: string;
}) {
  const events = useMemo(() => projectTimeline(project), [project]);
  const summary = useMemo(() => timelineSummary(project), [project]);

  return (
    <div className={cn("space-y-5", className)}>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 border-b pb-4">
        <SummaryItem label="Recebido">
          <When at={summary.receivedAt} />
        </SummaryItem>
        <SummaryItem
          label={summary.generation?.linked ? "Vinculado por" : "Responsável pela geração"}
        >
          {!summary.generation ? (
            <span className="font-normal text-muted-foreground">Site ainda não gerado</span>
          ) : summary.generation.by ? (
            summary.generation.by
          ) : (
            <span className="font-normal text-muted-foreground">
              Não registrado <span className="text-xs">({semRegistro})</span>
            </span>
          )}
        </SummaryItem>
        {summary.spans.map((span) => (
          <SummaryItem key={span.label} label={span.label}>
            <span className="tabular-nums">{formatSpan(span.ms)}</span>
          </SummaryItem>
        ))}
      </dl>

      <ol aria-label="Acontecimentos do projeto, do mais antigo ao mais recente">
        {events.map((event, index) => {
          const Icon = timelineIcons[event.icon];
          const previous = events[index - 1];
          const gap = previous ? Date.parse(event.at) - Date.parse(previous.at) : 0;
          const last = index === events.length - 1;

          return (
            <li key={event.key} className={cn("relative flex gap-3", !last && "pb-5")}>
              {/* O fio que liga um acontecimento ao seguinte. */}
              {!last && (
                <span
                  aria-hidden
                  className="absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border"
                />
              )}
              <span
                className={cn(
                  "relative grid size-7 shrink-0 place-items-center rounded-full",
                  timelineToneClass[event.tone],
                )}
              >
                <Icon className="size-3.5" />
              </span>

              <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <p className="text-sm font-medium">{event.title}</p>
                  <time
                    dateTime={event.at}
                    className="ml-auto text-xs text-muted-foreground tabular-nums"
                  >
                    {formatDateTime(event.at)}
                  </time>
                </div>

                {event.detail && (
                  <p className="text-xs break-words text-muted-foreground">{event.detail}</p>
                )}

                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {event.by ? (
                    <span>
                      por <span className="font-medium text-foreground">{event.by}</span>
                    </span>
                  ) : event.byMissing ? (
                    <span>responsável não registrado</span>
                  ) : null}
                  {event.href && (
                    <a
                      href={event.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      {event.hrefLabel ?? "abrir"}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {/* A distância do passo anterior é o que mostra onde o
                      projeto ficou parado. */}
                  {gap >= 60_000 && (
                    <span className="ml-auto tabular-nums">{formatSpan(gap)} depois</span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SummaryItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
