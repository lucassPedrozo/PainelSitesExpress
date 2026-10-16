import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O motivo de um controle desabilitado, ao passar o mouse.
 *
 * `disabled` desliga o ponteiro do botão, e com isso o `title` dele nunca
 * chegaria à tela. O invólucro recebe o hover no lugar. Isto é o reforço: o
 * motivo também precisa estar escrito perto do controle (`Reason`), porque no
 * toque e no teclado não há hover.
 */
export function DisabledHint({ reason, children }: { reason?: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <span title={reason} className="inline-flex cursor-not-allowed">
      {children}
    </span>
  );
}

/**
 * Por que algo não está disponível, escrito: "Sua chave não pode publicar",
 * "A área de aprovação não está configurada". Vai ao lado do botão, no
 * rodapé do diálogo ou sob o item do menu.
 */
export function Reason({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
