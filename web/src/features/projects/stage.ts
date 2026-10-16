import {
  CirclePause,
  FolderOpen,
  Globe,
  Inbox,
  Layers,
  Link2,
  Rocket,
  Send,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Project } from "@/lib/api";
import { projectStatus, type ProjectStage } from "./project-status";

/**
 * A fonte única da etapa do projeto.
 *
 * O painel tem perto de 30 estados internos (`project-status.ts`); quem opera
 * precisa de poucos. Aqui cada estado vira:
 *
 * - uma **etapa** visível (Material, Geração, Link, Cliente, Publicação, No ar,
 *   Arquivos) — onde o projeto está no caminho até o domínio;
 * - um **problema**, quando há: erro, link caído, agente parado ou geração
 *   interrompida trocam o selo por um vermelho ou âmbar, para nunca ficarem
 *   escondidos atrás da etapa;
 * - um **grupo** de trabalho — o que ordena a lista e o que o Dashboard filtra;
 * - o ícone e o tom.
 *
 * O selo, os contadores, o filtro, a ordem da lista, o Dashboard e a linha do
 * tempo leem daqui. O porquê de cada estado (a frase) vem de `projectStatus`;
 * o botão, de `nextStep`. Testado em stage.test.ts.
 */

export type Etapa = "material" | "geracao" | "link" | "cliente" | "publicacao" | "no-ar" | "arquivos";

/** Os tons do painel: um por etapa e dois de problema. */
export type StageTone = "material" | "geracao" | "link" | "cliente" | "publicacao" | "arquivos" | "erro" | "atencao";

export const ETAPAS: Record<Etapa, { label: string; icon: LucideIcon; tone: StageTone; hint: string }> = {
  material: { label: "Material", icon: Inbox, tone: "material", hint: "Esperando o material do cliente." },
  geracao: { label: "Geração", icon: Sparkles, tone: "geracao", hint: "Do material ao site gerado." },
  link: { label: "Link", icon: Link2, tone: "link", hint: "Do site gerado ao link do cliente." },
  cliente: { label: "Cliente", icon: Send, tone: "cliente", hint: "Link pronto para enviar ou com o cliente." },
  publicacao: { label: "Publicação", icon: Rocket, tone: "publicacao", hint: "Publicando no domínio do cliente." },
  "no-ar": { label: "No ar", icon: Globe, tone: "publicacao", hint: "Publicado no domínio do cliente." },
  arquivos: { label: "Arquivos", icon: FolderOpen, tone: "arquivos", hint: "Projeto só de arquivos, sem site." },
};

/** As etapas na ordem do caminho — a ordem do filtro e do Dashboard. */
export const ETAPA_ORDER: Etapa[] = ["material", "geracao", "link", "cliente", "publicacao", "no-ar", "arquivos"];

export type WorkGroupKey =
  | "resolver"
  | "revisar"
  | "gerar"
  | "criar-link"
  | "enviar"
  | "andamento"
  | "com-cliente"
  | "sem-material";

export type WorkGroup = {
  key: WorkGroupKey;
  label: string;
  /** `true`: depende de alguém da equipe agora. `false`: espera o painel ou o cliente. */
  acting: boolean;
};

/** Os grupos de trabalho, do que pede a equipe agora ao que só espera. */
export const WORK_GROUPS: WorkGroup[] = [
  { key: "resolver", label: "Resolver", acting: true },
  { key: "revisar", label: "Revisar", acting: true },
  { key: "gerar", label: "Gerar", acting: true },
  { key: "criar-link", label: "Criar link", acting: true },
  { key: "enviar", label: "Enviar ao cliente", acting: true },
  { key: "andamento", label: "Em andamento", acting: false },
  { key: "com-cliente", label: "Com o cliente", acting: false },
  { key: "sem-material", label: "Sem material", acting: false },
];

export const workGroupOf = (key: WorkGroupKey) => WORK_GROUPS.find((group) => group.key === key)!;

/**
 * A ordem da lista: o que quebrou, o que espera uma decisão, o que está a um
 * clique do cliente, e por fim o que só espera. Mais perto do fim, mais
 * longe de pedir alguém.
 */
export const PRIORITY: WorkGroupKey[] = [
  "resolver",
  "revisar",
  "enviar",
  "criar-link",
  "gerar",
  "andamento",
  "com-cliente",
  "sem-material",
];

type ProblemKind = "erro" | "parado";

type StageDef = {
  etapa: Etapa;
  /** O texto e o ícone do selo, quando não são os da etapa. */
  label?: string;
  icon?: LucideIcon;
  group: WorkGroupKey | null;
  problem?: { label: string; kind: ProblemKind };
  /** O painel acompanha algo em curso: o selo gira. */
  running?: boolean;
};

