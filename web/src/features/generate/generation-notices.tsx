import { ExternalLink } from "lucide-react";
import type { GenerationPlan, Project } from "@/lib/api";
import { formatBytes, formatDate, plural, pluralize } from "@/lib/format";
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

/** Gerações anteriores, da mais recente para a mais antiga — uma linha. */
export function PreviousGenerations({ project }: { project: Project }) {
  const previous = [...project.generations].reverse();
  if (previous.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        Esta coleta já gerou {pluralize(previous.length, "site")} — este será outro:
      </span>
      {previous.map((item) => {
        const href = item.previewUrl ?? item.url;
        const rotulo = `${item.displayName ?? "site"} · ${formatDate(item.createdAt)}`;
        // Sem endereço, o site aparece como texto: um link para "#" não leva a nada.
        return href ? (
          <a
            key={item.id ?? item.createdAt}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            {rotulo}
          </a>
        ) : (
          <span key={item.id ?? item.createdAt}>{rotulo}</span>
        );
      })}
    </p>
  );
}

export function PlanSummary({ plan }: { plan: GenerationPlan }) {
  const fotos = plan.stockImages.length;
  return (
    <div role="status" className="rounded-lg border border-dashed bg-background p-3 text-xs">
      <p className="font-medium">Conferido — nada foi enviado ao Lovable</p>
      <p className="mt-1 text-muted-foreground">
        {pluralize(plan.promptChars, "caractere")} de prompt e{" "}
        {pluralize(plan.attachments.length, "anexo")}
        {plan.totalBytes > 0 && ` (${formatBytes(plan.totalBytes)})`}
        {plan.unknownSizes > 0 &&
          `, ${plan.unknownSizes} com tamanho conhecido só na exportação`}
        {plan.stockZip &&
          `, mais ${plan.stockZip} com ${pluralize(fotos, "foto")} de banco ${plural(fotos, "conferida", "conferidas")} no Pixabay`}
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
  warnings = 0,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O do prompt final, com as observações — é o que de fato sai. */
  promptChars: number;
  attachments: number;
  workspaceName: string;
  /** Itens da faixa "O que vai no envio" que ainda avisam. */
  warnings?: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Criar o site no Lovable?</AlertDialogTitle>
          <AlertDialogDescription>
            {/* Não é a única ação que gasta (responder ao agente também
                gasta): a frase diz o custo desta, sem prometer exclusividade. */}
            Isto cria um projeto novo e consome créditos da sua conta do
            Lovable. Serão enviados{" "}
            {/* O número é o do prompt final, com as observações: antes esta
                linha contava só o briefing e prometia um envio menor do que
                o que de fato saía. */}
            {pluralize(promptChars, "caractere")} de prompt e{" "}
            {pluralize(attachments, "anexo")} para o workspace{" "}
            <strong>{workspaceName}</strong>.
            {warnings > 0 && (
              <>
                {" "}
                A faixa “O que vai no envio” ainda aponta{" "}
                <strong>{pluralize(warnings, "ponto")}</strong> a completar; dá para gerar
                assim mesmo.
              </>
            )}
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
