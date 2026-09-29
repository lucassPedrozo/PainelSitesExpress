import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import { projectStatus, stageClass } from "@/features/projects/project-status";

/**
 * A ordem dos estados é a do fluxo de trabalho, e ela decide o que o operador
 * vê primeiro num painel com 60+ projetos. Um estado errado aqui esconde
 * trabalho pendente — ou pior, mostra como pronto o que não está.
 */

const geracao = (over: Partial<Generation> = {}): Generation =>
  ({
    id: "gen-1",
    previewUrl: "https://id-preview--abc.lovable.app",
    displayName: "Site",
    createdAt: "2026-09-04T00:00:00.000Z",
    sharePreviewUrl: null,
    deliveredAt: null,
    deliveredBy: null,
    previewState: "unknown",
    previewDetail: null,
    shortUrl: null,
    ...over,
  }) as unknown as Generation;

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
    brief: null,
    publication: null,
    ...over,
  }) as unknown as Project;

const noAr = {
  domain: "cliente.com.br",
  repoFullName: "org/cliente",
  configuredAt: "2026-09-10T00:00:00.000Z",
  lastDeployAt: "2026-09-10T00:00:00.000Z",
  lastAttempt: {
    at: "2026-09-10T00:00:00.000Z",
    status: "success" as const,
    runUrl: null,
  },
};

describe("projectStatus — precedência", () => {
  it("no ar ganha de tudo, inclusive de link de preview morto", () => {
    // O site publicado aparecia como "Link não abre": o preview do Lovable
    // morreu, mas o cliente já acessa o domínio dele.
    const s = projectStatus(
      projeto({
        publication: noAr,
        generations: [
          geracao({
            sharePreviewUrl: "https://lovable.dev/preview/abc12345",
            previewState: "dead",
          }),
        ],
      }),
    );
    expect(s.stage).toBe("live");
    expect(s.detail).toContain("cliente.com.br");
    expect(s.attention).toBe(false);
  });

  it("configurado sem envio real ainda não está no ar", () => {
    const s = projectStatus(
      projeto({ publication: { ...noAr, lastDeployAt: null, lastAttempt: null } }),
    );
    expect(s.stage).not.toBe("live");
  });

  it("disparo em andamento é 'Publicando', e não 'No ar'", () => {
    const s = projectStatus(
      projeto({
        publication: {
          ...noAr,
          lastDeployAt: null,
          lastAttempt: { at: "2026-09-11T00:00:00.000Z", status: "pending", runUrl: null },
        },
      }),
    );
    expect(s.stage).toBe("deploying");
  });

  it("publicação que falhou passa à frente de no ar, e diz se havia versão anterior", () => {
    const falhou = {
      at: "2026-09-11T00:00:00.000Z",
      status: "failure" as const,
      runUrl: "https://gh/run/1",
    };
    const republicacao = projectStatus(
      projeto({ publication: { ...noAr, lastAttempt: falhou } }),
    );
    expect(republicacao.stage).toBe("deploy-failed");
    expect(republicacao.attention).toBe(true);
    expect(republicacao.detail).toContain("versão anterior");

    const primeira = projectStatus(
      projeto({ publication: { ...noAr, lastDeployAt: null, lastAttempt: falhou } }),
    );
    expect(primeira.stage).toBe("deploy-failed");
    expect(primeira.detail).toContain("não foi ao ar");
  });

  it("link entregue que caiu passa à frente de entregue", () => {
    // Antes o card ficava verde justamente quando o cliente tinha um link
    // morto nas mãos.
    const s = projectStatus(
      projeto({
        generations: [
          geracao({
            deliveredAt: "2026-09-08T00:00:00.000Z",
            sharePreviewUrl: "https://lovable.dev/preview/abc12345",
            previewState: "dead",
          }),
        ],
      }),
    );
    expect(s.stage).toBe("delivered-broken");
    expect(s.attention).toBe(true);
  });

  it("agente parado esperando alguém pede atenção; trabalhando, não", () => {
    const parado = projectStatus(
      projeto({ generations: [geracao({ agentState: "awaiting" } as never)] }),
    );
    expect(parado.stage).toBe("awaiting-input");
    expect(parado.attention).toBe(true);

    const gerando = projectStatus(
      projeto({ generations: [geracao({ agentState: "running" } as never)] }),
    );
    expect(gerando.stage).toBe("building");
    expect(gerando.attention).toBe(false);
  });

  it("entregue com link aberto fica em paz", () => {
    const s = projectStatus(
      projeto({
        generations: [
          geracao({
            deliveredAt: "2026-09-08T00:00:00.000Z",
            deliveredBy: "Ana",
            shortUrl: "https://joinvix.com.br/s/cliente",
            previewState: "alive",
          }),
        ],
      }),
    );
    expect(s.stage).toBe("delivered");
    expect(s.detail).toContain("Ana");
    expect(s.attention).toBe(false);
  });

  it("link curto que abre já está pronto para enviar — sem caixa a marcar", () => {
    const s = projectStatus(
      projeto({
        generations: [
          geracao({ shortUrl: "https://joinvix.com.br/s/cliente", previewState: "alive" }),
        ],
      }),
    );
    expect(s.stage).toBe("ready");
  });

  it("link quebrado passa à frente de site gerado", () => {
    // É o único estado em que algo já feito parou de funcionar, e ninguém
    // descobre sem olhar — por isso ele grita.
    const s = projectStatus(
      projeto({
        generations: [
          geracao({
            sharePreviewUrl: "https://lovable.dev/preview/abc12345",
            previewState: "dead",
          }),
        ],
      }),
    );
    expect(s.stage).toBe("link-broken");
    expect(s.attention).toBe(true);
  });

  it("site gerado pede atenção e diz o que falta", () => {
    const semLink = projectStatus(projeto({ generations: [geracao()] }));
    expect(semLink.stage).toBe("generated");
    expect(semLink.detail).toContain("Share preview");

    const naoVerificado = projectStatus(
      projeto({
        generations: [
          geracao({
            sharePreviewUrl: "https://lovable.dev/preview/abc12345",
            shortUrl: "https://joinvix.com.br/s/cliente",
            previewState: "unknown",
          }),
        ],
      }),
    );
    expect(naoVerificado.stage).toBe("generated");
    expect(naoVerificado.detail).toContain("verificado");
  });
});

