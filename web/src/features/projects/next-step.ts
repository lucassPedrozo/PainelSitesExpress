import { isPanelProject, type Project } from "@/lib/api";
import type { AccessPermission } from "@shared/access-permissions.js";
import { clientUrlOf, devAreaOf, isClaudeSite, isExternalSite, latestGeneration, projectStatus } from "./project-status";
import { lovableUrlOf } from "./site-engine";

/**
 * O que fazer agora com o projeto — uma ação só, a que a etapa pede.
 *
 * O card mostrava sempre Prompt, Gerar e Publicar, e cabia a quem opera saber
 * qual deles valia naquele momento — e que o passo seguinte, às vezes, nem
 * estava ali (criar o link no Lovable, mandar ao cliente). Agora o selo diz
 * onde o projeto está e o botão diz o que falta; o resto mora no menu.
 *
 * Cada passo traz:
 * - `label`: o rótulo do botão ("Criar link");
 * - `what`: o passo por extenso, a primeira linha da coluna "Próximo passo"
 *   ("Criar o link"); a segunda é o porquê (`projectStatus().detail`);
 * - `variant`: preenchido quando o passo depende de alguém da equipe agora,
 *   contornado quando quem anda é o painel ou o cliente, vermelho quando o
 *   projeto está com um problema.
 */

export type StepVariant = "primary" | "outline" | "danger";

type Step<K extends string, Extra = object> = { kind: K; label: string; what: string; variant: StepVariant } & Extra;

export type NextStep =
  /** Abre o diálogo de geração. */
  | Step<"generate">
  /** Abre o diálogo de geração já no motor Claude (projeto criado no painel). */
  | Step<"generate-claude">
  /** Abre o editor do Lovable e, no painel, o campo de colar o link. */
  | Step<"create-link", { href: string }>
  | Step<"verify-link">
  /** Responde ao agente parado, pelo painel. */
  | Step<"reply">
  /** Copia a mensagem com o link e registra a entrega. */
  | Step<"send">
  | Step<"publish">
  /** Publica a prévia na área de aprovação (site vinculado de fora do painel). */
  | Step<"approval">
  /** Manda o código do site (projeto criado no painel) ao GitHub. */
  | Step<"push-site">
  /**
   * Abre o projeto na aba do Claude — é lá que se acompanha a execução,
   * revisa o briefing, aprova a direção ou escolhe outra rota, vê o erro,
   * continua a sequência que parou ou retoma o que um reinício interrompeu.
   */
  | Step<"claude">
  /** Manda ao GitHub o site que o Claude gerou e validou. */
  | Step<"push-claude">
  /** Abre os arquivos do projeto. */
  | Step<"files">
  /** Abre a coleta do mesmo domínio que tem o site. */
  | Step<"open-collection", { projectId: string }>
  /** Endereço externo: editor do Lovable, execução no GitHub, site, Drive. */
  | Step<"link", { href: string | null }>;

/** A permissão que a ação exige — a mesma que o servidor confere. */
export const stepPermission: Partial<Record<NextStep["kind"], AccessPermission>> = {
  generate: "gerar",
  "generate-claude": "gerar",
  reply: "gerar",
  "create-link": "gerar",
  // Conferir o link é uma consulta: o servidor não pede permissão para ela.
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
  return lovableUrlOf(site);
};

