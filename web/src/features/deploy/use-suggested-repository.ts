import { useEffect, useMemo, useRef, useState } from "react";
import type { Publication, RepoOption } from "@/lib/api/deploy";
import {
  suggestRepository,
  type PublishTarget,
  type RepositorySuggestion,
} from "./publish-target";

type Options = {
  /** Publicação aberta a partir de um projeto do Drive. */
  target: PublishTarget | null;
  onTargetConsumed: () => void;
  repos: RepoOption[];
  /** Publicações por domínio: se a coleta já foi publicada, o repositório é certo. */
  publishedByDomain: Map<string, Publication>;
};

/**
 * O repositório que a coleta sugere, quando a tela foi aberta a partir de um
 * projeto — e o motivo da sugestão, que a tela escreve embaixo do seletor.
 * Antes o motivo ia num toast, que sumia antes de a pessoa decidir.
 */
export function useSuggestedRepository({
  target,
  onTargetConsumed,
  repos,
  publishedByDomain,
}: Options) {
  /**
   * O alvo é lido na montagem: o painel só abre esta tela já com ele, e
   * segurá-lo aqui evita que o `null` seguinte (quando o App o esquece) apague
   * a sugestão da tela.
   */
  const [alvo] = useState(target);

  /**
   * Repositório sugerido pela coleta, enquanto ninguém escolheu outro. Fica
   * derivado, e não copiado para o estado: a lista chega depois da tela.
   */
  const sugestao: RepositorySuggestion | null = useMemo(
    () => (alvo ? suggestRepository(repos, publishedByDomain, alvo) : null),
    [alvo, repos, publishedByDomain],
  );

  /** O App esquece o alvo assim que ele é entregue a esta tela. */
  const entregue = useRef(false);
  useEffect(() => {
    if (entregue.current || !target) return;
    entregue.current = true;
    onTargetConsumed();
  }, [onTargetConsumed, target]);

  return { target: alvo, suggestion: sugestao, suggested: sugestao?.repo ?? null };
}
