import type { ClaudeRequestType, ClaudeRunStatus } from "@/lib/api";

/*
 * Os nomes que as telas do motor Claude repetem: os pedidos, as situações de
 * uma execução, a duração e a mensagem de um erro da API.
 */

export const semPermissaoDeGerar = "Esta chave de acesso não tem permissão para gerar sites";

/** O pedido, na língua de quem opera. */
export const requestLabels: Record<ClaudeRequestType, string> = {
  analisar: "Briefing",
  cliente: "Site",
  briefing: "Site",
  ajuste: "Ajuste",
  continuar: "Continuação",
};

export const runStatusLabels: Record<ClaudeRunStatus, string> = {
  rodando: "Rodando",
  sucesso: "Concluída",
  falha: "Falhou",
  cancelada: "Cancelada",
  aguardando_aprovacao: "Esperando aprovação",
  interrompida: "Interrompida",
};

export const runStatusVariants: Record<
  ClaudeRunStatus,
  "info" | "success" | "destructive" | "outline" | "warning"
> = {
  rodando: "info",
  sucesso: "success",
  falha: "destructive",
  cancelada: "outline",
  aguardando_aprovacao: "warning",
  interrompida: "warning",
};

/** A mensagem de um erro da API, ou um texto genérico quando não há. */
export const errorMessage = (err: unknown, fallback = "Tente novamente.") =>
  err instanceof Error && err.message ? err.message : fallback;

/** "3 min 12 s" a partir dos milissegundos de uma execução; `null` sem o dado. */
export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return null;
  const total = Math.max(0, Math.round(ms / 1000));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return minutos > 0 ? `${minutos} min ${String(segundos).padStart(2, "0")} s` : `${segundos} s`;
}

/**
 * A ESTIMATIVA DO CLAUDE CODE de uma execução: o que ela custaria a preço de
 * API. O consumo de verdade sai da assinatura, e este número nunca é somado a
 * outro custo — por isso o rótulo vai sempre junto.
 */
export const formatEstimate = (usd: number | null | undefined) =>
  typeof usd === "number" ? `estimativa do Claude Code: US$ ${usd.toFixed(2)}` : null;
