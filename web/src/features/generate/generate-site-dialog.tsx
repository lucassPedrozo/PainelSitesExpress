import { useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Link2, PackageX, RefreshCw } from "lucide-react";
import { isPanelProject, type Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaudeBriefingForm } from "@/features/claude/claude-briefing-form";
import { useClaudeStatus } from "@/features/claude/use-claude";
import { EngineChoice, type GenerationEngine } from "./engine-choice";
import { GenerationForm } from "./generation-form";
import { ConnectionBadge } from "./result-panel";
import { LovableReturnDialog } from "./lovable-return-dialog";
import { useBuildPackage, useLovableConnection } from "./use-lovable";

/**
 * Geração do site a partir do material do projeto, pelo motor escolhido.
 *
 * **Lovable**: o prompt sai do arquivo "Informações do Site" e fica editável —
 * o que está na caixa é exatamente o que será enviado —, e os anexos saem da
 * varredura da pasta. **Claude**: o Claude Code desta máquina lê o material,
 * escreve um briefing que alguém revisa e só então gera o site.
 *
 * Nos dois, "Conferir" é um ensaio que não gasta nada; gastar pede uma
 * confirmação à parte.
 */
export function GenerateSiteDialog({
  project,
  engine = null,
  onOpenChange,
  onGenerated,
  onRequested,
}: {
  project: Project | null;
  /** O motor que já vem escolhido; sem ele, vale o padrão das Configurações. */
  engine?: GenerationEngine | null;
  onOpenChange: (open: boolean) => void;
  onGenerated: () => void;
  /** O pedido entrou na fila do Claude: é hora de mostrar o andamento. */
  onRequested: (project: Project) => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="h-[92vh] sm:max-w-[min(1180px,96vw)]">
        {project && (
          <GenerateSiteContent
            key={`${project.id}:${engine ?? ""}`}
            project={project}
            initialEngine={engine}
            onGenerated={onGenerated}
            onRequested={onRequested}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GenerateSiteContent({
  project,
  initialEngine,
  onGenerated,
  onRequested,
}: {
  project: Project;
  initialEngine: GenerationEngine | null;
  onGenerated: () => void;
  onRequested: (project: Project) => void;
}) {
  const claude = useClaudeStatus();
  const meta = projectIdentity(project);
  /** Sem pasta no Drive, o Lovable não tem de onde montar o envio. */
  const semDrive = isPanelProject(project);
  const [escolhido, setEscolhido] = useState<GenerationEngine | null>(initialEngine);

  const claudeInstalado = claude.data?.installed === true;
  const padrao: GenerationEngine =
    semDrive || (claude.data?.defaultEngine === "claude" && claudeInstalado) ? "claude" : "lovable";
  const engine = semDrive ? "claude" : (escolhido ?? padrao);
  /** Os dois à escolha só quando os dois servem a este projeto. */
  const haEscolha = !semDrive && claudeInstalado;

  return (
    <>
      {engine === "lovable" ? (
        <LovableGeneration
          project={project}
          title={`Gerar site — ${meta.label}`}
          engineChoice={haEscolha ? <EngineChoice value={engine} onChange={setEscolhido} /> : null}
          onGenerated={onGenerated}
        />
      ) : (
        <>
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-base">Gerar site — {meta.label}</DialogTitle>
              {haEscolha ? (
                <EngineChoice value={engine} onChange={setEscolhido} />
              ) : (
                <Badge variant="outline">
                  <Bot />
                  Claude
                </Badge>
              )}
            </div>
            <DialogDescription>
              O Claude Code desta máquina lê o material do projeto e escreve o briefing. Depois de revisado,
              ele gera o site, que passa por rodadas de crítica e refino antes de ser entregue. Nada é
              disparado antes da confirmação.
            </DialogDescription>
          </DialogHeader>

          {claude.isPending ? (
            <div className="grid flex-1 gap-4 p-6 lg:grid-cols-2">
              <Skeleton className="h-full min-h-64 rounded-xl" />
              <Skeleton className="h-full min-h-64 rounded-xl" />
            </div>
          ) : !claudeInstalado ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <PackageX className="size-8 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">
                {claude.data?.reason ??
                  (claude.error instanceof Error ? claude.error.message : "O motor Claude não está disponível neste painel.")}
              </p>
            </div>
          ) : (
            <ClaudeBriefingForm project={project} onRequested={onRequested} />
          )}
        </>
      )}
    </>
  );
}

function LovableGeneration({
  project,
  title,
  engineChoice,
  onGenerated,
}: {
  project: Project;
  title: string;
  engineChoice: ReactNode;
  onGenerated: () => void;
}) {
  const lovable = useLovableConnection();
  const pacote = useBuildPackage(project.id);

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {engineChoice}
          <ConnectionBadge status={lovable.status} />
          {lovable.connected && (
            <Button
              variant="link"
              size="xs"
              className="text-muted-foreground"
              onClick={() => void lovable.disconnect()}
            >
              Desconectar
            </Button>
          )}
        </div>
        <DialogDescription>
          O briefing vem do Drive e pode ser editado; o que faltar entra nas
          observações, nos anexos ou no banco de imagens. Nada é enviado ao
          Lovable antes da confirmação.
        </DialogDescription>
      </DialogHeader>

      <LovableReturnDialog connection={lovable} />

      {/* O que impede de gerar vem antes de tudo, como aviso — e não como
          uma faixa colada no cabeçalho, que parecia parte dele. */}
      {(!lovable.connected || (lovable.status?.missingScopes.length ?? 0) > 0) && (
        <div className="shrink-0 border-b px-6 py-3">
          {!lovable.connected ? (
            <Alert variant="warning">
              <Link2 />
              <AlertTitle>O painel não está conectado à sua conta do Lovable</AlertTitle>
              <AlertDescription>
                Sem a conexão dá para conferir o envio, mas não gerar.
              </AlertDescription>
              <AlertAction className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => void lovable.connect()}>
                  Conectar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void lovable.refresh()}
                  title="Reler o estado da conexão"
                  aria-label="Conferir conexão"
                >
                  <RefreshCw />
                </Button>
              </AlertAction>
            </Alert>
          ) : (
            <Alert variant="warning">
              <Link2 />
              <AlertTitle>Reconecte ao Lovable para o painel manter o workspace</AlertTitle>
              <AlertDescription>
                A conexão é de antes de o painel manter as instruções do
                workspace. Gerar continua funcionando.
              </AlertDescription>
              <AlertAction>
                <Button size="sm" variant="outline" onClick={() => void lovable.connect()}>
                  Reconectar
                </Button>
              </AlertAction>
            </Alert>
          )}
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
