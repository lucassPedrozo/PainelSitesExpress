import { Eye, FolderPlus, Globe } from "lucide-react";
import type { ReactNode } from "react";
import type { Project } from "@/lib/api";
import { formatDate, projectIdentity, timeOf } from "@/lib/format";
import { GoogleDriveIcon } from "@/components/brand-icons";
import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { nextStep } from "./next-step";
import { approvalUrlOf, siteUrlOf } from "./site-engine";

/**
 * Os dois endereços do projeto, sempre no mesmo lugar da linha: o domínio
 * principal e o link de aprovação do cliente. São secundários ao botão do
 * passo, e por isso discretos — sem caixa, no tom de apoio. Sem o endereço, o
 * botão fica cinza e não responde; o motivo vem no título e para o leitor de
 * tela. Quando o próprio botão do passo já abre o endereço (um site no ar:
 * "Abrir site"), ele não se repete aqui.
 */
export function ProjectLinks({
  project,
  layout = "stack",
  className,
}: {
  project: Project;
  /**
   * `stack`: um sob o outro, na largura do botão do passo (a tabela).
   * `row`: lado a lado, dividindo a linha (o cartão do celular).
   */
  layout?: "stack" | "row";
  className?: string;
}) {
  const passo = nextStep(project);
  const jaNoPasso = passo.kind === "link" ? passo.href : null;
  const site = siteUrlOf(project);
  const aprovacao = approvalUrlOf(project);
  const largura = layout === "stack" ? "w-step" : "w-full";
  return (
    <div
      className={cn("grid gap-1", layout === "stack" ? "w-step" : "grid-cols-2 gap-2", className)}
      onClick={(event) => event.stopPropagation()}
    >
      {!(site && site === jaNoPasso) && (
        <LinkButton href={site} icon={<Globe />} reason="Este projeto ainda não tem domínio." width={largura}>
          Abrir site
        </LinkButton>
      )}
      {!(aprovacao && aprovacao === jaNoPasso) && (
        <LinkButton href={aprovacao} icon={<Eye />} reason="Este projeto ainda não tem área de aprovação." width={largura}>
          Abrir área de aprovação
        </LinkButton>
      )}
    </div>
  );
}

function LinkButton({
  href,
  icon,
  reason,
  width,
  children,
}: {
  href: string | null;
  icon: ReactNode;
  reason: string;
  width: string;
  children: ReactNode;
}) {
  if (!href) {
    return (
      <DisabledHint reason={reason}>
        <Button variant="ghost" size="xs" disabled className={cn(width, "justify-center text-muted-foreground")}>
          {icon}
          {children}
          <span className="sr-only">: {reason}</span>
        </Button>
      </DisabledHint>
    );
  }
  return (
    <Button asChild variant="ghost" size="xs" className={cn(width, "justify-center text-muted-foreground hover:text-foreground")}>
      <a href={href} target="_blank" rel="noreferrer" title={href}>
        {icon}
        {children}
      </a>
    </Button>
  );
}

/**
 * A linha de apoio do projeto: de onde ele veio e quando, e o material.
 * "Recebida no Drive em 09/10/2026 · 4 arquivos · com briefing", com a marca do
 * Drive; ou "Criado no painel em 15/10/2026 · 4 arquivos". A data é a corrigida
 * à mão, quando há; senão a do nome da pasta; senão a da criação.
 */
export function ProjectOrigin({
  project,
  material,
  className,
}: {
  project: Project;
  /** O material em poucas palavras ("4 arquivos", "com briefing"); a frase inteira vai no título. */
  material?: { main: string; sub: string | null; full: string };
  className?: string;
}) {
  const doPainel = project.source === "panel";
  const recebido = projectIdentity(project).collectedAt ?? (timeOf(project.createdTime) !== null ? new Date(project.createdTime) : null);
  const quando = recebido ? formatDate(recebido) : null;
  const origem = doPainel
    ? `Criado no painel${quando ? ` em ${quando}` : ""}`
    : `Recebida no Drive${quando ? ` em ${quando}` : ""}`;
  const texto = [origem, material?.main, material?.sub].filter(Boolean).join(" · ");
  const titulo = [doPainel ? "Projeto criado no painel" : "Pasta do Google Drive", quando, material?.full].filter(Boolean).join(" · ");
  return (
    <p className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)} title={titulo}>
      {doPainel ? <FolderPlus className="size-3.5 shrink-0" aria-hidden /> : <GoogleDriveIcon className="size-3.5" />}
      <span className="truncate">{texto}</span>
    </p>
  );
}
