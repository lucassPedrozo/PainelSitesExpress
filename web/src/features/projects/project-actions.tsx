import { useState, type ReactNode } from "react";
import {
  ClipboardCopy,
  ExternalLink,
  FolderOpen,
  Eye,
  Globe,
  Link2,
  Replace,
  Loader2,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Project } from "@/lib/api";
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
  /** O diálogo completo, com prompt e anexos editáveis. */
  onGenerate: (project: Project) => void;
  /** O envio padrão, com uma confirmação — só para quem tem briefing. */
  onQuickGenerate: (project: Project) => void;
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
  onQuickGenerate,
  onReply,
  onPublish,
  onRename,
  onCreateLink,
  onSendToClient,
  onVerifyLink,
  onPublishToApprovalArea,
  onLinkSite,
  onChangeProject,
}: { project: Project } & ProjectActionHandlers) {
  const { can } = usePermissions();
  const [busy, setBusy] = useState(false);
  const step = nextStep(project);
  const editor = lovableEditorUrl(project);
  const hasSite = project.generations.length > 0;
  const site = project.generations.at(-1);
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
        // Sem briefing não há envio padrão: o diálogo completo pede a
        // descrição do site.
        return project.brief ? onQuickGenerate(project) : onGenerate(project);
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
      case "link":
        if (current.href) window.open(current.href, "_blank", "noopener,noreferrer");
    }
  };

  const Icon = icons[step.label] ?? ExternalLink;
  const unavailable =
    (step.kind === "link" && !step.href) || (step.kind === "approval" && !onPublishToApprovalArea);

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
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
          variant={step.kind === "link" ? "outline" : "default"}
          disabled={!allowed || busy || unavailable}
          onClick={() => act(step)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
          {step.label}
        </Button>
      </HintWhenDisabled>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Mais ações de ${project.alias ?? project.name}`}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {step.kind !== "generate" && (
            <DropdownMenuItem
              onSelect={() => onGenerate(project)}
              disabled={!can("gerar")}
              title={can("gerar") ? undefined : semPermissao}
            >
              <Sparkles />
              {hasSite ? "Gerar outro site" : "Gerar"}
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
          <DropdownMenuItem
            onSelect={() => onRename(project)}
            disabled={!can("organizar")}
            title={can("organizar") ? undefined : semPermissao}
          >
            <Pencil />
            Renomear no painel
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={project.webViewLink} target="_blank" rel="noreferrer">
              <FolderOpen />
              Abrir no Drive
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
