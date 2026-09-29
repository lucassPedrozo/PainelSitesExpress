import { AlertTriangle, Link2, RefreshCw } from "lucide-react";
import type { Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { GenerationForm } from "./generation-form";
import { ConnectionBadge } from "./result-panel";
import { LovableReturnDialog } from "./lovable-return-dialog";
import { useBuildPackage, useLovableConnection } from "./use-lovable";

/**
 * Geração do site no Lovable a partir do briefing.
 *
 * O prompt sai do arquivo "Informações do Site" e fica editável — o que está
 * na caixa é exatamente o que será enviado. Os anexos saem da varredura da
 * pasta do projeto, com as imagens já marcadas.
 *
 * "Conferir envio" é um ensaio local: não fala com o Lovable e não gasta
 * crédito. Só "Gerar site" chama `create_project`.
 */
export function GenerateSiteDialog({
  project,
  onOpenChange,
  onGenerated,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="h-[92vh] sm:max-w-[min(1180px,96vw)]">
        {project && (
          <GenerateSiteContent
            key={project.id}
            project={project}
            onGenerated={onGenerated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GenerateSiteContent({
  project,
  onGenerated,
}: {
  project: Project;
  onGenerated: () => void;
}) {
  const lovable = useLovableConnection();
  const pacote = useBuildPackage(project.id);
  const meta = projectIdentity(project);

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="text-base">
            Gerar site — {meta.label}
          </DialogTitle>
          <ConnectionBadge status={lovable.status} />
          {lovable.connected && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => void lovable.disconnect()}
            >
              Desconectar
            </Button>
          )}
        </div>
        <DialogDescription>
          O prompt vem do briefing e pode ser editado. Marque os arquivos que
          devem ir junto como anexo.
        </DialogDescription>
      </DialogHeader>

      {lovable.connected && (lovable.status?.missingScopes.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-warning/10 px-6 py-3 text-sm">
          <Link2 className="size-4 shrink-0 text-warning" />
          <span className="flex-1 min-w-48">
            A conexão com o Lovable é de antes de o painel manter as instruções
            do workspace. Reconecte para liberar essa parte — gerar continua
            funcionando.
          </span>
          <Button size="sm" variant="outline" onClick={() => void lovable.connect()}>
            Reconectar
          </Button>
        </div>
      )}

      <LovableReturnDialog connection={lovable} />

      {!lovable.connected && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-warning/10 px-6 py-3 text-sm">
          <Link2 className="size-4 shrink-0 text-warning" />
          <span className="flex-1 min-w-48">
            O painel ainda não está conectado à sua conta do Lovable.
          </span>
          <Button size="sm" variant="outline" onClick={() => void lovable.connect()}>
            Conectar ao Lovable
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void lovable.refresh()}>
            <RefreshCw className="size-4" />
            Conferir conexão
          </Button>
        </div>
      )}

      {pacote.error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            {(pacote.error as Error).message}
          </p>
          <Button variant="outline" onClick={() => void pacote.reload()}>
            Tentar novamente
          </Button>
        </div>
      ) : pacote.isPending || !pacote.data ? (
        <div className="grid flex-1 gap-4 p-6 lg:grid-cols-2">
          <Skeleton className="h-full min-h-64 rounded-xl" />
          <Skeleton className="h-full min-h-64 rounded-xl" />
        </div>
      ) : (
        <GenerationForm
          project={project}
          pkg={pacote.data}
          connected={lovable.connected}
          workspaces={lovable.workspaces}
          onGenerated={onGenerated}
        />
      )}
    </>
  );
}
