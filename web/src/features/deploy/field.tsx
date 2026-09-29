import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A mensagem ocupa o mesmo espaço quando é dica e quando é erro, para o
 * formulário não pular de altura ao validar.
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p
        id={`${id}-message`}
        aria-live="polite"
        className={cn(
          "text-xs",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ?? hint ?? " "}
      </p>
    </div>
  );
}
