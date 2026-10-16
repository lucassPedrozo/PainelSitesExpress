import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * O indicador da escolha atual que desliza até a nova escolha, em vez de
 * pular: o sublinhado da seção no cabeçalho, o fundo da aba ativa. Diz "você
 * estava ali, agora está aqui" — continuidade, não enfeite.
 *
 * O contêiner é `relative`; a opção ativa leva `data-indicator-active`. O
 * indicador mede a opção ativa e se põe embaixo (ou atrás) dela por
 * transform. Na primeira medida ele aparece já no lugar; só as trocas
 * seguintes deslizam. Com "reduzir movimento", troca de lugar sem viajar.
 */
export function useSlidingIndicator<T extends HTMLElement>(active: string | null) {
  const containerRef = useRef<T>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const [animar, setAnimar] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const medir = () => {
      const alvo = container.querySelector<HTMLElement>('[data-indicator-active="true"]');
      setBox(alvo && alvo.offsetWidth > 0 ? { left: alvo.offsetLeft, width: alvo.offsetWidth } : null);
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    // O contêiner muda de largura (tela, contadores que crescem): mede de novo.
    const observer = new ResizeObserver(medir);
    observer.observe(container);
    for (const filho of container.children) observer.observe(filho);
    return () => observer.disconnect();
  }, [active]);

  // Só depois da primeira medida pintada o indicador passa a deslizar.
  useEffect(() => {
    if (!box || animar) return;
    const quadro = requestAnimationFrame(() => setAnimar(true));
    return () => cancelAnimationFrame(quadro);
  }, [box, animar]);

  return { containerRef, box, animar };
}

export function SlidingIndicator({
  box,
  animar,
  inset = 0,
  className,
}: {
  box: { left: number; width: number } | null;
  animar: boolean;
  /** Quanto o indicador recua de cada lado da opção (o sublinhado é mais curto que o botão). */
  inset?: number;
  className?: string;
}) {
  if (!box) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0",
        animar && "transition-[transform,width] duration-300 ease-arrive motion-reduce:transition-none",
        className,
      )}
      style={{ width: Math.max(0, box.width - inset * 2), transform: `translateX(${box.left + inset}px)` }}
    />
  );
}