export function nextStep(project: Project): NextStep {
  const { stage } = projectStatus(project);
  const site = latestGeneration(project);
  const editor = lovableEditorUrl(project);
  const runUrl = project.publication?.lastAttempt?.runUrl ?? null;
  const area = devAreaOf(site);

  switch (stage) {
    // A etapa escolhida à mão: o botão é o que ela pede, com o que o projeto tem.
    case "manual-material":
    case "manual-geracao":
    case "manual-link":
    case "manual-cliente":
    case "manual-publicacao":
    case "manual-no-ar":
      return manualStep(project, stage);
    case "deploy-failed":
      return { kind: "link", label: "Ver erro", what: "Ver o erro da publicação", variant: "danger", href: runUrl };
    case "deploying":
      return { kind: "link", label: "Acompanhar", what: "Acompanhar a publicação", variant: "outline", href: runUrl };
    case "claude-interrupted":
      return { kind: "claude", label: "Retomar ou descartar", what: "Retomar ou descartar a execução", variant: "primary" };
    case "claude-failed":
      return { kind: "claude", label: "Ver erro", what: "Ver o erro da geração", variant: "danger" };
    case "claude-approval":
      return { kind: "claude", label: "Aprovar direção", what: "Aprovar a direção criativa", variant: "primary" };
    case "claude-paused":
      // O que roda — a continuação, a crítica ou o refino — está escrito no
      // botão e na confirmação da aba do Claude.
      return { kind: "claude", label: "Continuar", what: "Continuar a criação do site", variant: "primary" };
    case "claude-building":
    case "claude-briefing":
    case "claude-queued":
      return { kind: "claude", label: "Acompanhar", what: "Acompanhar o Claude", variant: "outline" };
    case "claude-brief-refused":
      return { kind: "claude", label: "Corrigir briefing", what: "Corrigir o briefing", variant: "primary" };
    case "claude-brief-ready":
      return { kind: "claude", label: "Revisar e gerar", what: "Revisar o briefing e gerar", variant: "primary" };
    case "live":
      return {
        kind: "link",
        label: "Abrir site",
        what: "Nada pendente",
        variant: "outline",
        href: `https://${project.publication!.domain}`,
      };
    case "dev-failed":
      return { kind: "link", label: "Ver erro", what: "Ver o erro da prévia", variant: "danger", href: area?.lastRun?.runUrl ?? null };
    case "dev-publishing":
      return { kind: "link", label: "Acompanhar", what: "Acompanhar a prévia", variant: "outline", href: area?.lastRun?.runUrl ?? null };
    case "connect-github":
      // A conexão é no editor: Integrações → GitHub. O painel vê o
      // repositório aparecer e publica sozinho.
      return { kind: "link", label: "Conectar GitHub", what: "Conectar ao GitHub no Lovable", variant: "primary", href: editor };
    case "delivered":
      // Quem decide é o cliente: o botão fica ao alcance, sem pedir pressa.
      return { kind: "publish", label: "Publicar", what: "Publicar quando o cliente aprovar", variant: "outline" };
    case "ready":
      return { kind: "send", label: "Enviar ao cliente", what: "Enviar o link ao cliente", variant: "primary" };
    case "awaiting-input":
      return { kind: "reply", label: "Responder", what: "Responder ao agente", variant: "primary" };
    case "building":
      return { kind: "link", label: "Acompanhar", what: "Acompanhar o Lovable", variant: "outline", href: editor };
    case "delivered-broken":
    case "link-broken":
      // Na área de aprovação não há link a recriar: é a pasta do site, e
      // conferir de novo diz se ela voltou.
      return area
        ? { kind: "verify-link", label: "Verificar link", what: "Verificar o link", variant: "danger" }
        : { kind: "create-link", label: "Novo link", what: "Criar um novo link", variant: "danger", href: editor ?? "" };
    case "generated":
      // Site vinculado, ou gerado pelo Claude: o link do cliente nasce na
      // área de aprovação.
      if ((site?.origin === "linked" || isClaudeSite(site)) && !site?.sharePreviewUrl) {
        return { kind: "approval", label: "Publicar prévia", what: "Publicar a prévia", variant: "primary" };
      }
      // Link colado mas ainda não conferido: basta conferir. Sem link, é
      // criá-lo no Lovable.
      return site?.sharePreviewUrl
        ? { kind: "verify-link", label: "Verificar link", what: "Verificar o link", variant: "primary" }
        : { kind: "create-link", label: "Criar link", what: "Criar o link", variant: "primary", href: editor ?? "" };
    case "briefed":
    case "collected":
      return { kind: "generate", label: "Gerar", what: "Gerar o site", variant: "primary" };
    case "panel-collected":
      return { kind: "generate-claude", label: "Gerar", what: "Gerar com o Claude", variant: "primary" };
    case "empty":
      return { kind: "link", label: "Abrir no Drive", what: "Esperar o material", variant: "outline", href: project.webViewLink };
    case "to-github":
      // O site do Claude sai da pasta de trabalho do motor; o de um projeto
      // criado no painel, dos arquivos enviados a ele.
      return isClaudeSite(site)
        ? { kind: "push-claude", label: "Enviar ao GitHub", what: "Enviar o site ao GitHub", variant: "primary" }
        : { kind: "push-site", label: "Enviar ao GitHub", what: "Enviar o site ao GitHub", variant: "primary" };
    case "github-failed":
      return { kind: "push-claude", label: "Enviar ao GitHub", what: "Enviar de novo ao GitHub", variant: "danger" };
    case "storage":
      return { kind: "files", label: "Abrir arquivos", what: "Nada pendente", variant: "outline" };
    case "other-collection":
      return {
        kind: "open-collection",
        label: "Abrir coleta do site",
        what: "Nada a gerar aqui",
        variant: "outline",
        projectId: project.domainSite!.projectId,
      };
  }
}

