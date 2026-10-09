import { useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  CheckCheck,
  ClipboardCopy,
  ExternalLink,
  FilePen,
  FolderOpen,
  Eye,
  Globe,
  History,
  Link2,
  Replace,
  Loader2,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  PencilLine,
  RefreshCw,
  Rocket,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { isPanelProject, type Project } from "@/lib/api";
import { isClaudeSite } from "@/features/projects/project-status";
import { usePermissions } from "@/lib/permissions";
import { copyBrief } from "@/features/projects/copy-brief";
import {
  lovableEditorUrl,
  nextStep,
  stepPermission,
  type NextStep,
} from "@/features/projects/next-step";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ProjectActionHandlers = {
  /**
   * A tela de geração: prompt, anexos do Drive e imagens de banco para
   * conferir antes de gastar crédito.
   */
  onGenerate: (project: Project) => void;
  onReply: (project: Project) => void;
  onPublish: (project: Project) => void;
  onRename: (project: Project) => void;
  /** Abre o projeto com o campo do Share preview em foco. */
  onCreateLink: (project: Project) => void;
  onSendToClient: (project: Project) => Promise<void>;
  onVerifyLink: (project: Project) => Promise<void>;
  /**
   * Publica na área de aprovação agora, mesmo com link de visualização já
   * criado. Ausente quando a área não está configurada no .env.
   */
  onPublishToApprovalArea?: (project: Project) => Promise<void>;
  /** Vincula um site feito fora do painel (Lovable à mão ou outro repositório). */
  onLinkSite?: (project: Project) => void;
  /** Troca o projeto do Lovable do site (refeito num projeto novo). */
  onChangeProject?: (project: Project) => void;
  /** Mostra só as coletas deste domínio — o card usa quando há mais de uma. */
  onFindDomain?: (domain: string) => void;
  /** Abre o projeto na linha do tempo: o que aconteceu, quando e por quem. */
  onShowTimeline?: (project: Project) => void;
  /** Projeto criado no painel: manda o código do site ao GitHub. */
  onPushSite?: (project: Project) => void;
  /** Projeto criado no painel: abre os arquivos dele. */
  onOpenFiles?: (project: Project) => void;
  /** Projeto criado no painel: exclui, depois de confirmar. */
  onDeleteProject?: (project: Project) => void;
  /**
   * Abre o projeto na aba do Claude: acompanhar a execução, revisar o
   * briefing, aprovar a direção, ver o erro, pedir um ajuste.
   */
  onOpenClaude?: (project: Project) => void;
  /** Abre a tela de geração já no motor Claude. */
  onGenerateWithClaude?: (project: Project) => void;
  /** Manda ao GitHub o site que o Claude gerou e validou. */
  onPushClaudeSite?: (project: Project) => void;
};

const semPermissao = "Esta chave de acesso não tem permissão para isto";

const icons: Record<string, LucideIcon> = {
  Gerar: Sparkles,
  Responder: MessageSquareReply,
  "Criar link": Link2,
  "Novo link": Link2,
  "Verificar link": RefreshCw,
  "Enviar ao cliente": Send,
  Publicar: Rocket,
  "Publicar prévia": Eye,
  "Ver erro": TriangleAlert,
  "Abrir site": Globe,
  "Abrir no Drive": FolderOpen,
  "Enviar ao GitHub": Upload,
  "Abrir arquivos": FolderOpen,
};

/** Os passos que abrem a aba do Claude: o mesmo rótulo do card, com o ícone do que se vai fazer lá. */
const claudeIcons: Record<string, LucideIcon> = {
  Acompanhar: Activity,
  "Revisar e gerar": Sparkles,
  "Corrigir briefing": FilePen,
  "Aprovar direção": CheckCheck,
  "Ver erro": TriangleAlert,
  "Retomar ou descartar": RotateCcw,
};

/**
 * `disabled` desliga o ponteiro do botão (`disabled:pointer-events-none`), e com
 * isso o `title` dele nunca chegaria à tela — justamente quando mais importa,
 * para dizer por que a ação está fora de alcance. O span recebe o hover no lugar.
 */
function HintWhenDisabled({
  reason,
  children,
}: {
  reason?: string;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <span title={reason} className="inline-flex cursor-not-allowed">
      {children}
    </span>
  );
}

/**
 * A barra de ações do card e da linha da lista: o próximo passo à vista e o
 * resto no menu.
 *
 * Antes eram Prompt, Gerar e Publicar sempre, na mesma ordem — e o passo que
 * a etapa pedia muitas vezes não estava entre eles. O botão agora muda com a
 * etapa, mas fica sempre no mesmo lugar, o primeiro da barra.
 */
export function ProjectActions({
  project,
  onGenerate,
  onReply,
  onPublish,
  onRename,
  onCreateLink,
  onSendToClient,
  onVerifyLink,
  onPublishToApprovalArea,
  onLinkSite,
  onChangeProject,
  onShowTimeline,
  onPushSite,
  onOpenFiles,
  onDeleteProject,
  onOpenClaude,
  onGenerateWithClaude,
  onPushClaudeSite,
  stepInView = false,
}: {
  project: Project;
  /**
   * O destino do próximo passo já está na tela (a aba do Claude aberta, com os
   * botões dela): o botão daqui não teria o que fazer, e some. O menu fica.
   */
  stepInView?: boolean;
} & ProjectActionHandlers) {
  const { can } = usePermissions();
  const [busy, setBusy] = useState(false);
  const step = nextStep(project);
  const editor = lovableEditorUrl(project);
  const hasSite = project.generations.length > 0;
  const site = project.generations.at(-1);
  /** Criado no painel: sem pasta no Drive, sem geração pelo Lovable. */
  const fromPanel = isPanelProject(project);
  const inApprovalArea = Boolean(site?.devArea?.repoFullName && site.devArea.state !== "retired");

  const permission = stepPermission[step.kind];
  const allowed = !permission || can(permission);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const act = (current: NextStep) => {
    switch (current.kind) {
      case "generate":
        // Sempre a tela de conferência: o envio direto (só uma confirmação)
        // pulava a revisão do prompt e dos anexos, e era por ela que se
        // escolhiam as fotos. O envio em lote continua na barra de seleção.
        return onGenerate(project);
      case "reply":
        return onReply(project);
      case "publish":
        return onPublish(project);
      case "approval":
        if (onPublishToApprovalArea) return void run(() => onPublishToApprovalArea(project));
        return;
      case "send":
        return void run(() => onSendToClient(project));
      case "verify-link":
        return void run(() => onVerifyLink(project));
      case "create-link":
        // O editor abre em outra aba; ao voltar, o painel já está com o
        // projeto aberto e o campo de colar em foco.
        if (current.href) window.open(current.href, "_blank", "noopener,noreferrer");
        return onCreateLink(project);
      case "push-site":
        return onPushSite?.(project);
      case "files":
        return onOpenFiles?.(project);
      case "claude":
        return onOpenClaude?.(project);
      case "push-claude":
        return onPushClaudeSite?.(project);
      case "link":
        if (current.href) window.open(current.href, "_blank", "noopener,noreferrer");
    }
  };

  const Icon =
    step.kind === "claude" ? (claudeIcons[step.label] ?? Bot) : (icons[step.label] ?? ExternalLink);
  const unavailable =
    (step.kind === "link" && !step.href) || (step.kind === "approval" && !onPublishToApprovalArea);

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {!stepInView && (
        <HintWhenDisabled
          reason={
            !allowed
              ? semPermissao
              : unavailable
                ? step.kind === "approval"
                  ? "A área de aprovação não está configurada. Preencha-a em Configurações → Área de aprovação."
                  : "A execução ainda não apareceu no GitHub — o painel confere sozinho."
                : undefined
          }
        >
          <Button
            size="sm"
            variant={
              step.kind === "link" || step.kind === "files" || (step.kind === "claude" && step.label === "Acompanhar")
                ? "outline"
                : "default"
            }
            disabled={!allowed || busy || unavailable}
            onClick={() => act(step)}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Icon />}
            {step.label}
          </Button>
        </HintWhenDisabled>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Mais ações de ${project.alias ?? project.name}`}
            title="Mais ações"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {fromPanel && onPushSite && step.kind !== "push-site" && (
            <DropdownMenuItem
              onSelect={() => onPushSite(project)}
              disabled={!can("publicar")}
              title={
                can("publicar")
                  ? "Manda o código do site, guardado nos arquivos do projeto, para o repositório no GitHub."
                  : semPermissao
              }
            >
              <Upload />
              {hasSite ? "Atualizar o site no GitHub" : "Enviar site ao GitHub"}
            </DropdownMenuItem>
          )}
          {step.kind !== "generate" && !fromPanel && (
            <DropdownMenuItem
              onSelect={() => onGenerate(project)}
              disabled={!can("gerar")}
              title={can("gerar") ? undefined : semPermissao}
            >
              <Sparkles />
              {hasSite ? "Gerar outro site" : "Gerar"}
            </DropdownMenuItem>
          )}
          {/* Sem pasta no Drive o Lovable não tem de onde montar o envio; o
              Claude lê os arquivos enviados ao painel. */}
          {fromPanel && onGenerateWithClaude && (
            <DropdownMenuItem
              onSelect={() => onGenerateWithClaude(project)}
              disabled={!can("gerar")}
              title={
                can("gerar")
                  ? "O Claude lê os arquivos do projeto, escreve o briefing e, depois de revisado, gera o site."
                  : semPermissao
              }
            >
              <Bot />
              Gerar site com o Claude
            </DropdownMenuItem>
          )}
          {isClaudeSite(site) && onOpenClaude && step.kind !== "claude" && (
            <DropdownMenuItem
              onSelect={() => onOpenClaude(project)}
              title="Abre o site no motor Claude: pedir ajuste, validar, ver as telas e o histórico."
            >
              <PencilLine />
              Ajustar com o Claude
            </DropdownMenuItem>
          )}
          {(project.claude || fromPanel) && onOpenClaude && !isClaudeSite(site) && step.kind !== "claude" && (
            <DropdownMenuItem onSelect={() => onOpenClaude(project)}>
              <Bot />
              Abrir no Claude
            </DropdownMenuItem>
          )}
          {hasSite && step.kind !== "publish" && (
            <DropdownMenuItem
              onSelect={() => onPublish(project)}
              disabled={!can("publicar")}
              title={can("publicar") ? undefined : semPermissao}
            >
              <Rocket />
              Publicar
            </DropdownMenuItem>
          )}
          {onPublishToApprovalArea && site?.id && (
            <DropdownMenuItem
              onSelect={() => void run(() => onPublishToApprovalArea(project))}
              disabled={!can("publicar") || busy}
              title={
                can("publicar")
                  ? "Publica o site numa pasta da área de aprovação; o link do cliente passa a ser ela."
                  : semPermissao
              }
            >
              <Eye />
              {inApprovalArea ? "Publicar de novo na área de aprovação" : "Publicar na área de aprovação"}
            </DropdownMenuItem>
          )}
          {onChangeProject && site?.id && (
            <DropdownMenuItem
              onSelect={() => onChangeProject(project)}
              disabled={!can("gerar")}
              title={
                can("gerar")
                  ? "O site foi refeito num projeto novo do Lovable: aponta o site para ele, mantendo o link do cliente."
                  : semPermissao
              }
            >
              <Replace />
              {site.id.startsWith("ext-") ? "Definir projeto do Lovable" : "Trocar projeto do Lovable"}
            </DropdownMenuItem>
          )}
          {onLinkSite && (
            <DropdownMenuItem
              onSelect={() => onLinkSite(project)}
              disabled={!can("gerar")}
              title={
                can("gerar")
                  ? "Liga um site feito fora do painel — no Lovable ou em outro repositório — a este projeto."
                  : semPermissao
              }
            >
              <Link2 />
              {hasSite ? "Vincular outro site existente" : "Vincular site existente"}
            </DropdownMenuItem>
          )}
          {project.brief && (
            <DropdownMenuItem onSelect={() => void copyBrief(project)}>
              <ClipboardCopy />
              Copiar prompt
            </DropdownMenuItem>
          )}
          {editor && (
            <DropdownMenuItem asChild>
              <a href={editor} target="_blank" rel="noreferrer">
                <ExternalLink />
                Abrir no Lovable
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {onShowTimeline && (
            <DropdownMenuItem onSelect={() => onShowTimeline(project)}>
              <History />
              Linha do tempo
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => onRename(project)}
            disabled={!can("organizar")}
            title={can("organizar") ? undefined : semPermissao}
          >
            <Pencil />
            Renomear no painel
          </DropdownMenuItem>
          {!fromPanel && (
            <DropdownMenuItem asChild>
              <a href={project.webViewLink} target="_blank" rel="noreferrer">
                <FolderOpen />
                Abrir no Drive
              </a>
            </DropdownMenuItem>
          )}
          {fromPanel && onDeleteProject && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDeleteProject(project)}
              disabled={!can("organizar")}
              title={can("organizar") ? undefined : semPermissao}
            >
              <Trash2 />
              Excluir projeto
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
