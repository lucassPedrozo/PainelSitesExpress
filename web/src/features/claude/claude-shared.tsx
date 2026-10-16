import { useState, type ReactNode } from "react";
import { ChevronRight, Lock } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { generationOffTitle, runStatusLabels, runStatusVariants } from "./claude-text";

/**
 * Um bloco da aba Claude que se consulta, e não se decide — o briefing de um
 * site já feito, as execuções. Fechado, mostra o título e uma linha do que há
 * dentro; o conteúdo continua montado, para um rascunho não se perder ao fechar.
 */
export function SectionDisclosure({
  title,
  meta,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** O que há dentro, numa linha: aparece com o bloco fechado. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-xl border", className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ChevronRight
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          {meta && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{meta}</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className="border-t px-4 py-4 data-[state=closed]:hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Como a execução terminou — o mesmo selo na lista de execuções e no resumo. */
export function RunStatusBadge({ status }: { status: ClaudeRunStatus }) {
  return <Badge variant={runStatusVariants[status]}>{runStatusLabels[status]}</Badge>;
}

/**
 * A trava de gasto desligada (`CLAUDE_ENABLE_GENERATION` ou
 * `LOVABLE_ENABLE_GENERATION`): o mesmo aviso em toda tela que gera, com o
 * motivo que o servidor dá e, quando há, o que ainda dá para fazer.
 */
export function GenerationOffNotice({
  engine = "claude",
  reason,
  children,
  className,
}: {
  engine?: keyof typeof generationOffTitle;
  reason: string | null;
  /** O que dá para fazer mesmo assim. */
  children?: ReactNode;
  className?: string;
}) {
  // O motivo do servidor abre com "A geração está desligada.", que o título já
  // diz: fica só o como ligar.
  const comoLigar = reason?.replace(/^A geração (pelo \S+ )?está desligada\.\s*/, "") || null;
  return (
    <Alert variant="warning" className={className}>
      <Lock />
      <AlertTitle>{generationOffTitle[engine]}</AlertTitle>
      {(comoLigar || children) && (
        <AlertDescription>
          {comoLigar}
          {comoLigar && children ? " " : null}
          {children}
        </AlertDescription>
      )}
    </Alert>
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
