import { ExternalLink } from "lucide-react";
import type { GenerationPlan, Project } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/*
 * Os avisos em volta do envio: sites que a coleta já gerou, o resultado da
 * conferência e a confirmação do gasto de crédito.
 */

/** Gerações anteriores, da mais recente para a mais antiga. */
export function PreviousGenerations({ project }: { project: Project }) {
  const previous = [...project.generations].reverse();
  if (previous.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-xs">
      <p className="font-medium">
        Esta coleta já gerou {previous.length}{" "}
        {previous.length === 1 ? "site" : "sites"}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {previous.map((item) => (
          <a
            key={item.id ?? item.createdAt}
            href={item.previewUrl ?? item.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            {item.displayName ?? "site"} ·{" "}
            {new Date(item.createdAt).toLocaleDateString("pt-BR")}
          </a>
        ))}
      </div>
    </div>
  );
}

export function PlanSummary({ plan }: { plan: GenerationPlan }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
      <p className="font-medium">Conferido — nada foi enviado ao Lovable</p>
      <p className="mt-1 text-muted-foreground">
        {plan.promptChars.toLocaleString("pt-BR")} caracteres de prompt e{" "}
        {plan.attachments.length} anexo(s)
        {plan.totalBytes > 0 && ` (${formatBytes(plan.totalBytes)})`}
        {plan.unknownSizes > 0 &&
          `, ${plan.unknownSizes} com tamanho conhecido só na exportação`}
        .
      </p>
    </div>
  );
}

export function ConfirmGenerationDialog({
  open,
  onOpenChange,
  promptChars,
  attachments,
  workspaceName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O do prompt final, com as observações — é o que de fato sai. */
  promptChars: number;
  attachments: number;
  workspaceName: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Criar o site no Lovable?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta é a única ação do painel que consome créditos da sua conta do
            Lovable. Serão enviados{" "}
            {/* O número é o do prompt final, com as observações: antes esta
                linha contava só o briefing e prometia um envio menor do que
                o que de fato saía. */}
            {promptChars.toLocaleString("pt-BR")} caracteres de prompt e{" "}
            {attachments} anexo(s) para o workspace{" "}
            <strong>{workspaceName}</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Gerar e consumir créditos
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
