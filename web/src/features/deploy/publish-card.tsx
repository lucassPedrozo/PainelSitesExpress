import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, PlayCircle, ShieldAlert } from "lucide-react";
import type { PublicationResult } from "@/lib/api/deploy";
import { noPermission, usePermissions } from "@/lib/permissions";
import { Reason } from "@/components/disabled-hint";
import { SectionCard } from "@/components/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "./error-message";
import { StepBadge } from "./step-badge";

type PublishCardProps = {
  canDeploy: boolean;
  /** A leitura de `.github/workflows` está em andamento. */
  isCheckingWorkflow: boolean;
  /** A leitura falhou: não dá para dizer se o workflow existe. */
  workflowError: unknown;
  onRetryWorkflow: () => void;
  dryRun: boolean;
  busy: boolean;
  isDispatching: boolean;
  publicationResult: PublicationResult | null;
  onDeploy: () => void;
  onDryRunChange: (value: boolean) => void;
  /**
   * O número do passo, só quando o formulário está aberto ao lado (passo 1).
   * Nesse caso o cartão também fica rebaixado: a ação principal da vez é
   * salvar a configuração, e "Publicar agora" vira contornado.
   */
  step?: number;
};

/**
 * O estado precisa estar escrito na tela. Antes ele vivia no `title` de um
 * botão desabilitado — invisível no toque e lido pelo leitor de tela como se
 * fosse o nome do botão. E "o workflow não existe" só é dito quando a
 * leitura respondeu: uma falha ao ler é outra coisa, com outra saída.
 */
function Readiness({
  canDeploy,
  isChecking,
  error,
  onRetry,
}: {
  canDeploy: boolean;
  isChecking: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (canDeploy) {
    return (
      <p className="flex items-center gap-2 text-xs text-success">
        <CheckCircle2 className="size-3.5 shrink-0" />
        Workflow de deploy pronto para ser disparado.
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span className="min-w-0">
          Não foi possível conferir o workflow de deploy
          {errorMessage(error) ? `: ${errorMessage(error)}` : "."}
        </span>
        <Button type="button" variant="link" size="xs" className="px-0" disabled={isChecking} onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (isChecking) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        Conferindo o workflow de deploy no repositório…
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldAlert className="size-3.5 shrink-0" />
      <span>
        O workflow de deploy ainda não existe neste repositório. Use{" "}
        <b className="font-medium">Salvar configuração</b> primeiro.
      </span>
    </p>
  );
}

const workflowActionLabel = {
  created: "criado",
  updated: "atualizado",
  unchanged: "sem mudança",
} as const;

export function PublishCard({
  canDeploy,
  isCheckingWorkflow,
  workflowError,
  onRetryWorkflow,
  dryRun,
  busy,
  isDispatching,
  publicationResult,
  onDeploy,
  onDryRunChange,
  step,
}: PublishCardProps) {
  const podePublicar = usePermissions().can("publicar");
  // A simulação é opção de quem confere, não do caso de todo dia: fica em
  // "Mais opções", aberta de saída só se já estiver ligada (o rótulo do
  // botão também muda para "Simular publicação").
  const [maisOpcoesAbertas] = useState(dryRun);

  return (
    <SectionCard
      icon={step ? <StepBadge>{step}</StepBadge> : undefined}
      title="Publicar"
      description="Dispara o workflow de deploy na branch padrão do repositório; o resultado aparece nas execuções e no selo do projeto."
    >
      <div className="space-y-4">
        <Readiness
          canDeploy={canDeploy}
          isChecking={isCheckingWorkflow}
          error={workflowError}
          onRetry={onRetryWorkflow}
        />

        {publicationResult && (
          <Alert variant="success">
            <CheckCircle2 />
            <AlertTitle>Configuração gravada em {publicationResult.workflowBranch}</AlertTitle>
            <AlertDescription className="space-y-1">
              <span className="block">Secrets e workflows atualizados no repositório.</span>
              {/* Caminhos e nomes de secret servem a quem investiga, não a
                  quem publica: ficam recolhidos. */}
              <details className="text-xs">
                <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
                  Detalhes técnicos
                </summary>
                <ul className="mt-1.5 space-y-0.5 pl-3">
                  {publicationResult.workflowStatuses.map((item) => (
                    <li key={item.path} className="truncate" title={item.path}>
                      {item.path} ({workflowActionLabel[item.action]})
                    </li>
                  ))}
                  {publicationResult.secretNames.length > 0 && (
                    <li>Secrets: {publicationResult.secretNames.join(", ")}</li>
                  )}
                </ul>
              </details>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            type="button"
            variant={step ? "outline" : "default"}
            onClick={onDeploy}
            disabled={!canDeploy || busy || !podePublicar}
          >
            {isDispatching ? <Loader2 className="animate-spin" /> : <PlayCircle />}
            {isDispatching
              ? "Enviando..."
              : dryRun
                ? "Simular publicação"
                : "Publicar agora"}
          </Button>
          {!podePublicar && <Reason className="basis-full">{noPermission.publicar}</Reason>}
        </div>

        <details open={maisOpcoesAbertas} className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            Mais opções
          </summary>
          <Label
            htmlFor="dry-run"
            className="mt-2 flex items-start gap-3 rounded-lg border p-3"
          >
            <Switch
              id="dry-run"
              checked={dryRun}
              disabled={busy}
              onCheckedChange={onDryRunChange}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">
                Simular envio (dry-run)
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                Roda build, detecção da pasta e conexão FTP sem gravar nada na
                hospedagem.
              </span>
            </span>
          </Label>
        </details>
      </div>
    </SectionCard>
  );
}
