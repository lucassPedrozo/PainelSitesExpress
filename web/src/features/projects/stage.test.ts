import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api";
import { nextStep } from "./next-step";
import { stageOrder, type ProjectStage } from "./project-status";
import { ETAPAS, ETAPA_ORDER, PRIORITY, STAGES, WORK_GROUPS, stageOf, tabOf, toneClass } from "./stage";

const projeto = (over: Partial<Project> = {}): Project =>
  ({
    id: "p",
    name: "[04/09/2026] aurora.eng.br",
    alias: null,
    createdTime: "2026-09-04T00:00:00.000Z",
    lastActivity: "2026-09-04T00:00:00.000Z",
    fileCount: 3,
    folderCount: 0,
    totalSize: 1000,
    kinds: {},
    tagIds: [],
    generations: [],
    brief: null,
    publication: null,
    webViewLink: "https://drive.example/pasta",
    ...over,
  }) as unknown as Project;

const site = (extra: object = {}) => ({
  id: "g1",
  createdAt: "2026-09-05T00:00:00.000Z",
  agentState: "done",
  previewState: "unknown",
  sharePreviewUrl: null,
  deliveredAt: null,
  devArea: null,
  clientUrl: null,
  ...extra,
});

/** Os estados que precisam aparecer como problema, e nunca escondidos atrás da etapa. */
const PROBLEMAS: ProjectStage[] = [
  "deploy-failed",
  "dev-failed",
  "link-broken",
  "delivered-broken",
  "awaiting-input",
  "claude-failed",
  "claude-interrupted",
  "github-failed",
];

describe("o mapeamento dos estados internos", () => {
  it("todo estado tem uma etapa visível, e as etapas são poucas", () => {
    for (const stage of stageOrder) {
      expect(STAGES[stage], stage).toBeDefined();
      expect(ETAPAS[STAGES[stage].etapa]).toBeDefined();
    }
    expect(new Set(stageOrder).size).toBe(Object.keys(STAGES).length);
    expect(ETAPA_ORDER).toHaveLength(7);
  });

  it("erro, agente parado, geração interrompida e link caído viram selo de problema", () => {
    const comProblema = stageOrder.filter((stage) => STAGES[stage].problem);
    expect(new Set(comProblema)).toEqual(new Set(PROBLEMAS));
    // Todo problema cai em "Resolver": nenhum fica fora do "Fazer agora".
    for (const stage of PROBLEMAS) expect(STAGES[stage].group, stage).toBe("resolver");
  });

  it("os textos de selo são poucos: as etapas e os problemas", () => {
    const textos = new Set(stageOrder.map((stage) => STAGES[stage].problem?.label ?? ETAPAS[STAGES[stage].etapa].label));
    expect(textos.size).toBeLessThanOrEqual(15);
  });

  it("todo grupo está na ordem de prioridade uma vez, e os contadores de ação vêm antes dos de espera", () => {
    expect(new Set(PRIORITY)).toEqual(new Set(WORK_GROUPS.map((group) => group.key)));
    expect(PRIORITY).toHaveLength(WORK_GROUPS.length);
    const acting = WORK_GROUPS.map((group) => group.acting);
    expect(acting).toEqual([true, true, true, true, true, false, false, false]);
  });

  it("só no ar (calculado ou escolhido à mão), projeto de arquivos e coleta repetida ficam sem contador", () => {
    const semGrupo = stageOrder.filter((stage) => !STAGES[stage].group);
    expect(semGrupo.sort()).toEqual(["live", "manual-no-ar", "other-collection", "storage"]);
  });

  it("todo tom tem classe de selo e de texto", () => {
    for (const tone of Object.keys(toneClass) as Array<keyof typeof toneClass>) {
      expect(toneClass[tone].soft).toMatch(/^bg-/);
      expect(toneClass[tone].text).toMatch(/^text-/);
    }
  });
});

