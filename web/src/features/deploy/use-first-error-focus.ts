import { useEffect, useRef, useState } from "react";
import type { ValidationErrors } from "./deploy-types";
import { fieldElementId, fieldOrder, hasAdvancedError } from "./validation";

/**
 * Leva o foco ao primeiro campo recusado — e abre a seção avançada se for
 * lá. O foco espera o commit: um campo dentro de "Opções avançadas" só
 * existe no DOM depois que a seção reabre.
 */
export function useFirstErrorFocus(
  advancedOpen: boolean,
  setAdvancedOpen: (open: boolean) => void,
) {
  const focoPendente = useRef<keyof ValidationErrors | null>(null);
  const [focoPedido, setFocoPedido] = useState(0);

  useEffect(() => {
    const field = focoPendente.current;
    if (!field) return;
    focoPendente.current = null;
    const element = document.getElementById(fieldElementId[field]);
    element?.focus();
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focoPedido, advancedOpen]);

  return (errors: ValidationErrors) => {
    const field = fieldOrder.find((key) => errors[key]);
    if (!field) return;
    if (hasAdvancedError(errors)) setAdvancedOpen(true);
    focoPendente.current = field;
    setFocoPedido((n) => n + 1);
  };
}