export const STAGES: Record<ProjectStage, StageDef> = {
  // Escolhidas à mão: o grupo é o de quem está na etapa sem problema nenhum.
  // Publicação à mão é "aprovado, falta publicar" — espera com o cliente.
  "manual-material": { etapa: "material", group: "sem-material" },
  "manual-geracao": { etapa: "geracao", group: "gerar" },
  "manual-link": { etapa: "link", group: "criar-link" },
  "manual-cliente": { etapa: "cliente", group: "com-cliente" },
  "manual-publicacao": { etapa: "publicacao", group: "com-cliente" },
  "manual-no-ar": { etapa: "no-ar", group: null },
  empty: { etapa: "material", group: "sem-material" },
  collected: { etapa: "geracao", group: "gerar" },
  briefed: { etapa: "geracao", group: "gerar" },
  "panel-collected": { etapa: "geracao", group: "gerar" },
  "claude-brief-ready": { etapa: "geracao", group: "revisar" },
  "claude-brief-refused": { etapa: "geracao", group: "revisar" },
  "claude-approval": { etapa: "geracao", group: "revisar" },
  "claude-paused": { etapa: "geracao", group: "revisar" },
  "claude-queued": { etapa: "geracao", group: "andamento", running: true },
  "claude-briefing": { etapa: "geracao", group: "andamento", running: true },
  "claude-building": { etapa: "geracao", group: "andamento", running: true },
  building: { etapa: "geracao", group: "andamento", running: true },
  "awaiting-input": { etapa: "geracao", group: "resolver", problem: { label: "Agente parado", kind: "parado" } },
  "claude-interrupted": { etapa: "geracao", group: "resolver", problem: { label: "Interrompida", kind: "parado" } },
  "claude-failed": { etapa: "geracao", group: "resolver", problem: { label: "Geração falhou", kind: "erro" } },
  generated: { etapa: "link", group: "criar-link" },
  "to-github": { etapa: "link", group: "criar-link" },
  "connect-github": { etapa: "link", group: "criar-link" },
  "dev-publishing": { etapa: "link", group: "andamento", running: true },
  "github-failed": { etapa: "link", group: "resolver", problem: { label: "Envio falhou", kind: "erro" } },
  "dev-failed": { etapa: "link", group: "resolver", problem: { label: "Prévia falhou", kind: "erro" } },
  "link-broken": { etapa: "link", group: "resolver", problem: { label: "Link não abre", kind: "erro" } },
  ready: { etapa: "cliente", group: "enviar" },
  delivered: { etapa: "cliente", group: "com-cliente" },
  "delivered-broken": { etapa: "cliente", group: "resolver", problem: { label: "Link caiu", kind: "erro" } },
  deploying: { etapa: "publicacao", group: "andamento", running: true },
  "deploy-failed": { etapa: "publicacao", group: "resolver", problem: { label: "Publicação falhou", kind: "erro" } },
  live: { etapa: "no-ar", group: null },
  storage: { etapa: "arquivos", group: null },
  // A coleta repetida não é outro site: fica fora dos contadores e das contas,
  // como os projetos só de arquivos. O site conta uma vez, na coleta dele.
  "other-collection": { etapa: "arquivos", group: null, label: "Outra coleta", icon: Layers },
};

export type StageView = {
  stage: ProjectStage;
  etapa: Etapa;
  /** O texto do selo: a etapa, ou o problema que ela tem. */
  label: string;
  icon: LucideIcon;
  tone: StageTone;
  /** Algo em curso: o selo gira. */
  running: boolean;
  problem: ProblemKind | null;
  /** O grupo de trabalho; `null` para os que estão no ar e os só de arquivos. */
  group: WorkGroupKey | null;
  /** O porquê da etapa, em uma frase. */
  detail: string;
  /** A etapa foi escolhida à mão (vale até o próximo fato). */
  manual: boolean;
};

export function stageOf(project: Project): StageView {
  const status = projectStatus(project);
  const def = STAGES[status.stage];
  const etapa = ETAPAS[def.etapa];
  const problem = def.problem ?? null;
  return {
    stage: status.stage,
    etapa: def.etapa,
    label: problem?.label ?? def.label ?? etapa.label,
    icon: problem ? (problem.kind === "erro" ? TriangleAlert : CirclePause) : (def.icon ?? etapa.icon),
    tone: problem ? (problem.kind === "erro" ? "erro" : "atencao") : etapa.tone,
    running: Boolean(def.running),
    problem: problem?.kind ?? null,
    group: def.group,
    detail: status.detail,
    manual: status.stage.startsWith("manual-"),
  };
}

/**
 * As abas da lista. Finalizado é uma escolha de quem opera (a tag); no ar é o
 * que o GitHub confirma; o resto está ativo — inclusive o site no ar com uma
 * publicação nova falhando, que é problema, não descanso.
 */
export type ListTab = "ativos" | "no-ar" | "finalizados" | "ocultos";

export function tabOf(project: Project, finishedTagId: string | null): ListTab {
  // Oculto vence tudo: sai das outras abas, dos contadores e do Dashboard.
  if (project.details?.hidden) return "ocultos";
  if (finishedTagId && project.tagIds.includes(finishedTagId)) return "finalizados";
  const { stage } = projectStatus(project);
  return stage === "live" || stage === "manual-no-ar" ? "no-ar" : "ativos";
}

/** As classes de cada tom, por extenso para o Tailwind detectá-las. */
export const toneClass: Record<StageTone, { soft: string; text: string }> = {
  material: { soft: "bg-stage-material-soft text-stage-material", text: "text-stage-material" },
  geracao: { soft: "bg-stage-geracao-soft text-stage-geracao", text: "text-stage-geracao" },
  link: { soft: "bg-stage-link-soft text-stage-link", text: "text-stage-link" },
  cliente: { soft: "bg-stage-cliente-soft text-stage-cliente", text: "text-stage-cliente" },
  publicacao: { soft: "bg-stage-publicacao-soft text-stage-publicacao", text: "text-stage-publicacao" },
  arquivos: { soft: "bg-stage-arquivos-soft text-stage-arquivos", text: "text-stage-arquivos" },
  erro: { soft: "bg-destructive-soft text-destructive", text: "text-destructive" },
  atencao: { soft: "bg-warning-soft text-warning", text: "text-warning" },
};
