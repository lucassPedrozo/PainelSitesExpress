import type { ClaudeNextStep, ClaudeQueueItem, ClaudeRequestType, ClaudeRunStatus } from "@/lib/api";

/*
 * Os nomes que as telas do motor Claude repetem: os pedidos, as situações de
 * uma execução, a duração e a mensagem de um erro da API.
 */

export const semPermissaoDeGerar = "Esta chave de acesso não tem permissão para gerar sites";

/** O pedido, na língua de quem opera. */
export const requestLabels: Record<ClaudeRequestType, string> = {
  analisar: "Briefing",
  cliente: "Site",
  ajuste: "Ajuste",
  continuar: "Continuação",
  criticar: "Crítica",
  refinar: "Refino",
};

/**
 * De onde veio um pedido da fila: de uma pessoa, ou do painel, que o pôs na
 * fila sozinho na sequência do site que ela pediu.
 */
export const requestOrigin = (item: Pick<ClaudeQueueItem, "por" | "encadeado">): string | null =>
  item.encadeado
    ? item.por
      ? `seguiu sozinho, do pedido de ${item.por}`
      : "seguiu sozinho"
    : item.por
      ? `por ${item.por}`
      : null;

/** O que "Continuar" diz e confirma: o nome do que vai rodar de fato. */
export type ContinueTexts = {
  button: string;
  confirmTitle: string;
  /** O que acontece, em uma ou duas frases. */
  confirmBody: string;
  confirmLabel: string;
  /** O aviso de que o pedido entrou na fila. */
  queued: string;
};

/** Vale para os três: a confirmação cobre a sequência, não só a próxima execução. */
const SEGUE_SOZINHO = "Depois disso, o painel põe na fila sozinho os passos que faltam até o site ser entregue.";

/**
 * Os textos de "Continuar", pelo passo que o motor indica para o site.
 *
 * @param next o que entra na fila: a continuação, a crítica ou o refino
 * @param onde `aberta`: a etapa que ficou aberta, já na língua de quem opera;
 *   `rodada`: "rodada 1 de 2", quando o site está nas rodadas
 */
export function continueTexts(
  next: ClaudeNextStep,
  { aberta = null, rodada = null }: { aberta?: string | null; rodada?: string | null } = {},
): ContinueTexts {
  const daRodada = rodada ? ` da ${rodada}` : "";
  if (next === "criticar") {
    return {
      button: "Rodar a crítica",
      confirmTitle: "Rodar a crítica do site?",
      confirmBody: `Uma conversa nova do Claude, que não escreveu o site, avalia o resultado e aponta o que refinar: é a crítica${daRodada}. ${SEGUE_SOZINHO}`,
      confirmLabel: "Rodar a crítica e usar a assinatura",
      queued: "Crítica na fila do Claude",
    };
  }
  if (next === "refinar") {
    return {
      button: "Rodar o refino",
      confirmTitle: "Rodar o refino do site?",
      confirmBody: `O Claude retoma a conversa que escreveu o site e corrige o que a crítica${daRodada} apontou. ${SEGUE_SOZINHO}`,
      confirmLabel: "Rodar o refino e usar a assinatura",
      queued: "Refino na fila do Claude",
    };
  }
  return {
    button: aberta ? "Continuar de onde parou" : "Continuar a criação do site",
    confirmTitle: aberta ? "Continuar a geração?" : "Continuar a criação do site?",
    confirmBody: `O Claude retoma a sessão do site e segue ${aberta ? `da etapa de ${aberta}` : "de onde a criação parou"}. ${SEGUE_SOZINHO}`,
    confirmLabel: "Continuar e usar a assinatura",
    queued: "Continuação na fila do Claude",
  };
}

/**
 * O aviso do site que parou no meio da criação sem etapa aberta: a execução
 * anterior terminou, e o passo seguinte não entrou na fila sozinho.
 */
export function pausedNotice(next: ClaudeNextStep, rodada: string | null = null): { title: string; description: string } {
  if (next === "criticar") {
    return {
      title: `A criação do site parou antes da crítica${rodada ? ` · ${rodada}` : ""}`,
      description:
        "O site foi escrito e revisado, e ainda não passou pela crítica. A sequência não seguiu sozinha: rode a crítica para ele continuar até a entrega.",
    };
  }
  if (next === "refinar") {
    return {
      title: `A criação do site parou antes do refino${rodada ? ` · ${rodada}` : ""}`,
      description:
        "A crítica apontou o que corrigir, e o refino ainda não rodou. A sequência não seguiu sozinha: rode o refino para o site continuar até a entrega.",
    };
  }
  return {
    title: "A criação do site parou antes de terminar",
    description:
      "A última execução terminou sem o site chegar ao fim, e a sequência não seguiu sozinha. Continue para o Claude seguir de onde parou.",
  };
}

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
