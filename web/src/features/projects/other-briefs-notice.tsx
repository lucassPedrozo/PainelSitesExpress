import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aviso de que a pasta tem mais de um "Informações do Site" — o cliente
 * preencheu o formulário de novo. O painel usa o mais recente; sem o aviso,
 * ninguém saberia que havia uma escolha a conferir.
 */
export function OtherBriefsNotice({
  others,
  className,
}: {
  others: number;
  className?: string;
}) {
  if (others <= 0) return null;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs text-warning",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      {others === 1
        ? "Há outro arquivo “Informações do Site” nesta pasta. Este é o mais recente — confira se é o certo."
        : `Há outros ${others} arquivos “Informações do Site” nesta pasta. Este é o mais recente — confira se é o certo.`}
    </p>
  );
}
