import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  claudeRunningItems,
  fetchClaudeEvents,
  fetchClaudeOptions,
  fetchClaudeProject,
  fetchClaudeStatus,
  type ClaudeLogLine,
  type ClaudeStatus,
} from "@/lib/api";
import { queryKeys } from "@/lib/query";

/**
 * As leituras do motor Claude. Nada aqui abre conexão: a tela consulta de
 * novo de tempos em tempos enquanto há algo rodando, como o resto do painel.
 */

/** De quanto em quanto tempo a tela relê o estado enquanto algo roda. */
const STATE_INTERVAL_MS = 4_000;
/**
 * Com a fila parada, bem mais devagar — mas nunca parado: é assim que esta
 * aba fica sabendo do pedido que outra pessoa (ou outra aba) fez.
 */
const IDLE_INTERVAL_MS = 30_000;
/** O log ao vivo, mais apertado: é texto correndo na frente de quem olha. */
const LOG_INTERVAL_MS = 2_000;
/** O que fica na tela; o stream inteiro continua guardado no servidor. */
const MAX_LOG_LINES = 2_000;

/** O motor (instalado, liberado) e a fila. */
export function useClaudeStatus() {
  return useQuery({
    queryKey: queryKeys.claudeStatus,
    queryFn: fetchClaudeStatus,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const estado = query.state.data;
      // Sem o motor nesta cópia do painel não há fila para acompanhar.
      if (!estado?.installed) return false;
      const fila = estado.queue;
      return fila.running || fila.waiting.length > 0 ? STATE_INTERVAL_MS : IDLE_INTERVAL_MS;
    },
  });
}

/** O que identifica o momento da fila: quem roda, quem espera, quem parou. */
const queueSignature = (status: ClaudeStatus) =>
  [
    status.queue.paused ? "pausada" : "livre",
    claudeRunningItems(status.queue).map((item) => item.id).join("+"),
    status.queue.waiting.map((item) => item.id).join("+"),
    status.queue.interrupted.map((item) => item.id).join("+"),
  ].join("|");

/**
 * A fila mudou sem esta aba ter feito nada — outra pessoa pediu um site, uma
 * execução terminou: a lista de projetos é relida, porque é dela que saem o
 * selo e o próximo passo de cada card.
 */
export function useClaudeQueueSync(status: ClaudeStatus | undefined) {
  const queryClient = useQueryClient();
  const assinatura = status ? queueSignature(status) : null;
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    if (assinatura === null) return;
    if (anterior.current !== null && anterior.current !== assinatura) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    }
    anterior.current = assinatura;
  }, [assinatura, queryClient]);
}

/** O projeto no motor: briefing, revisão, site e execuções. */
export function useClaudeProject(projectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.claudeProject(projectId),
    queryFn: () => fetchClaudeProject(projectId),
    enabled,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const estado = query.state.data?.project?.queue?.estado;
      return estado === "rodando" || estado === "esperando" ? STATE_INTERVAL_MS : false;
    },
  });
}

/**
 * O modelo e o esforço do projeto, o que vale no lugar do que ele não escolheu
 * e as opções do site. Relido depois de cada ação, como o resto do motor: um
 * pedido que entra na fila grava o modelo e o esforço que foram com ele.
 */
export function useClaudeOptions(projectId: string) {
  return useQuery({
    queryKey: queryKeys.claudeOptions(projectId),
    queryFn: () => fetchClaudeOptions(projectId),
    staleTime: 30_000,
  });
}

/**
 * Depois de uma ação: relê o motor, o projeto nele e a lista de projetos — é
 * por ela que o selo e o próximo passo do card mudam.
 */
export function useClaudeRefresh() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["claude"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]),
    [queryClient],
  );
}

/**
 * O log da execução em andamento, por consulta com cursor: cada resposta traz
 * só o que é novo, e nada se perde se uma consulta falhar no meio.
 *
 * @param itemId o pedido da fila que a tela quer ver
 * @param active a execução dele está rodando
 */
export function useClaudeLog(itemId: string | null, active: boolean) {
  const [lines, setLines] = useState<ClaudeLogLine[]>([]);
  /** O pedido a que as linhas guardadas pertencem. */
  const [owner, setOwner] = useState<string | null>(null);
  /**
   * A última leitura falhou. A tela diz isso — antes o erro era engolido, e um
   * log que nunca chegava ficava para sempre "esperando as primeiras linhas".
   */
  const [error, setError] = useState<unknown>(null);
  const cursor = useRef("");

  const read = useCallback(async () => {
    const data = await fetchClaudeEvents(cursor.current, itemId);
    cursor.current = data.cursor;
    const novas = data.events.flatMap((evento) => evento.legiveis);
    setOwner(data.item);
    setLines((atuais) =>
      data.reset ? novas.slice(-MAX_LOG_LINES) : novas.length ? [...atuais, ...novas].slice(-MAX_LOG_LINES) : atuais,
    );
  }, [itemId]);

  useEffect(() => {
    let parado = false;
    let relogio: number | undefined;
    const ciclo = async () => {
      try {
        await read();
        if (!parado) setError(null);
      } catch (err) {
        // Uma consulta que falha não derruba o log: a próxima traz o que
        // faltou. Enquanto isso, a tela mostra o erro.
        if (!parado) setError(err);
      }
      if (!parado && active) relogio = window.setTimeout(ciclo, LOG_INTERVAL_MS);
    };
    // Parou de rodar: uma última leitura pega o que saiu depois da anterior.
    void ciclo();
    return () => {
      parado = true;
      window.clearTimeout(relogio);
    };
  }, [active, itemId, read]);

  /** Lê de novo agora, sem esperar o próximo ciclo. */
  const retry = useCallback(() => {
    read().then(
      () => setError(null),
      (err: unknown) => setError(err),
    );
  }, [read]);

  return { lines: itemId && owner === itemId ? lines : [], error, retry };
}
