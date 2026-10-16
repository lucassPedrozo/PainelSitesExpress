import { formatDateTime, formatWhen } from "@/lib/format";
import { useMinute } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * Uma data do painel: relativa até 7 dias, absoluta depois, completa no
 * tooltip — a mesma regra em toda tela (`formatWhen`). Se atualiza a cada
 * minuto, para "há 4 min" não ficar parado. Sem data, "—".
 */
export function When({
  at,
  prefix,
  className,
}: {
  at: string | null | undefined;
  /** "atualizado", "enviado"… — fica antes da data, no mesmo elemento. */
  prefix?: string;
  className?: string;
}) {
  const now = useMinute();
  const text = formatWhen(at, now);
  if (text === "—") return <span className={className}>—</span>;
  return (
    <time dateTime={at ?? undefined} title={formatDateTime(at)} className={cn("tabular-nums", className)}>
      {prefix ? `${prefix} ${text}` : text}
    </time>
  );
}
