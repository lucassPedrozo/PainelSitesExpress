import type { Project } from "@/lib/api";
import type { AccessPermission } from "@shared/access-permissions.js";
import { devAreaOf, isClaudeSite, isExternalSite, latestGeneration, projectStatus } from "./project-status";

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
  /** Manda o código do site (projeto criado no painel) ao GitHub. */
  | { kind: "push-site"; label: string }
  /**
   * Abre o projeto na aba do Claude — é lá que se acompanha a execução,
   * revisa o briefing, aprova a direção ou escolhe outra rota, vê o erro,
   * continua a sequência que parou ou retoma o que um reinício interrompeu.
   */
  | { kind: "claude"; label: string }
  /** Manda ao GitHub o site que o Claude gerou e validou. */
  | { kind: "push-claude"; label: string }
  /** Abre os arquivos do projeto. */
  | { kind: "files"; label: string }
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
  "push-site": "publicar",
  "push-claude": "publicar",
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
    case "claude-interrupted":
      return { kind: "claude", label: "Retomar ou descartar" };
    case "claude-failed":
      return { kind: "claude", label: "Ver erro" };
    case "claude-approval":
      return { kind: "claude", label: "Aprovar direção" };
    case "claude-paused":
      // O que roda — a continuação, a crítica ou o refino — está escrito no
      // botão e na confirmação da aba do Claude.
      return { kind: "claude", label: "Continuar" };
    case "claude-building":
    case "claude-briefing":
    case "claude-queued":
      return { kind: "claude", label: "Acompanhar" };
    case "claude-brief-refused":
      return { kind: "claude", label: "Corrigir briefing" };
    case "claude-brief-ready":
      return { kind: "claude", label: "Revisar e gerar" };
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
      // Site vinculado, ou gerado pelo Claude: o link do cliente nasce na
      // área de aprovação.
      if ((site?.origin === "linked" || isClaudeSite(site)) && !site?.sharePreviewUrl) {
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
    case "to-github":
      // O site do Claude sai da pasta de trabalho do motor; o de um projeto
      // criado no painel, dos arquivos enviados a ele.
      return isClaudeSite(site)
        ? { kind: "push-claude", label: "Enviar ao GitHub" }
        : { kind: "push-site", label: "Enviar ao GitHub" };
    case "storage":
      return { kind: "files", label: "Abrir arquivos" };
  }
}
