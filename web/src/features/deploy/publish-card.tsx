import { CheckCircle2, Loader2, PlayCircle, ShieldAlert } from "lucide-react";
import type { PublicationResult } from "@/lib/api/deploy";
import { usePermissions } from "@/lib/permissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StepBadge } from "./step-badge";
import { Switch } from "@/components/ui/switch";

type PublishCardProps = {
  canDeploy: boolean;
  dryRun: boolean;
  busy: boolean;
  isDispatching: boolean;
  publicationResult: PublicationResult | null;
  onDeploy: () => void;
  onDryRunChange: (value: boolean) => void;
};

/**
 * O estado precisa estar escrito na tela. Antes ele vivia no `title` de um
 * botão desabilitado — invisível no toque e lido pelo leitor de tela como se
 * fosse o nome do botão.
 */
function Readiness({ canDeploy }: { canDeploy: boolean }) {
  if (!canDeploy) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="size-3.5 shrink-0" />
        O workflow de deploy ainda não existe neste repositório. Use{" "}
        <b className="font-medium">Salvar configuração</b> primeiro.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-xs text-success">
      <CheckCircle2 className="size-3.5 shrink-0" />
      Workflow de deploy pronto para ser disparado.
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
  dryRun,
  busy,
  isDispatching,
  publicationResult,
  onDeploy,
  onDryRunChange,
}: PublishCardProps) {
  const podePublicar = usePermissions().can("publicar");

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <StepBadge>2</StepBadge>
          <CardTitle>Publicar</CardTitle>
        </div>
        <CardDescription>
          Dispara o workflow de deploy na branch padrão do repositório.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <Label
          htmlFor="dry-run"
          className="flex items-start gap-3 rounded-lg border p-3"
        >
          <Switch
            id="dry-run"
            checked={dryRun}
            disabled={busy}
            onCheckedChange={onDryRunChange}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">
              Simular envio (dry-run)
            </span>
            <span className="block text-xs font-normal text-muted-foreground">
              Roda build, detecção da pasta e conexão FTP sem gravar nada na
              hospedagem.
            </span>
          </span>
        </Label>

        <Readiness canDeploy={canDeploy} />

        {publicationResult && (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>
              Workflows gravados em {publicationResult.workflowBranch}
            </AlertTitle>
            <AlertDescription>
              <p>
                {publicationResult.workflowStatuses
                  .map(
                    (item) =>
                      `${item.path} (${workflowActionLabel[item.action]})`,
                  )
                  .join(" · ")}
              </p>
              {publicationResult.secretNames.length > 0 && (
                <p>Secrets: {publicationResult.secretNames.join(", ")}</p>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter>
        {/* O span segura o hover: um botão desabilitado não recebe ponteiro,
            e o motivo nunca chegaria à tela. */}
        <span
          title={
            podePublicar
              ? undefined
              : "Esta chave de acesso não tem permissão para publicar sites"
          }
          className="inline-flex"
        >
          <Button
            type="button"
            size="lg"
            onClick={onDeploy}
            disabled={!canDeploy || busy || !podePublicar}
          >
            {isDispatching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            {isDispatching
              ? "Enviando..."
              : dryRun
                ? "Simular publicação"
                : "Publicar agora"}
          </Button>
        </span>
      </CardFooter>
    </Card>
  );
}
