import { Zap } from "lucide-react";
import { CounterCard } from "@/components/counter-card";
import { Skeleton } from "@/components/ui/skeleton";
import { plural, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WORK_GROUPS, toneClass, type WorkGroupKey } from "./stage";

/**
 * "Fazer agora": a pergunta que abre o painel, respondida em números.
 *
 * Cinco contadores do que depende de alguém da equipe (Resolver, Revisar,
 * Gerar, Criar link, Enviar ao cliente) e, numa linha discreta, três do que
 * espera o painel ou o cliente. Somados, são os projetos ativos. Cada
 * contador filtra a lista. O ritmo dos últimos dias (o que chegou, foi
 * gerado, enviado e posto no ar) mora no Dashboard: aqui ele repetia os
 * mesmos números ao lado dos contadores.
 *
 * Antes eram 19 números em tamanho de título, um por grupo da fila, e outra
 * linha com os totais do Drive.
 */
export function WorkNow({
  counts,
  active,
  onToggle,
  loading,
  unavailable = false,
  activeTotal,
}: {
  counts: Map<WorkGroupKey, number>;
  /** Quantos estão na aba Ativos — inclui os só de arquivos, que não entram em contador nenhum. */
  activeTotal: number;
  active: WorkGroupKey | null;
  onToggle: (group: WorkGroupKey) => void;
  loading: boolean;
  /** A lista não carregou: sem dado, os contadores não dizem número nenhum. */
  unavailable?: boolean;
}) {
  const acting = WORK_GROUPS.filter((group) => group.acting);
  const waiting = WORK_GROUPS.filter((group) => !group.acting);
  const pedem = acting.reduce((sum, group) => sum + (counts.get(group.key) ?? 0), 0);
  const semDado = loading || unavailable;
  const contar = (key: WorkGroupKey) => (semDado ? null : (counts.get(key) ?? 0));

  return (
    <section
      aria-labelledby="fazer-agora"
      className="grid gap-x-4 gap-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3 lg:grid-lead"
    >
      <div className="flex items-center gap-3 px-1 lg:max-w-56">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Zap className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="fazer-agora" className="text-section">
            Fazer agora
          </h2>
          {loading ? (
            <Skeleton className="mt-1 h-3.5 w-40" />
          ) : unavailable ? (
            <p className="text-xs text-muted-foreground">Sem a lista, não há o que contar.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {pedem > 0
                ? `${pluralize(pedem, "projeto")} de ${activeTotal} ${plural(pedem, "espera", "esperam")} alguém da equipe.`
                : activeTotal > 0
                  ? "Nada esperando a equipe agora."
                  : "Nenhum projeto ativo."}
            </p>
          )}
        </div>
      </div>

      {/* No celular os contadores viram um trilho que rola de lado: empilhados,
          eles empurravam o primeiro projeto para fora da primeira tela. */}
      <div className="-mx-3 flex min-w-0 gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5">
        {acting.map((group) => {
          const Icon = group.icon;
          return (
            <CounterCard
              key={group.key}
              count={contar(group.key)}
              label={group.label}
              hint={group.hint}
              icon={<Icon />}
              toneClassName={toneClass[group.tone!].soft}
              active={active === group.key}
              onClick={() => onToggle(group.key)}
              className="w-40 shrink-0 sm:w-auto"
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 lg:col-start-2">
        <span className="mr-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase">Esperando</span>
        {waiting.map((group) => {
          const count = contar(group.key);
          const on = active === group.key;
          return (
            <button
              key={group.key}
              type="button"
              aria-pressed={on}
              title={group.hint}
              onClick={() => onToggle(group.key)}
              className={cn(
                "inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors outline-none",
                "hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                on && "bg-card text-foreground ring-1 ring-primary",
              )}
            >
              <span className="font-semibold text-foreground tabular-nums">{count ?? "—"}</span>
              {group.label.toLowerCase()}
            </button>
          );
        })}
      </div>

    </section>
  );
}
