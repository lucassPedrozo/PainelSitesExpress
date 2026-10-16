import { createElement, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCheck,
  ClipboardCopy,
  ExternalLink,
  Eye,
  EyeOff,
  FilePen,
  FolderOpen,
  Globe,
  History,
  Layers,
  Link2,
  Loader2,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  PencilLine,
  Play,
  RefreshCw,
  Replace,
  Rocket,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { isPanelProject, type Project } from "@/lib/api";
import type { AccessPermission } from "@shared/access-permissions.js";
import { isExternalSite } from "@shared/external-site.js";
import { isClaudeSite } from "@/features/projects/project-status";
import { usePermissions } from "@/lib/permissions";
import { copyBrief } from "@/features/projects/copy-brief";
import {
  nextStep,
  stepPermission,
  stepUnavailableReason,
  type NextStep,
} from "@/features/projects/next-step";
import { latestLovableSite, lovableUrlOf, repoOf, repoUrlOf } from "@/features/projects/site-engine";
import { ClaudeIcon, GitHubIcon, GoogleDriveIcon, LovableIcon, type IconComponent } from "@/components/brand-icons";
import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ProjectActionHandlers = {
  /**
   * A tela de geração: prompt, anexos do Drive e imagens de banco para
   * conferir antes de gastar crédito.
   */
  onGenerate: (project: Project) => void;
  onReply: (project: Project) => void;
  onPublish: (project: Project) => void;
  /** Abre a edição do projeto: domínio, nome, etapa, data, responsável e observação. */
  onEdit: (project: Project) => void;
  /** Oculta o projeto, ou mostra de novo um oculto. */
  onToggleHidden?: (project: Project) => void;
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
  /** Mostra só as coletas deste domínio. */
  onFindDomain?: (domain: string) => void;
  /** Abre outro projeto pelo id — a coleta do mesmo domínio que tem o site. */
  onOpenProjectById?: (projectId: string) => void;
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

/** Por que esta chave não pode — o mesmo texto em toda tela. */
export const noPermission: Record<AccessPermission, string> = {
  organizar: "Sua chave de acesso não pode organizar projetos.",
  gerar: "Sua chave de acesso não pode gerar nem alterar sites.",
  publicar: "Sua chave de acesso não pode publicar.",
  configurar: "Sua chave de acesso não pode mudar as configurações.",
  administrar: "Sua chave de acesso não pode administrar chaves.",
};

const icons: Record<string, IconComponent> = {
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
  "Abrir no Drive": GoogleDriveIcon,
  "Enviar ao GitHub": GitHubIcon,
  "Abrir arquivos": FolderOpen,
  "Abrir coleta do site": Layers,
  "Conectar GitHub": GitHubIcon,
  Acompanhar: Activity,
};

/** Os passos que abrem a aba do Claude: o ícone do que se vai fazer lá. */
const claudeIcons: Record<string, IconComponent> = {
  Acompanhar: Activity,
  "Revisar e gerar": Sparkles,
  "Corrigir briefing": FilePen,
  "Aprovar direção": CheckCheck,
  Continuar: Play,
  "Ver erro": TriangleAlert,
  "Retomar ou descartar": RotateCcw,
};

const stepIcon = (step: NextStep): IconComponent => {
  if (step.kind === "claude") return claudeIcons[step.label] ?? ClaudeIcon;
  // Acompanhar o agente do Lovable leva a marca dele.
  if (step.what === "Acompanhar o Lovable") return LovableIcon;
  return icons[step.label] ?? ExternalLink;
};

/**
 * Por que o botão do passo está fora de alcance agora, ou `null`: falta de
 * permissão, ou um endereço que ainda não existe. É o mesmo texto que a
 * coluna "Próximo passo" escreve, para quem não tem hover.
 */
export function useStepBlock(project: Project, approvalAreaReady: boolean) {
  const { can } = usePermissions();
  const step = nextStep(project);
  const permission = stepPermission[step.kind];
  if (permission && !can(permission)) return { step, reason: noPermission[permission] };
  return { step, reason: stepUnavailableReason(step, approvalAreaReady) };
}

/**
 * As ações de um projeto: o próximo passo à vista, num botão só, e o resto no
 * menu "⋯", em grupos.
 *
 * O botão muda com a etapa mas fica sempre no mesmo lugar. Preenchido quando
 * o passo depende de alguém agora; contornado quando quem anda é o painel ou
 * o cliente; vermelho quando o projeto está com problema.
 */
export function ProjectActions({
  project,
  onGenerate,
  onReply,
  onPublish,
  onEdit,
  onToggleHidden,
  onCreateLink,
  onSendToClient,
  onVerifyLink,
  onPublishToApprovalArea,
  onLinkSite,
  onChangeProject,
  onShowTimeline,
  onPushSite,
  onOpenFiles,
  onOpenProjectById,
  onDeleteProject,
  onOpenClaude,
  onGenerateWithClaude,
  onPushClaudeSite,
  stepInView = false,
  size = "sm",
  uniform = false,
  below,
  className,
}: {
  project: Project;
  /**
   * O destino do próximo passo já está na tela (a aba do Claude aberta, com os
   * botões dela): o botão daqui não teria o que fazer, e some. O menu fica.
   */
  stepInView?: boolean;
  size?: "sm" | "default";
  /**
   * Na lista: o botão do passo tem sempre a mesma largura, com o rótulo
   * centralizado — um embaixo do outro, as bordas batem e o "⋯" fica sempre
   * no mesmo lugar.
   */
  uniform?: boolean;
  /**
   * O que vai sob o botão do passo, na largura dele (os endereços, na
   * tabela): fica no mesmo bloco do botão, e as bordas batem sem conta de
   * margem.
   */
  below?: ReactNode;
  className?: string;
} & ProjectActionHandlers) {
  const { can } = usePermissions();
  const [busy, setBusy] = useState(false);
  const { step, reason } = useStepBlock(project, Boolean(onPublishToApprovalArea));
  // O site do Lovable mais recente, mesmo com um do Claude depois dele: o
  // projeto continua lá, e o menu é o caminho até ele.
  const lovableSite = latestLovableSite(project);
  const editor = lovableSite ? lovableUrlOf(lovableSite) : null;
  // O repositório do site atual (ou o da publicação), quando ele já foi ao GitHub.
  const repo = repoOf(project);
  const repoUrl = repoUrlOf(project);
  const hasSite = project.generations.length > 0;
  const site = project.generations.at(-1);
  /** Criado no painel: sem pasta no Drive, sem geração pelo Lovable. */
  const fromPanel = isPanelProject(project);
  const inApprovalArea = Boolean(site?.devArea?.repoFullName && site.devArea.state !== "retired");

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
        // Sempre a tela de conferência: é por ela que se escolhem as fotos e
        // se vê o que vai no envio. O envio em lote continua na seleção.
        return onGenerate(project);
      case "generate-claude":
        return (onGenerateWithClaude ?? onGenerate)(project);
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
      case "open-collection":
        return onOpenProjectById?.(current.projectId);
      case "claude":
        return onOpenClaude?.(project);
      case "push-claude":
        return onPushClaudeSite?.(project);
      case "link":
        if (current.href) window.open(current.href, "_blank", "noopener,noreferrer");
    }
  };

  const variant = step.variant === "primary" ? "default" : step.variant;

  /** Um item do menu que pode estar fora de alcance: o motivo fica escrito embaixo. */
  const item = (
    key: string,
    icon: ReactNode,
    label: string,
    onSelect: () => void,
    {
      permission,
      title,
      disabled = false,
      destructive = false,
    }: { permission?: AccessPermission; title?: string; disabled?: boolean; destructive?: boolean } = {},
  ) => {
    const blocked = permission && !can(permission) ? noPermission[permission] : null;
    return (
      <DropdownMenuItem
        key={key}
        onSelect={onSelect}
        disabled={Boolean(blocked) || disabled}
        variant={destructive ? "destructive" : "default"}
        title={title}
        className="items-start"
      >
        <span className="mt-0.5 [&_svg]:size-4">{icon}</span>
        <span className="min-w-0">
          <span className="block">{label}</span>
          {blocked && <span className="block text-xs text-muted-foreground">{blocked}</span>}
        </span>
      </DropdownMenuItem>
    );
  };

  const siteItems = [
    fromPanel && onPushSite && step.kind !== "push-site"
      ? item("push-site", <GitHubIcon />, hasSite ? "Atualizar o site no GitHub" : "Enviar site ao GitHub", () => onPushSite(project), {
          permission: "publicar",
          title: "Manda o código do site, guardado nos arquivos do projeto, para o repositório no GitHub.",
        })
      : null,
    step.kind !== "generate" && !fromPanel
      ? item("generate", <Sparkles />, hasSite ? "Gerar outro site" : "Gerar", () => onGenerate(project), { permission: "gerar" })
      : null,
    fromPanel && onGenerateWithClaude && step.kind !== "generate-claude"
      ? item("claude-generate", <ClaudeIcon />, "Gerar site com o Claude", () => onGenerateWithClaude(project), {
          permission: "gerar",
          title: "O Claude lê os arquivos do projeto, escreve o briefing e, depois de revisado, gera o site.",
        })
      : null,
    isClaudeSite(site) && onOpenClaude && step.kind !== "claude"
      ? item("claude-adjust", <PencilLine />, "Ajustar com o Claude", () => onOpenClaude(project), {
          title: "Pedir ajuste, validar, ver as telas e o histórico do site.",
        })
      : null,
    (project.claude || fromPanel) && onOpenClaude && !isClaudeSite(site) && step.kind !== "claude"
      ? item("claude-open", <ClaudeIcon />, "Abrir no Claude", () => onOpenClaude(project))
      : null,
    hasSite && step.kind !== "publish"
      ? item("publish", <Rocket />, "Publicar no domínio", () => onPublish(project), { permission: "publicar" })
      : null,
    onPublishToApprovalArea && site?.id && step.kind !== "approval"
      ? item(
          "approval",
          <Eye />,
          inApprovalArea ? "Publicar de novo na área de aprovação" : "Publicar na área de aprovação",
          () => void run(() => onPublishToApprovalArea(project)),
          {
            permission: "publicar",
            disabled: busy,
            title: "Publica o site numa pasta da área de aprovação; o link do cliente passa a ser ela.",
          },
        )
      : null,
    onChangeProject && site?.id
      ? item(
          "change",
          <Replace />,
          isExternalSite(site) ? "Definir projeto do Lovable" : "Trocar projeto do Lovable",
          () => onChangeProject(project),
          {
            permission: "gerar",
            title: "O site foi refeito num projeto novo do Lovable: aponta o site para ele, mantendo o link do cliente.",
          },
        )
      : null,
    onLinkSite
      ? item("link-site", <Link2 />, hasSite ? "Vincular outro site existente" : "Vincular site existente", () => onLinkSite(project), {
          permission: "gerar",
          title: "Liga um site feito fora do painel — no Lovable ou em outro repositório — a este projeto.",
        })
      : null,
  ].filter(Boolean);

  const projectItems = [
    onShowTimeline ? item("timeline", <History />, "Linha do tempo", () => onShowTimeline(project)) : null,
    item("edit", <Pencil />, "Editar informações", () => onEdit(project), { permission: "organizar" }),
    onToggleHidden
      ? project.details?.hidden
        ? item("unhide", <Eye />, "Mostrar de novo", () => onToggleHidden(project), { permission: "organizar" })
        : item("hide", <EyeOff />, "Ocultar projeto", () => onToggleHidden(project), {
            permission: "organizar",
            title: "Tira o projeto da lista, dos contadores, do Dashboard e do relatório. Ele volta pela aba Ocultos.",
          })
      : null,
    project.brief ? item("copy-brief", <ClipboardCopy />, "Copiar prompt", () => void copyBrief(project)) : null,
    fromPanel && onDeleteProject
      ? item("delete", <Trash2 />, "Excluir projeto", () => onDeleteProject(project), { permission: "organizar", destructive: true })
      : null,
  ].filter(Boolean);

  const openItems = [
    editor ? (
      <DropdownMenuItem key="lovable" asChild>
        <a href={editor} target="_blank" rel="noreferrer">
          <LovableIcon />
          Abrir no Lovable
        </a>
      </DropdownMenuItem>
    ) : null,
    repoUrl ? (
      <DropdownMenuItem key="github" asChild>
        <a href={repoUrl} target="_blank" rel="noreferrer" title={repo ?? undefined}>
          <GitHubIcon />
          Abrir repositório no GitHub
        </a>
      </DropdownMenuItem>
    ) : null,
    !fromPanel && project.webViewLink && step.label !== "Abrir no Drive" ? (
      <DropdownMenuItem key="drive" asChild>
        <a href={project.webViewLink} target="_blank" rel="noreferrer">
          <GoogleDriveIcon />
          Abrir no Drive
        </a>
      </DropdownMenuItem>
    ) : null,
  ].filter(Boolean);

  return (
    <div
      className={cn("flex min-w-0 justify-end", uniform ? "items-start gap-2" : "items-center gap-1", className)}
      onClick={(event) => event.stopPropagation()}
    >
      {!stepInView && (
        <div className={cn("min-w-0", below != null && "w-step space-y-1.5")}>
          <DisabledHint reason={reason}>
            <Button
              size={size}
              variant={variant}
              disabled={Boolean(reason) || busy}
              onClick={() => act(step)}
              className={cn(uniform && "w-step justify-center")}
            >
              {busy ? <Loader2 className="animate-spin" /> : createElement(stepIcon(step))}
              {step.label}
            </Button>
          </DisabledHint>
          {below}
        </div>
      )}
      {/* Na lista, um fio separa o passo do menu: o botão faz o próximo passo,
          o "⋯" guarda o resto. Na tabela (com os endereços embaixo) ele é igual
          ao fio das colunas: sobe os 16px do recuo da célula até a linha de
          cima e tem os mesmos 44px (`cell-divider`), terminando na base do
          botão. No cartão do celular, sem linha de cima, fica na altura do
          botão, centrado nele. */}
      {uniform && !stepInView && (
        <span
          aria-hidden
          className={cn(
            "w-px shrink-0 bg-border",
            below != null ? "-mt-4 h-11" : "mt-1 h-5 pointer-coarse:mt-3",
          )}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={size === "sm" ? "icon-sm" : "icon"}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Mais ações de ${project.alias ?? project.name}`}
            title="Mais ações"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {siteItems.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Site</DropdownMenuLabel>
              {siteItems}
            </DropdownMenuGroup>
          )}
          {siteItems.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projeto</DropdownMenuLabel>
            {projectItems}
          </DropdownMenuGroup>
          {openItems.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Abrir em</DropdownMenuLabel>
                {openItems}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
