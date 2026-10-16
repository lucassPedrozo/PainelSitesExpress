import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import { formatSpan, projectTimeline, timelineSummary } from "./project-timeline";

/**
 * A linha do tempo é o que se lê para saber quanto um projeto esperou e quem
 * fez cada passo. Um acontecimento fora de ordem, ou um responsável inventado,
 * leva a cobrar a pessoa errada.
 */

const geracao = (over: Partial<Generation> = {}): Generation =>
  ({
    id: "gen-1",
    displayName: "Padaria",
    lovableName: null,
    workspaceName: "Agência",
    attachments: 3,
    createdAt: "2026-09-04T12:00:00.000Z",
    deliveredAt: null,
    deliveredBy: null,
    shortUrl: null,
    clientUrl: null,
    devArea: null,
    repoFullName: null,
    ...over,
  }) as unknown as Generation;

const projeto = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "[01/09/2026] padaria.com.br",
    alias: null,
    createdTime: "2026-09-01T09:00:00.000Z",
    fileCount: 12,
    folderCount: 0,
    totalSize: 0,
    kinds: {},
    tagIds: [],
    generations: [],
    brief: null,
    publication: null,
    ...over,
  }) as unknown as Project;

const titulos = (project: Project) => projectTimeline(project).map((event) => event.title);

describe("projectTimeline", () => {
  it("projeto novo: só o recebimento", () => {
    const [recebido, ...resto] = projectTimeline(projeto());
    expect(resto).toEqual([]);
    expect(recebido.title).toBe("Material recebido");
    expect(recebido.at).toBe("2026-09-01T09:00:00.000Z");
    expect(recebido.detail).toContain("12 arquivos");
  });

  it("conta o fluxo inteiro em ordem, do recebimento ao site no ar", () => {
    const project = projeto({
      brief: {
        id: "b",
        name: "Informações do Site - padaria",
        mimeType: "application/pdf",
        createdTime: "2026-09-01T09:05:00.000Z",
      },
      generations: [
        geracao({
          createdBy: "Ana",
          agentDoneAt: "2026-09-04T12:40:00.000Z",
          deliveredAt: "2026-09-05T15:00:00.000Z",
          deliveredBy: "Rui",
          clientUrl: "https://area.dev/padaria/",
          devArea: {
            state: "live",
            url: "https://area.dev/padaria/",
            repoFullName: "org/padaria",
            configuredAt: "2026-09-04T13:00:00.000Z",
            configuredBy: null,
            publishedAt: "2026-09-04T13:06:00.000Z",
            lastRun: { at: "2026-09-04T13:01:00.000Z", status: "success", runUrl: null, sha: "abc" },
          } as never,
        }),
      ],
      publication: {
        domain: "padaria.com.br",
        repoFullName: "org/padaria",
        configuredAt: "2026-09-10T10:00:00.000Z",
        configuredBy: "Rui",
        lastDeployAt: "2026-09-10T10:12:00.000Z",
        lastAttempt: { at: "2026-09-10T10:01:00.000Z", status: "success", runUrl: null },
        deploys: [{ at: "2026-09-10T10:01:00.000Z", by: "Rui", dryRun: false }],
      },
    });

    expect(titulos(project)).toEqual([
      "Material recebido",
      "Briefing recebido",
      "Site gerado no Lovable",
      "Construção concluída no Lovable",
      "Publicação na área de aprovação configurada",
      "Prévia no ar na área de aprovação",
      "Link enviado ao cliente",
      "Publicação no domínio configurada",
      "Publicação disparada",
      "Site no ar no domínio",
    ]);

    const eventos = projectTimeline(project);
    const gerado = eventos.find((event) => event.icon === "lovable")!;
    expect(gerado.by).toBe("Ana");
    expect(gerado.byMissing).toBe(false);
    expect(gerado.detail).toBe("Padaria · 3 anexos · Agência");
    expect(eventos.find((event) => event.icon === "built")!.detail).toContain("40 min");
    expect(eventos.find((event) => event.icon === "delivered")!.by).toBe("Rui");
    // O painel publicou sozinho na área: não há autor, e nada falta.
    const area = eventos.find((event) => event.key.endsWith("-approval"))!;
    expect(area.by).toBeNull();
    expect(area.byMissing).toBe(false);
  });

  it("geração de antes do registro: o responsável falta, não é inventado", () => {
    const [, gerado] = projectTimeline(projeto({ generations: [geracao()] }));
    expect(gerado.by).toBeNull();
    expect(gerado.byMissing).toBe(true);
  });

  it("site vinculado mostra quem vinculou, e não uma geração", () => {
    const eventos = projectTimeline(
      projeto({
        generations: [
          geracao({
            origin: "linked",
            linkedAt: "2026-09-06T10:00:00.000Z",
            linkedBy: "Ana",
            repoFullName: "org/padaria",
          }),
        ],
      }),
    );
    expect(eventos.map((event) => event.title)).toEqual([
      "Material recebido",
      "Site vinculado ao projeto",
    ]);
    expect(eventos[1].at).toBe("2026-09-06T10:00:00.000Z");
    expect(eventos[1].by).toBe("Ana");
    expect(eventos[1].byMissing).toBe(false);
  });

  it("material que chega depois do envio original vira um marco", () => {
    // Minutos depois da pasta: ainda é o mesmo envio do formulário.
    expect(titulos(projeto({ lastAdded: "2026-09-01T09:20:00.000Z" }))).toEqual([
      "Material recebido",
    ]);
    expect(titulos(projeto({ lastAdded: "2026-09-03T16:00:00.000Z" }))).toEqual([
      "Material recebido",
      "Material complementado",
    ]);
  });

  it("falhas aparecem com o link do erro", () => {
    const eventos = projectTimeline(
      projeto({
        generations: [
          geracao({
            devArea: {
              state: "failed",
              url: "https://area.dev/padaria/",
              repoFullName: "org/padaria",
              configuredAt: "2026-09-04T13:00:00.000Z",
              publishedAt: null,
              detail: "O build não gerou a pasta dist.",
              lastRun: {
                at: "2026-09-04T13:01:00.000Z",
                status: "failure",
                runUrl: "https://github.com/org/padaria/actions/runs/1",
                sha: null,
              },
            } as never,
          }),
        ],
        publication: {
          domain: "padaria.com.br",
          repoFullName: "org/padaria",
          configuredAt: "2026-09-10T10:00:00.000Z",
          lastDeployAt: null,
          lastAttempt: {
            at: "2026-09-10T10:01:00.000Z",
            status: "failure",
            runUrl: "https://github.com/org/padaria/actions/runs/2",
          },
        },
      }),
    );

    const falhas = eventos.filter((event) => event.tone === "danger");
    expect(falhas.map((event) => event.title)).toEqual([
      "Publicação da prévia falhou",
      "Publicação falhou",
    ]);
    expect(falhas[0].detail).toBe("O build não gerou a pasta dist.");
    expect(falhas[1].detail).toBe("O site não foi ao ar.");
    expect(falhas.every((event) => event.href?.includes("/actions/runs/"))).toBe(true);
  });

  it("ignora datas ausentes ou ilegíveis em vez de quebrar a ordem", () => {
    const eventos = projectTimeline(
      projeto({
        createdTime: "não é data",
        generations: [geracao({ agentDoneAt: null, projectChangedAt: "" })],
      }),
    );
    expect(eventos.map((event) => event.title)).toEqual(["Site gerado no Lovable"]);
  });
});

