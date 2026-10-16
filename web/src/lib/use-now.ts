import { useSyncExternalStore } from "react";

/**
 * Relógios para toda a página, que só andam enquanto alguém os observa.
 *
 * Cada card com trabalho em curso mostra o tempo decorrido; um `setInterval`
 * por card seriam dezenas de relógios. Aqui há dois — um por segundo, para os
 * cronômetros, e um por minuto, para as datas relativas ("há 4 min") —, cada
 * um ligado quando o primeiro componente se inscreve e desligado quando o
 * último sai.
 */
function clock(intervalMs: number) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let now = Date.now();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!timer) {
      now = Date.now();
      timer = setInterval(() => {
        now = Date.now();
        for (const fn of listeners) fn();
      }, intervalMs);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  };
  const snapshot = () => now;
  return { subscribe, snapshot };
}

const seconds = clock(1000);
const minutes = clock(30_000);

/** O instante atual, atualizado a cada segundo. */
export function useNow(): number {
  return useSyncExternalStore(seconds.subscribe, seconds.snapshot, seconds.snapshot);
}

/** O instante atual, atualizado a cada meio minuto — para datas relativas. */
export function useMinute(): number {
  return useSyncExternalStore(minutes.subscribe, minutes.snapshot, minutes.snapshot);
}