describe("stageOf — o selo de cada situação", () => {
  it("antes do site: Material ou Geração", () => {
    expect(stageOf(projeto({ fileCount: 0 })).label).toBe("Material");
    const pronto = stageOf(projeto({ brief: { id: "b", name: "Informações do Site", mimeType: "x", createdTime: null } }));
    expect([pronto.label, pronto.tone, pronto.group]).toEqual(["Geração", "geracao", "gerar"]);
  });

  it("gerando: a etapa gira e o grupo é de espera", () => {
    const gerando = stageOf(projeto({ generations: [site({ agentState: "running" })] } as never));
    expect([gerando.label, gerando.running, gerando.group]).toEqual(["Geração", true, "andamento"]);
  });

  it("agente parado: selo âmbar de problema, com a pergunta na frase", () => {
    const parado = stageOf(
      projeto({ generations: [site({ agentState: "awaiting", agentQuestion: "Qual logo devo usar?" })] } as never),
    );
    expect([parado.label, parado.tone, parado.problem]).toEqual(["Agente parado", "atencao", "parado"]);
    expect(parado.detail).toContain("Qual logo devo usar?");
  });

  it("link e cliente: criar o link, enviar, com o cliente, link caído", () => {
    expect(stageOf(projeto({ generations: [site()] } as never)).label).toBe("Link");
    const pronto = projeto({ generations: [site({ previewState: "alive", shortUrl: "https://l.ex/a", clientUrl: "https://l.ex/a" })] } as never);
    expect([stageOf(pronto).label, stageOf(pronto).group]).toEqual(["Cliente", "enviar"]);
    const entregue = projeto({
      generations: [site({ previewState: "alive", clientUrl: "https://l.ex/a", deliveredAt: "2026-09-09T00:00:00.000Z" })],
    } as never);
    expect([stageOf(entregue).label, stageOf(entregue).group]).toEqual(["Cliente", "com-cliente"]);
    const caiu = projeto({
      generations: [site({ previewState: "dead", clientUrl: "https://l.ex/a", deliveredAt: "2026-09-09T00:00:00.000Z" })],
    } as never);
    expect([stageOf(caiu).label, stageOf(caiu).tone]).toEqual(["Link caiu", "erro"]);
  });

  it("publicação: no ar, publicando e falhou — a falha ganha do no ar", () => {
    const publicacao = { domain: "aurora.eng.br", repoFullName: "o/a", configuredAt: null, lastDeployAt: "2026-09-10T00:00:00.000Z" };
    expect(stageOf(projeto({ publication: { ...publicacao, lastAttempt: null } } as never)).label).toBe("No ar");
    const publicando = stageOf(
      projeto({ publication: { ...publicacao, lastAttempt: { at: "x", status: "pending", runUrl: null } } } as never),
    );
    expect([publicando.label, publicando.running]).toEqual(["Publicação", true]);
    const falhou = stageOf(
      projeto({ publication: { ...publicacao, lastAttempt: { at: "x", status: "failure", runUrl: null } } } as never),
    );
    expect([falhou.label, falhou.tone]).toEqual(["Publicação falhou", "erro"]);
  });

  it("projeto do painel: com site, enviar ao GitHub; com material e sem site, gerar com o Claude", () => {
    const comSite = projeto({ source: "panel", purpose: "site", hasSite: true } as never);
    expect([stageOf(comSite).stage, nextStep(comSite).kind]).toEqual(["to-github", "push-site"]);
    const semSite = projeto({ source: "panel", purpose: "site", hasSite: false } as never);
    expect([stageOf(semSite).stage, stageOf(semSite).group, nextStep(semSite).kind]).toEqual([
      "panel-collected",
      "gerar",
      "generate-claude",
    ]);
    const arquivos = projeto({ source: "panel", purpose: "files" } as never);
    expect([stageOf(arquivos).label, stageOf(arquivos).group]).toEqual(["Arquivos", null]);
  });
});

