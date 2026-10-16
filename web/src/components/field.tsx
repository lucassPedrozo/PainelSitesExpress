import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Um campo de formulário: rótulo, o controle, e uma linha que é dica ou erro.
 *
 * A mensagem ocupa o mesmo espaço quando é dica e quando é erro, para o
 * formulário não pular de altura ao validar. O controle recebe
 * `aria-describedby={`${id}-message`}` de quem o monta.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="font-normal text-muted-foreground"> · obrigatório</span>}
      </Label>
      {children}
      <p
        id={`${id}-message`}
        aria-live="polite"
        className={cn("min-h-4 text-xs", error ? "text-destructive" : "text-muted-foreground")}
      >
        {error ?? hint ?? ""}
      </p>
    </div>
  );
}
