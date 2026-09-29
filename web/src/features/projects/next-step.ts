import type { Project } from "@/lib/api";
import type { AccessPermission } from "@shared/access-permissions.js";
import { devAreaOf, isExternalSite, latestGeneration, projectStatus } from "./project-status";

/**
 * O que fazer agora com o projeto — uma ação só, a que a etapa pede.
 *
 * O card mostrava sempre Prompt, Gerar e Publicar, e cabia a quem opera saber
 * qual deles valia naquele momento — e que o passo seguinte, às vezes, nem
 * estava ali (criar o link no Lovable, mandar ao cliente). Agora o selo diz
 * onde o projeto está e o botão diz o que falta; o resto mora no menu.
 */

export type NextStep =
  /** Abre o diálogo de geração. */
  | { kind: "generate"; label: string }
  /** Abre o editor do Lovable e, no painel, o campo de colar o link. */
  | { kind: "create-link"; label: string; href: string }
  | { kind: "verify-link"; label: string }
  /** Responde ao agente parado, pelo painel. */
  | { kind: "reply"; label: string }
  /** Copia a mensagem com o link e registra a entrega. */
  | { kind: "send"; label: string }
  | { kind: "publish"; label: string }
  /** Publica a prévia na área de aprovação (site vinculado de fora do painel). */
  | { kind: "approval"; label: string }
  /** Endereço externo: editor do Lovable, execução no GitHub, site, Drive. */
  | { kind: "link"; label: string; href: string | null };

/** A permissão que a ação exige — a mesma que o servidor confere. */
export const stepPermission: Partial<Record<NextStep["kind"], AccessPermission>> = {
  generate: "gerar",
  reply: "gerar",
  "create-link": "gerar",
  "verify-link": "gerar",
  send: "gerar",
  publish: "publicar",
  approval: "publicar",
};

/** O editor do projeto no Lovable — é lá que se cria o Share preview. */
export const lovableEditorUrl = (project: Project): string | null => {
  const site = latestGeneration(project);
  if (!site?.id || isExternalSite(site)) return null;
  return site.url ?? `https://lovable.dev/projects/${site.id}`;
};

export function nextStep(project: Project): NextStep {
  const { stage } = projectStatus(project);
  const site = latestGeneration(project);
  const editor = lovableEditorUrl(project);
  const runUrl = project.publication?.lastAttempt?.runUrl ?? null;
  const area = devAreaOf(site);

  switch (stage) {
    case "deploy-failed":
      return { kind: "link", label: "Ver erro", href: runUrl };
    case "deploying":
      return { kind: "link", label: "Acompanhar", href: runUrl };
    case "live":
      return {
        kind: "link",
        label: "Abrir site",
        href: `https://${project.publication!.domain}`,
      };
    case "dev-failed":
      return { kind: "link", label: "Ver erro", href: area?.lastRun?.runUrl ?? null };
    case "dev-publishing":
      return { kind: "link", label: "Acompanhar", href: area?.lastRun?.runUrl ?? null };
    case "connect-github":
      // A conexão é no editor: Integrações → GitHub. O painel vê o
      // repositório aparecer e publica sozinho.
      return { kind: "link", label: "Conectar GitHub", href: editor };
    case "delivered":
      return { kind: "publish", label: "Publicar" };
    case "ready":
      return { kind: "send", label: "Enviar ao cliente" };
    case "awaiting-input":
      return { kind: "reply", label: "Responder" };
    case "building":
      return { kind: "link", label: "Acompanhar", href: editor };
    case "delivered-broken":
    case "link-broken":
      // Na área de desenvolvimento não há link a recriar: é a pasta do site,
      // e conferir de novo diz se ela voltou.
      return area
        ? { kind: "verify-link", label: "Verificar link" }
        : { kind: "create-link", label: "Novo link", href: editor ?? "" };
    case "generated":
      // Site vinculado: o link do cliente nasce na área de aprovação.
      if (site?.origin === "linked" && !site.sharePreviewUrl) {
        return { kind: "approval", label: "Publicar prévia" };
      }
      // Link colado mas ainda não conferido: basta conferir. Sem link, é
      // criá-lo no Lovable.
      return site?.sharePreviewUrl
        ? { kind: "verify-link", label: "Verificar link" }
        : { kind: "create-link", label: "Criar link", href: editor ?? "" };
    case "briefed":
    case "collected":
      return { kind: "generate", label: "Gerar" };
    case "empty":
      return { kind: "link", label: "Abrir no Drive", href: project.webViewLink };
  }
}