describe("o botão do passo", () => {
  it("vermelho nos erros, contornado no que espera, preenchido no que depende da equipe", () => {
    const publicacao = { domain: "a.com.br", repoFullName: "o/a", configuredAt: null, lastDeployAt: null };
    const falhou = projeto({ publication: { ...publicacao, lastAttempt: { at: "x", status: "failure", runUrl: null } } } as never);
    expect([nextStep(falhou).label, nextStep(falhou).variant]).toEqual(["Ver erro", "danger"]);
    expect(nextStep(projeto({ fileCount: 0 })).variant).toBe("outline");
    expect(nextStep(projeto()).variant).toBe("primary");
    const entregue = projeto({
      generations: [site({ previewState: "alive", clientUrl: "https://l.ex/a", deliveredAt: "2026-09-09T00:00:00.000Z" })],
    } as never);
    // Publicar depende do cliente aprovar: fica ao alcance, sem pedir pressa.
    expect([nextStep(entregue).label, nextStep(entregue).variant]).toEqual(["Publicar", "outline"]);
  });

  it("todo passo diz o quê por extenso, além do rótulo do botão", () => {
    expect(nextStep(projeto()).what).toBe("Gerar o site");
    expect(nextStep(projeto({ generations: [site()] } as never)).what).toBe("Criar o link");
  });
});

describe("tabOf — as abas da lista", () => {
  const publicacao = { domain: "a.com.br", repoFullName: "o/a", configuredAt: null, lastDeployAt: "2026-09-10T00:00:00.000Z", lastAttempt: null };
  it("finalizado pela tag, no ar pelo GitHub, ativo o resto", () => {
    expect(tabOf(projeto(), "fim")).toBe("ativos");
    expect(tabOf(projeto({ publication: publicacao } as never), "fim")).toBe("no-ar");
    expect(tabOf(projeto({ tagIds: ["fim"], publication: publicacao } as never), "fim")).toBe("finalizados");
  });

  it("oculto vence tudo: no ar, finalizado ou ativo, vai para Ocultos", () => {
    const oculto = { details: { hidden: { at: "2026-10-14T12:00:00.000Z", by: "Ana" } } };
    expect(tabOf(projeto(oculto as never), "fim")).toBe("ocultos");
    expect(tabOf(projeto({ ...oculto, tagIds: ["fim"], publication: publicacao } as never), "fim")).toBe("ocultos");
  });
});

describe("a etapa escolhida à mão", () => {
  const escolhida = (etapa: string, at = "2026-09-10T12:00:00.000Z") =>
    ({ domain: null, receivedAt: null, responsible: null, note: null, stage: { etapa, at, by: "Ana" } }) as never;

  it("vence o cálculo, com a marca de manual, o grupo da etapa e o botão que ela pede", () => {
    const comCliente = projeto({ details: escolhida("cliente") } as never);
    const view = stageOf(comCliente);
    expect([view.label, view.manual, view.group, view.problem]).toEqual(["Cliente", true, "com-cliente", null]);
    expect(view.detail).toContain("definida à mão por Ana");
    // Sem link do cliente para enviar, o passo é publicar quando ele aprovar.
    expect(nextStep(comCliente).label).toBe("Publicar");
    expect(nextStep(projeto({ details: escolhida("geracao") } as never)).kind).toBe("generate");
    expect(nextStep(projeto({ details: escolhida("material") } as never)).label).toBe("Abrir no Drive");
  });

  it("no ar à mão leva o projeto para a aba No ar", () => {
    const noAr = projeto({ details: escolhida("no-ar"), domain: "aurora.eng.br" } as never);
    expect(tabOf(noAr, null)).toBe("no-ar");
    expect(stageOf(noAr).group).toBeNull();
    expect(nextStep(noAr)).toMatchObject({ label: "Abrir site", href: "https://aurora.eng.br" });
  });

  it("perde a validade quando acontece um fato depois dela, e o painel volta a calcular", () => {
    // Gerado antes da escolha: a escolha vale.
    const antes = projeto({ generations: [site()], details: escolhida("cliente") } as never);
    expect(stageOf(antes).manual).toBe(true);
    // Gerado depois da escolha: volta o cálculo (site gerado → Link).
    const depois = projeto({
      generations: [site({ createdAt: "2026-09-11T00:00:00.000Z" })],
      details: escolhida("cliente"),
    } as never);
    expect([stageOf(depois).manual, stageOf(depois).etapa]).toEqual([false, "link"]);
  });

  it("conferências periódicas não contam como fato", () => {
    const conferido = projeto({
      generations: [site({ previewCheckedAt: "2026-09-12T00:00:00.000Z", agentCheckedAt: "2026-09-12T00:00:00.000Z" })],
      details: escolhida("cliente"),
    } as never);
    expect(stageOf(conferido).manual).toBe(true);
  });
});
