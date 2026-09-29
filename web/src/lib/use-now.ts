import { useSyncExternalStore } from "react";

/**
 * Um relógio para toda a página, que só anda enquanto alguém o observa.
 *
 * Cada card com trabalho em curso mostra o tempo decorrido; um `setInterval`
 * por card seriam dezenas de relógios. Aqui é um só, ligado quando o primeiro
 * componente se inscreve e desligado quando o último sai.
 */

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const fn of listeners) fn();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = () => now;

/** O instante atual, atualizado a cada segundo. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
