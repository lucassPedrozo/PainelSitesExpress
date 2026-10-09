import { describe, expect, it } from "vitest";
import type { ClaudeQueueItem, ClaudeSummary, Generation, Project } from "@/lib/api";
import { nextStep, stepPermission } from "@/features/projects/next-step";
import { isInProgress, progressOf } from "@/features/projects/project-progress";
import { projectStatus, stageClass, stageLabels, stageOrder } from "@/features/projects/project-status";
import { stageAlerts } from "@/features/projects/use-stage-alerts";
import { groupByNextStep, isDone } from "@/features/projects/work-queue";

/**
 * O motor Claude no card: cada situação dele tem um selo e um próximo passo —
 * ninguém deveria precisar abrir o projeto para saber se o Claude está
 * rodando, se parou esperando alguém ou se o briefing já dá para revisar.
 */

const projeto = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "[04/09/2026] cliente.com.br",
    alias: null,
    fileCount: 3,
    folderCount: 0,
    totalSize: 100,
    kinds: {},
    tagIds: [],
    generations: [],
    brief: { id: "b", name: "Informações do Site", mimeType: "application/pdf" },
    publication: null,
    claude: null,
    ...over,
  }) as unknown as Project;

const item = (over: Partial<ClaudeQueueItem> = {}): ClaudeQueueItem => ({
  id: "item-1",
  estado: "rodando",
  tipo: "cliente",
  frase: "gere o site do cliente cliente-1a2b",
  criadoEm: "2026-10-07T12:00:00.000Z",
  inicio: "2026-10-07T12:01:00.000Z",
  projectId: "p1",
  por: "Ana",
  slug: null,
  execucaoId: "e1",
  etapa: null,
  posicao: null,
  ...over,
});

const claude = (over: Partial<ClaudeSummary> = {}): ClaudeSummary => ({
  folder: "cliente-1a2b",
  slug: null,
  queue: null,
  material: null,
  briefing: null,
  site: null,
  lastRun: null,
  ...over,
});

const ultima = (over: Partial<NonNullable<ClaudeSummary["lastRun"]>> = {}): NonNullable<ClaudeSummary["lastRun"]> => ({
  id: "e1",
  type: "cliente",
  status: "sucesso",
  message: "Site validado.",
  at: "2026-10-07T13:00:00.000Z",
  durationMs: 1000,
  ...over,
});

const briefing = (state: "ok" | "refused" | "missing", errors = 0) => ({
  state,
  errors,
  warnings: 0,
  checkedAt: "2026-10-07T12:30:00.000Z",
});

const site = (over: Partial<NonNullable<ClaudeSummary["site"]>> = {}): NonNullable<ClaudeSummary["site"]> => ({
  awaitingApproval: false,
  openStage: null,
  delivered: true,
  situation: "entregue",
  checkedAt: "2026-10-07T13:00:00.000Z",
  ...over,
});

const siteDoClaude = (over: Partial<Generation> = {}): Generation =>
  ({
    id: "ext-0123456789ab",
    engine: "claude",
    claudeSlug: "cliente-1a2b",
    createdAt: "2026-10-07T13:00:00.000Z",
    agentState: "done",
    origin: "panel",
    sharePreviewUrl: null,
    deliveredAt: null,
    previewState: "unknown",
    repoFullName: null,
    devArea: null,
    clientUrl: null,
    shortUrl: null,
    ...over,
  }) as unknown as Generation;

const etapaE = (p: Project) => [projectStatus(p).stage, nextStep(p).label, projectStatus(p).attention];

