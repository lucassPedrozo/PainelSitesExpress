import type { ReactNode } from "react";
import type { ClaudeRunStatus } from "@/lib/api";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { runStatusLabels, runStatusVariants } from "./claude-text";

/** Como a execução terminou — o mesmo selo na lista de execuções e no resumo. */
export function RunStatusBadge({ status }: { status: ClaudeRunStatus }) {
  return <Badge variant={runStatusVariants[status]}>{runStatusLabels[status]}</Badge>;
}

/**
 * `disabled` desliga o ponteiro do botão, e com isso o `title` dele nunca
 * chegaria à tela — justamente quando mais importa, para dizer por que a ação
 * está fora de alcance. O span recebe o hover no lugar.
 */
export function HintWhenDisabled({ reason, children }: { reason?: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <span title={reason} className="inline-flex cursor-not-allowed">
      {children}
    </span>
  );
}

/**
 * Um aviso com botão de texto. O `AlertAction` reserva, no canto, o lugar de
 * um botão de ícone: com rótulo e em tela estreita, o botão cobriria o título.
 * Aqui ele fica embaixo do texto no celular e só vai para o canto a partir de
 * `sm`, com o espaço dele reservado.
 */
export function NoticeWithAction({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <Alert
      variant="warning"
      className="has-data-[slot=alert-action]:pr-2.5 sm:has-data-[slot=alert-action]:pr-40"
    >
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      <AlertAction className="static col-start-2 mt-1.5 justify-self-start sm:absolute sm:top-2 sm:right-2 sm:mt-0">
        {action}
      </AlertAction>
    </Alert>
  );
}

/**
 * A confirmação de tudo o que dispara o Claude Code. Diz com todas as letras o
 * que acontece e o que custa — e o botão repete isso, para o clique nunca ser
 * por reflexo.
 */
export function ConfirmClaudeDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** O que vai acontecer, em uma ou duas frases. */
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {children} Isto dispara o Claude Code nesta máquina e consome a assinatura dele.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