describe("timelineSummary", () => {
  it("diz quem gerou e quanto cada trecho levou", () => {
    const resumo = timelineSummary(
      projeto({
        generations: [
          geracao({ createdBy: "Ana", deliveredAt: "2026-09-05T15:00:00.000Z" }),
        ],
        publication: {
          domain: "padaria.com.br",
          repoFullName: "org/padaria",
          configuredAt: null,
          lastDeployAt: "2026-09-11T09:00:00.000Z",
          lastAttempt: null,
        },
      }),
    );

    expect(resumo.generation).toEqual({ by: "Ana", linked: false });
    expect(resumo.spans.map((span) => [span.label, formatSpan(span.ms)])).toEqual([
      ["Do recebimento à geração", "3 dias 3 h"],
      ["Da geração ao envio ao cliente", "1 dia 3 h"],
      ["Do recebimento ao ar", "10 dias"],
    ]);
  });

  it("com mais de um site, o tempo de espera é o do primeiro e o responsável é o do atual", () => {
    const resumo = timelineSummary(
      projeto({
        generations: [
          geracao({ id: "gen-1", createdBy: "Ana" }),
          geracao({ id: "gen-2", createdBy: "Rui", createdAt: "2026-09-20T12:00:00.000Z" }),
        ],
      }),
    );
    expect(resumo.generation?.by).toBe("Rui");
    expect(formatSpan(resumo.spans[0].ms)).toBe("3 dias 3 h");
  });

  it("sem site, não há responsável nem trechos", () => {
    expect(timelineSummary(projeto())).toEqual({
      receivedAt: "2026-09-01T09:00:00.000Z",
      generation: null,
      spans: [],
    });
  });
});

describe("formatSpan", () => {
  it("escolhe a unidade pelo tamanho do intervalo", () => {
    expect(formatSpan(20_000)).toBe("menos de 1 min");
    expect(formatSpan(18 * 60_000)).toBe("18 min");
    expect(formatSpan(5 * 3_600_000)).toBe("5 h");
    expect(formatSpan(5 * 3_600_000 + 12 * 60_000)).toBe("5 h 12 min");
    expect(formatSpan(24 * 3_600_000)).toBe("1 dia");
    expect(formatSpan(3 * 86_400_000 + 4 * 3_600_000)).toBe("3 dias 4 h");
    expect(formatSpan(21 * 86_400_000 + 4 * 3_600_000)).toBe("21 dias");
  });
});