describe("motor Claude — o selo e o próximo passo de cada situação", () => {
  it("do pedido ao site: fila, briefing, revisão, geração, aprovação e envio ao GitHub", () => {
    // Sem nada do Claude, vale o que valia: briefing do Drive, botão Gerar.
    expect(etapaE(projeto())).toEqual(["briefed", "Gerar", false]);
    // Passou pelo ensaio (a pasta já existe), mas nada foi pedido: continua igual.
    expect(etapaE(projeto({ claude: claude() }))).toEqual(["briefed", "Gerar", false]);

    expect(etapaE(projeto({ claude: claude({ queue: item({ estado: "esperando", tipo: "analisar", posicao: 2 }) }) }))).toEqual([
      "claude-queued",
      "Acompanhar",
      false,
    ]);
    expect(etapaE(projeto({ claude: claude({ queue: item({ tipo: "analisar" }) }) }))).toEqual([
      "claude-briefing",
      "Acompanhar",
      false,
    ]);
    expect(
      etapaE(projeto({ claude: claude({ briefing: briefing("refused", 2), lastRun: ultima({ type: "analisar", status: "falha" }) }) })),
    ).toEqual(["claude-failed", "Ver erro", true]);
    // O Claude terminou bem, mas alguém quebrou o briefing ao corrigir: não é falha de execução.
    expect(
      etapaE(projeto({ claude: claude({ briefing: briefing("refused", 2), lastRun: ultima({ type: "analisar" }) }) })),
    ).toEqual(["claude-brief-refused", "Corrigir briefing", true]);
    expect(
      etapaE(projeto({ claude: claude({ briefing: briefing("ok"), lastRun: ultima({ type: "analisar" }) }) })),
    ).toEqual(["claude-brief-ready", "Revisar e gerar", true]);

    expect(etapaE(projeto({ claude: claude({ briefing: briefing("ok"), queue: item() }) }))).toEqual([
      "claude-building",
      "Acompanhar",
      false,
    ]);
    expect(
      etapaE(
        projeto({
          claude: claude({
            briefing: briefing("ok"),
            slug: "cliente-1a2b",
            site: site({ awaitingApproval: true, delivered: false }),
            lastRun: ultima({ status: "aguardando_aprovacao" }),
          }),
        }),
      ),
    ).toEqual(["claude-approval", "Aprovar direção", true]);

    // Gerado e validado: o site entra na lista do projeto e falta mandar ao GitHub.
    const pronto = projeto({
      claude: claude({ briefing: briefing("ok"), slug: "cliente-1a2b", site: site(), lastRun: ultima() }),
      generations: [siteDoClaude()],
    });
    expect(etapaE(pronto)).toEqual(["to-github", "Enviar ao GitHub", true]);
    expect(nextStep(pronto).kind).toBe("push-claude");
    expect(stepPermission["push-claude"]).toBe("publicar");
    expect(projectStatus(pronto).detail).toMatch(/gerado pelo Claude e validado/);
  });

  it("o que parou esperando alguém: etapa aberta, falha sem resultado e reinício no meio", () => {
    const comEtapaAberta = projeto({
      claude: claude({
        briefing: briefing("ok"),
        slug: "cliente-1a2b",
        site: site({ openStage: "geracao", delivered: false }),
        lastRun: ultima({ status: "falha" }),
      }),
    });
    expect(etapaE(comEtapaAberta)).toEqual(["claude-failed", "Ver erro", true]);
    expect(projectStatus(comEtapaAberta).detail).toMatch(/etapa de geração aberta/);

    // A geração falhou antes de existir um site (a validação não passou, o login caiu).
    expect(
      etapaE(projeto({ claude: claude({ briefing: briefing("ok"), lastRun: ultima({ status: "falha" }) }) })),
    ).toEqual(["claude-failed", "Ver erro", true]);

    // Interrompida por um reinício: vale mais que qualquer outra coisa do Claude.
    expect(
      etapaE(
        projeto({
          claude: claude({ briefing: briefing("ok"), queue: item({ estado: "interrompida" }), lastRun: ultima({ status: "falha" }) }),
        }),
      ),
    ).toEqual(["claude-interrupted", "Retomar ou descartar", true]);

    // Cancelar é uma escolha, não uma falha: o card volta ao que havia.
    expect(
      etapaE(projeto({ claude: claude({ briefing: briefing("ok"), lastRun: ultima({ status: "cancelada" }) }) })),
    ).toEqual(["claude-brief-ready", "Revisar e gerar", true]);
  });

  it("uma falha não esconde o que já estava bom: o site entregue e o briefing aceito continuam valendo", () => {
    // Ajuste que falhou num site já enviado ao cliente: o card segue "Entregue".
    const entregue = projeto({
      claude: claude({ briefing: briefing("ok"), slug: "s", site: site(), lastRun: ultima({ type: "ajuste", status: "falha" }) }),
      generations: [
        siteDoClaude({
          repoFullName: "org/cliente",
          deliveredAt: "2026-10-08T00:00:00.000Z",
          previewState: "alive",
          clientUrl: "https://aprovacao.exemplo.com.br/cliente/",
        }),
      ],
    });
    expect(projectStatus(entregue).stage).toBe("delivered");

    // Novo pedido de briefing que falhou, com um briefing aceito de antes.
    expect(
      projectStatus(projeto({ claude: claude({ briefing: briefing("ok"), lastRun: ultima({ type: "analisar", status: "falha" }) }) })).stage,
    ).toBe("claude-brief-ready");

    // Mas etapa aberta e aprovação pendente pedem alguém mesmo com o site no ar.
    const noAr = {
      domain: "cliente.com.br",
      repoFullName: "org/cliente",
      configuredAt: "2026-09-10T00:00:00.000Z",
      lastDeployAt: "2026-09-10T00:00:00.000Z",
      lastAttempt: { at: "2026-09-10T00:00:00.000Z", status: "success" as const, runUrl: null },
    };
    const refazendo = projeto({
      publication: noAr,
      generations: [siteDoClaude({ repoFullName: "org/cliente" })],
      claude: claude({ briefing: briefing("ok"), slug: "s-2", site: site({ awaitingApproval: true, delivered: false }) }),
    });
    expect(projectStatus(refazendo).stage).toBe("claude-approval");
    // Rodando um ajuste num site no ar: o selo continua "No ar", e o andamento mostra o Claude.
    const ajustando = projeto({
      publication: noAr,
      generations: [siteDoClaude({ repoFullName: "org/cliente" })],
      claude: claude({ slug: "s", site: site(), queue: item({ tipo: "ajuste", etapa: "ajuste" }) }),
    });
    expect(projectStatus(ajustando).stage).toBe("live");
    expect(progressOf(ajustando)?.title).toBe("Ajustando com o Claude");
  });

  it("site do Claude já no GitHub: o link do cliente nasce na área de aprovação, nunca no Lovable", () => {
    const noGitHub = projeto({ claude: claude({ slug: "s", site: site() }), generations: [siteDoClaude({ repoFullName: "org/cliente" })] });
    const s = projectStatus(noGitHub);
    expect([s.stage, s.detail.includes("Lovable"), nextStep(noGitHub).kind, nextStep(noGitHub).label]).toEqual([
      "generated",
      false,
      "approval",
      "Publicar prévia",
    ]);

    const publicando = projeto({
      generations: [siteDoClaude({ repoFullName: "org/cliente", devArea: { state: "publishing", slug: "cliente", url: "x", repoFullName: "org/cliente", branch: "main", configuredAt: null, lastRun: null, publishedSha: null, publishedAt: null, detail: null } })],
    });
    expect(projectStatus(publicando).stage).toBe("dev-publishing");
  });

  it("versão validada que ainda não foi ao GitHub: o card cobra o envio, mesmo com o site entregue", () => {
    const entregue = {
      repoFullName: "org/cliente",
      deliveredAt: "2026-10-08T00:00:00.000Z",
      previewState: "alive" as const,
      clientUrl: "https://aprovacao.exemplo.com.br/cliente/",
      claudeValidatedAt: "2026-10-09T10:00:00.000Z",
    };
    const resumo = claude({ slug: "s", site: site(), lastRun: ultima({ type: "ajuste" }) });

    // O ajuste foi validado depois do último envio (quem pediu não pode publicar).
    const pendente = projeto({ claude: resumo, generations: [siteDoClaude({ ...entregue, claudePushedAt: "2026-10-08T10:00:00.000Z" })] });
    expect(etapaE(pendente)).toEqual(["to-github", "Enviar ao GitHub", true]);
    expect(nextStep(pendente).kind).toBe("push-claude");
    expect(projectStatus(pendente).detail).toMatch(/ainda não foi ao GitHub/);

    // O envio automático falhou: o motivo aparece no próprio card.
    const falhou = projeto({
      claude: { ...resumo, push: { state: "failed", at: "2026-10-09T10:01:00.000Z", by: "Ana", automatic: true, message: "O site importa um pacote que o template não tem: zod." } },
      generations: [siteDoClaude({ ...entregue, claudePushedAt: "2026-10-08T10:00:00.000Z" })],
    });
    expect(projectStatus(falhou).detail).toBe("O envio ao GitHub falhou: O site importa um pacote que o template não tem: zod.");

    // Enviado depois da validação: o card volta ao que o site é.
    const emDia = projeto({ claude: resumo, generations: [siteDoClaude({ ...entregue, claudePushedAt: "2026-10-09T10:05:00.000Z" })] });
    expect(projectStatus(emDia).stage).toBe("delivered");
    // E com um ajuste rodando, o envio pendente espera: uma coisa de cada vez.
    const ajustando = projeto({
      claude: { ...resumo, queue: item({ tipo: "ajuste" }) },
      generations: [siteDoClaude({ ...entregue, claudePushedAt: "2026-10-08T10:00:00.000Z" })],
    });
    expect(projectStatus(ajustando).stage).toBe("delivered");
    expect(progressOf(ajustando)?.title).toBe("Ajustando com o Claude");
  });

  it("toda etapa nova tem rótulo, cor e lugar na ordem", () => {
    const novas = stageOrder.filter((stage) => stage.startsWith("claude-"));
    expect(novas).toHaveLength(8);
    for (const stage of novas) {
      expect(stageLabels[stage]).toBeTruthy();
      expect(stageClass[stage]).toBeTruthy();
    }
    expect(new Set(stageOrder).size).toBe(stageOrder.length);
  });
});