/**
 * O passo de uma etapa escolhida à mão. Quando o projeto não tem o que o
 * passo usaria (um link sem site, por exemplo), o botão abre o projeto.
 */
function manualStep(project: Project, stage: string): NextStep {
  const site = latestGeneration(project);
  const editor = lovableEditorUrl(project);
  const doPainel = isPanelProject(project);
  switch (stage) {
    case "manual-material":
      return doPainel
        ? { kind: "files", label: "Abrir arquivos", what: "Esperar o material", variant: "outline" }
        : { kind: "link", label: "Abrir no Drive", what: "Esperar o material", variant: "outline", href: project.webViewLink };
    case "manual-geracao":
      return doPainel
        ? { kind: "generate-claude", label: "Gerar", what: "Gerar com o Claude", variant: "primary" }
        : { kind: "generate", label: "Gerar", what: "Gerar o site", variant: "primary" };
    case "manual-link":
      if (site?.sharePreviewUrl) return { kind: "verify-link", label: "Verificar link", what: "Verificar o link", variant: "primary" };
      if (editor) return { kind: "create-link", label: "Criar link", what: "Criar o link", variant: "primary", href: editor };
      return { kind: "files", label: "Abrir", what: "Criar o link do cliente", variant: "outline" };
    case "manual-cliente":
      return clientUrlOf(site) && !site?.deliveredAt
        ? { kind: "send", label: "Enviar ao cliente", what: "Enviar o link ao cliente", variant: "primary" }
        : { kind: "publish", label: "Publicar", what: "Publicar quando o cliente aprovar", variant: "outline" };
    case "manual-publicacao":
      return { kind: "publish", label: "Publicar", what: "Publicar no domínio", variant: "primary" };
    default:
      return project.domain
        ? { kind: "link", label: "Abrir site", what: "Nada pendente", variant: "outline", href: `https://${project.domain}` }
        : { kind: "files", label: "Abrir arquivos", what: "Nada pendente", variant: "outline" };
  }
}

/**
 * Por que o botão do passo não funciona agora, quando não é falta de
 * permissão: o endereço que ele abriria ainda não existe.
 */
export function stepUnavailableReason(step: NextStep, approvalAreaReady: boolean): string | null {
  if (step.kind === "approval" && !approvalAreaReady) {
    return "A área de aprovação não está configurada (Configurações → Área de aprovação).";
  }
  if (step.kind === "link" && !step.href) {
    if (step.label === "Abrir no Drive") return "A pasta do Drive não tem endereço.";
    if (step.label === "Conectar GitHub" || step.what === "Acompanhar o Lovable") {
      return "Este site não tem projeto no Lovable registrado.";
    }
    return "A execução ainda não apareceu no GitHub; o painel confere sozinho.";
  }
  return null;
}
