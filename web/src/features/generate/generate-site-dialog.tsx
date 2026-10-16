import { useState, type ReactNode } from "react";
import { Link2, MoreHorizontal, PackageX, RefreshCw, Unlink } from "lucide-react";
import { isPanelProject, type Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaudeBriefingForm } from "@/features/claude/claude-briefing-form";
import { useClaudeStatus } from "@/features/claude/use-claude";
import { EngineChoice, type GenerationEngine } from "./engine-choice";
import { GenerationForm } from "./generation-form";
import { ConnectionBadge } from "./result-panel";
import { LovableReturnDialog } from "./lovable-return-dialog";
import { useBuildPackage, useLovableConnection } from "./use-lovable";
import { ClaudeIcon } from "@/components/brand-icons";

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
      <DialogContent layout="sectioned" className="h-dialog-tall sm:max-w-6xl">
        {project && (
          <GenerateSiteContent
            key={`${project.id}:${engine ?? ""}`}
            project={project}
            initialEngine={engine}
            onGenerated={onGenerated}
            onRequested={onRequested}
            onClose={() => onOpenChange(false)}
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
  onClose,
}: {
  project: Project;
  initialEngine: GenerationEngine | null;
  onGenerated: () => void;
  onRequested: (project: Project) => void;
  onClose: () => void;
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
          onClose={onClose}
        />
      ) : (
        <>
          {/* O que este diálogo dispara no Claude é o briefing: o site vem
              depois, da revisão. O título diz isso, e não "gerar site". */}
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>Gerar o briefing com o Claude — {meta.label}</DialogTitle>
              {haEscolha ? (
                <EngineChoice value={engine} onChange={setEscolhido} />
              ) : (
                <Badge variant="outline">
                  <ClaudeIcon />
                  Claude
                </Badge>
              )}
            </div>
            <DialogDescription>
              O Claude lê o material marcado e escreve o briefing; o site só é gerado depois da sua revisão.
            </DialogDescription>
          </DialogHeader>

          {claude.isPending ? (
            <div className="grid flex-1 gap-4 p-6 lg:grid-cols-2">
              <Skeleton className="h-full min-h-64 rounded-xl" />
              <Skeleton className="h-full min-h-64 rounded-xl" />
            </div>
          ) : claude.error && !claude.data ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <ErrorNotice
                title="Não foi possível ler o motor Claude"
                error={claude.error}
                onRetry={() => void claude.refetch()}
              />
            </div>
          ) : !claudeInstalado ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyNotice
                icon={<PackageX />}
                title="O motor Claude não está disponível neste painel"
                description={claude.data?.reason ?? undefined}
              />
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
  onClose,
}: {
  project: Project;
  title: string;
  engineChoice: ReactNode;
  onGenerated: () => void;
  onClose: () => void;
}) {
  const lovable = useLovableConnection();
  const pacote = useBuildPackage(project.id);

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle>{title}</DialogTitle>
          {engineChoice}
          {/* Só o "conectado": desconectado, o aviso logo abaixo já diz. */}
          <ConnectionBadge status={lovable.status} />
          {/* Desconectar é raro e não é o que se veio fazer aqui: fica no
              menu "⋯", longe do título e dos botões de gerar. */}
          {lovable.connected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Mais opções da conexão com o Lovable">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Conectado à sua conta do Lovable
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void lovable.disconnect()}>
                  <Unlink />
                  Desconectar do Lovable
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <DialogDescription>
          O briefing vem do Drive e pode ser editado; nada é enviado ao Lovable antes da confirmação.
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
                  size="icon-sm"
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
        <div className="flex flex-1 items-center justify-center p-6">
          <ErrorNotice
            title="Não foi possível montar o envio"
            error={pacote.error}
            onRetry={() => void pacote.reload()}
          />
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
          onClose={onClose}
        />
      )}
    </>
  );
}