describe("motor Claude — andamento, fila de trabalho e avisos", () => {
  it("o andamento do card: a fila, o briefing e as três etapas do site", () => {
    const esperando = progressOf(projeto({ claude: claude({ queue: item({ estado: "esperando", posicao: 3, inicio: null }) }) }));
    expect(esperando).toMatchObject({ kind: "agent", title: "Na fila do Claude · 3º", queued: true, waiting: false });
    expect(esperando?.kind === "agent" && esperando.phases.every((fase) => fase.state === "todo")).toBe(true);

    const escrevendo = progressOf(projeto({ claude: claude({ queue: item({ tipo: "analisar" }) }) }));
    expect(escrevendo).toMatchObject({ title: "Gerando briefing", startedAt: "2026-10-07T12:01:00.000Z" });
    expect(escrevendo?.kind === "agent" && escrevendo.phases.map((fase) => fase.state)).toEqual(["active"]);

    const gerando = progressOf(projeto({ claude: claude({ queue: item({ etapa: "geracao" }) }) }));
    expect(gerando?.kind === "agent" && gerando.phases.map((fase) => [fase.label, fase.state])).toEqual([
      ["Direção criativa", "done"],
      ["Escrevendo o site", "active"],
      ["Revisando", "todo"],
    ]);
    expect(gerando).toMatchObject({ title: "Gerando com o Claude", current: "Escrevendo o site" });
    // Antes de o claude abrir a primeira etapa, vale a primeira.
    const comecando = progressOf(projeto({ claude: claude({ queue: item({ tipo: "continuar" }) }) }));
    expect(comecando?.kind === "agent" && comecando.phases[0].state).toBe("active");

    // Em curso pede atualização automática da lista; a interrompida, não: ela espera uma decisão.
    expect(isInProgress(projeto({ claude: claude({ queue: item() }) }))).toBe(true);
    expect(isInProgress(projeto({ claude: claude({ queue: item({ estado: "interrompida" }) }) }))).toBe(false);
  });

  it("na fila de trabalho, cada situação do Claude cai no grupo do que falta fazer", () => {
    const projetos = [
      projeto({ id: "a", claude: claude({ briefing: briefing("ok") }) }),
      projeto({ id: "b", claude: claude({ briefing: briefing("refused", 1) }) }),
      projeto({ id: "c", claude: claude({ queue: item() }) }),
      projeto({ id: "d", claude: claude({ queue: item({ estado: "interrompida" }) }) }),
      projeto({ id: "e", claude: claude({ site: site({ awaitingApproval: true }) }) }),
      projeto({ id: "f", claude: claude({ site: site({ openStage: "revisao" }) }) }),
      projeto({ id: "g", claude: claude({ queue: item({ estado: "esperando" }) }) }),
    ];
    expect(groupByNextStep(projetos).map((grupo) => [grupo.key, grupo.items.map((p) => p.id)])).toEqual([
      ["claude-failed", ["f"]],
      ["claude-resume", ["d"]],
      ["claude-approve", ["e"]],
      ["claude-fix", ["b"]],
      ["claude-review", ["a"]],
      ["in-progress", ["c", "g"]],
    ]);
    expect(projetos.some(isDone)).toBe(false);
  });

  it("avisa quando o Claude termina, falha ou para esperando alguém", () => {
    const de = (stage: Parameters<typeof stageAlerts>[0] extends ReadonlyMap<string, infer S> ? S : never) => new Map([["p1", stage]]);
    const aviso = (antes: ReturnType<typeof de>, p: Project) => stageAlerts(antes, [p]).map((a) => [a.title, a.tone]);

    expect(aviso(de("claude-briefing"), projeto({ claude: claude({ briefing: briefing("ok") }) }))).toEqual([
      ["Briefing pronto: cliente.com.br", "success"],
    ]);
    expect(aviso(de("claude-briefing"), projeto({ claude: claude({ briefing: briefing("refused", 1) }) }))).toEqual([
      ["Briefing recusado: cliente.com.br", "warning"],
    ]);
    expect(
      aviso(de("claude-building"), projeto({ claude: claude({ site: site({ awaitingApproval: true }) }) })),
    ).toEqual([["Direção para aprovar: cliente.com.br", "warning"]]);
    expect(aviso(de("claude-building"), projeto({ claude: claude({ site: site({ openStage: "geracao" }) }) }))).toEqual([
      ["Site falhou: cliente.com.br", "error"],
    ]);
    expect(aviso(de("claude-building"), projeto({ claude: claude({ site: site() }), generations: [siteDoClaude()] }))).toEqual([
      ["Site pronto: cliente.com.br", "success"],
    ]);
    // Da fila para a execução não é novidade; e o que já estava assim também não.
    expect(aviso(de("claude-queued"), projeto({ claude: claude({ queue: item() }) }))).toEqual([]);
    expect(aviso(de("claude-building"), projeto({ claude: claude({ queue: item() }) }))).toEqual([]);
  });
});