describe("projectStatus — antes de gerar", () => {
  it("pasta vazia pede atenção", () => {
    const s = projectStatus(projeto({ fileCount: 0, folderCount: 0 }));
    expect(s.stage).toBe("empty");
    expect(s.attention).toBe(true);
  });

  it("com briefing, está pronto para gerar", () => {
    const s = projectStatus(
      projeto({ brief: { id: "b", name: "Informações do Site" } as never }),
    );
    expect(s.stage).toBe("briefed");
    expect(s.attention).toBe(false);
  });

  it("sem briefing não é erro — dá para descrever ao gerar", () => {
    // Antes o painel escondia o botão Gerar nesse caso; o estado precisa
    // refletir que há caminho, não bloqueio.
    const s = projectStatus(projeto({ brief: null }));
    expect(s.stage).toBe("collected");
    expect(s.attention).toBe(false);
    expect(s.detail).toContain("descreva o site");
  });

  it("a geração mais recente é a que manda", () => {
    const s = projectStatus(
      projeto({
        generations: [
          geracao({ id: "antiga", deliveredAt: "2026-01-01T00:00:00.000Z" }),
          geracao({ id: "nova" }),
        ],
      }),
    );
    expect(s.stage).toBe("generated");
  });
});

describe("stageClass", () => {
  it("cobre todos os estados", () => {
    for (const estado of [
      "deploy-failed",
      "deploying",
      "live",
      "delivered-broken",
      "delivered",
      "ready",
      "awaiting-input",
      "building",
      "link-broken",
      "generated",
      "briefed",
      "empty",
      "collected",
    ] as const) {
      expect(stageClass[estado]).toBeTruthy();
    }
  });
});

describe("projectStatus — área de desenvolvimento", () => {
  const area = (over: Record<string, unknown> = {}) => ({
    state: "live",
    slug: "cliente",
    url: "https://area.dev/cliente/",
    repoFullName: "org/cliente",
    branch: "main",
    configuredAt: "t",
    lastRun: { at: "t", status: "success", runUrl: "https://gh/run/9", sha: "abc" },
    publishedSha: "abc",
    publishedAt: "t",
    detail: null,
    ...over,
  });

  it("sem repositório, pede para conectar ao GitHub no Lovable", () => {
    const s = projectStatus(
      projeto({ generations: [geracao({ devArea: area({ state: "waiting-repo", lastRun: null, publishedSha: null }) } as never)] }),
    );
    expect(s.stage).toBe("connect-github");
    expect(s.attention).toBe(true);
  });

  it("publicando pela primeira vez não está pronto para enviar", () => {
    const s = projectStatus(
      projeto({
        generations: [
          geracao({
            devArea: area({ state: "publishing", publishedSha: null, lastRun: { at: "t", status: "pending", runUrl: null, sha: null } }),
          } as never),
        ],
      }),
    );
    expect(s.stage).toBe("dev-publishing");
  });

  it("com a pasta conferida, o link é ela e está pronto para enviar", () => {
    const s = projectStatus(
      projeto({
        generations: [
          geracao({ devArea: area(), clientUrl: "https://area.dev/cliente/", previewState: "alive" } as never),
        ],
      }),
    );
    expect(s.stage).toBe("ready");
  });

  it("publicação que falhou passa à frente de entregue — o cliente vê a versão velha", () => {
    const s = projectStatus(
      projeto({
        generations: [
          geracao({
            devArea: area({ state: "failed", lastRun: { at: "t", status: "failure", runUrl: "https://gh/run/9", sha: "def" } }),
            clientUrl: "https://area.dev/cliente/",
            previewState: "alive",
            deliveredAt: "2026-09-10T00:00:00.000Z",
          } as never),
        ],
      }),
    );
    expect(s.stage).toBe("dev-failed");
    expect(s.detail).toContain("versão anterior");
  });

  it("pasta que parou de abrir é link quebrado, mesmo sem Share preview", () => {
    const s = projectStatus(
      projeto({
        generations: [geracao({ devArea: area(), clientUrl: "https://area.dev/cliente/", previewState: "dead" } as never)],
      }),
    );
    expect(s.stage).toBe("link-broken");
    expect(s.detail).not.toContain("Share preview");
  });

  it("um site substituído por outro gerado depois não conta", () => {
    const s = projectStatus(
      projeto({ generations: [geracao({ devArea: area({ state: "retired" }) } as never)] }),
    );
    expect(s.stage).toBe("generated");
  });
});
