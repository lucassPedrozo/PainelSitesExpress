import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import {
  UNASSIGNED,
  UNREGISTERED,
  axisTicks,
  buildRows,
  byDeveloper,
  inPeriod,
  median,
  recentActivity,
  segmentsOf,
  summarize,
  timeToLive,
} from "./dashboard-metrics";

/**
 * O dashboard é onde se lê quanto cada projeto demorou e com quem ficou. Um
 * trecho contado duas vezes, ou um projeto atribuído a quem não o gerou, vira
 * cobrança errada.
 */

const DAY = 86_400_000;
const at = (day: number, hour = 9) =>
  new Date(Date.UTC(2026, 8, day, hour)).toISOString();
const NOW = Date.parse(at(30));

const geracao = (over: Partial<Generation> = {}): Generation =>
  ({
    id: "gen-1",
    displayName: "Padaria",
    lovableName: null,
    attachments: 0,
    createdAt: at(4),
    deliveredAt: null,
    deliveredBy: null,
    agentState: "done",
    previewState: "unknown",
    sharePreviewUrl: null,
    devArea: null,
    ...over,
  }) as unknown as Generation;

const projeto = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "[01/09/2026] padaria.com.br",
    alias: null,
    createdTime: at(1),
    fileCount: 5,
    folderCount: 0,
    totalSize: 0,
    kinds: {},
    tagIds: [],
    generations: [],
    brief: null,
    publication: null,
    ...over,
  }) as unknown as Project;

const publicacao = (firstDeployAt: string, lastDeployAt = firstDeployAt) =>
  ({
    domain: "padaria.com.br",
    repoFullName: "org/padaria",
    configuredAt: firstDeployAt,
    configuredBy: "Rui",
    firstDeployAt,
    lastDeployAt,
    lastAttempt: null,
    deploys: [{ at: firstDeployAt, by: "Rui", dryRun: false }],
  }) as Project["publication"];

const linha = (over: Partial<Project> = {}, finishedTagId: string | null = null) =>
  buildRows([projeto(over)], finishedTagId)[0];

describe("buildRows", () => {
  it("sem site: aguardando geração e sem responsável", () => {
    const row = linha();
    expect(row.phase).toBe("waiting");
    expect(row.developerKey).toBe(UNASSIGNED);
    expect(row.closed).toBe(false);
    expect(row.endAt).toBeNull();
  });

  it("o desenvolvedor é quem gerou o site que vale", () => {
    const row = linha({
      generations: [
        geracao({ id: "a", createdBy: "Ana" }),
        geracao({ id: "b", createdAt: at(6), createdBy: "Bia" }),
      ],
    });
    expect(row.developerKey).toBe("Bia");
    // A espera do material acaba no primeiro site, não no refeito.
    expect(row.generatedAt).toBe(Date.parse(at(4)));
    expect(row.phase).toBe("production");
  });

  it("site de antes do registro não ganha um responsável inventado", () => {
    expect(linha({ generations: [geracao()] }).developerKey).toBe(UNREGISTERED);
  });

  it("site vinculado: quem vinculou responde por ele", () => {
    const row = linha({
      generations: [geracao({ origin: "linked", linkedBy: "Caio", createdBy: null })],
    });
    expect(row.developerKey).toBe("Caio");
  });

  it("o fim do projeto é a primeira publicação, não a mais recente", () => {
    const row = linha({
      generations: [geracao({ createdBy: "Ana", deliveredAt: at(6) })],
      publication: publicacao(at(8), at(20)),
    });
    expect(row.phase).toBe("done");
    expect(row.publishedBy).toBe("Rui");
    expect(timeToLive(row)).toBe(7 * DAY);
  });

  it("finalizado pela tag, sem ir ao ar: fecha no último marco e não entra no tempo até o ar", () => {
    const row = linha(
      { tagIds: ["fim"], generations: [geracao({ deliveredAt: at(6) })] },
      "fim",
    );
    expect(row.closed).toBe(true);
    expect(row.endAt).toBe(Date.parse(at(6)));
    expect(timeToLive(row)).toBeNull();
  });
});

describe("segmentsOf", () => {
  it("divide a barra em espera, produção e cliente, sem buracos", () => {
    const row = linha({
      generations: [geracao({ deliveredAt: at(6) })],
      publication: publicacao(at(8)),
    });
    expect(segmentsOf(row, NOW)).toEqual([
      { phase: "waiting", from: Date.parse(at(1)), to: Date.parse(at(4)) },
      { phase: "production", from: Date.parse(at(4)), to: Date.parse(at(6)) },
      { phase: "client", from: Date.parse(at(6)), to: Date.parse(at(8)) },
    ]);
  });

  it("em aberto, o último trecho vai até agora", () => {
    const segmentos = segmentsOf(linha({ generations: [geracao()] }), NOW);
    expect(segmentos.at(-1)).toEqual({ phase: "production", from: Date.parse(at(4)), to: NOW });
  });

  it("marco depois do fim não desenha trecho para trás", () => {
    // Publicado no dia 3 e vinculado ao painel só no dia 4.
    const row = linha({
      generations: [geracao({ deliveredAt: at(10) })],
      publication: publicacao(at(3)),
    });
    const segmentos = segmentsOf(row, NOW);
    expect(segmentos).toEqual([
      { phase: "waiting", from: Date.parse(at(1)), to: Date.parse(at(3)) },
    ]);
  });

  it("no ar sem site registrado: a barra é produção", () => {
    const [segmento] = segmentsOf(linha({ publication: publicacao(at(5)) }), NOW);
    expect(segmento.phase).toBe("production");
  });
});

describe("período", () => {
  const inicio = NOW - 10 * DAY;

  it("mantém o que está em aberto e o que terminou no período", () => {
    expect(inPeriod(linha(), inicio)).toBe(true);
    expect(inPeriod(linha({ publication: publicacao(at(25)) }), inicio)).toBe(true);
    expect(inPeriod(linha({ publication: publicacao(at(8)) }), inicio)).toBe(false);
    expect(inPeriod(linha({ publication: publicacao(at(8)) }), null)).toBe(true);
  });

  it("o resumo conta chegadas e publicações pela data de cada uma", () => {
    const rows = buildRows(
      [
        projeto({ id: "antigo-no-ar", publication: publicacao(at(25)) }),
        projeto({ id: "novo", createdTime: at(28) }),
        projeto({ id: "antigo-parado", generations: [geracao({ createdBy: "Ana" })] }),
      ],
      null,
    );
    const resumo = summarize(rows, inicio);
    expect(resumo.open).toBe(2);
    expect(resumo.waiting).toBe(1);
    expect(resumo.received).toBe(1);
    expect(resumo.live).toBe(1);
    expect(resumo.medianToLive).toBe(24 * DAY);
    // Gerado no dia 4, fora do período.
    expect(resumo.medianToGenerate).toBeNull();
  });
});

describe("byDeveloper", () => {
  it("agrupa por quem gerou; o que não tem nome fica no fim", () => {
    const rows = buildRows(
      [
        projeto({ id: "1" }),
        projeto({ id: "2", generations: [geracao()] }),
        projeto({ id: "3", generations: [geracao({ createdBy: "Ana", deliveredAt: at(6) })] }),
        projeto({
          id: "4",
          generations: [geracao({ createdBy: "Ana", deliveredAt: at(8) })],
          publication: publicacao(at(11)),
        }),
        projeto({ id: "5", generations: [geracao({ createdBy: "Bia" })] }),
      ],
      null,
    );
    const stats = byDeveloper(rows);
    expect(stats.map((dev) => dev.key)).toEqual(["Ana", "Bia", UNREGISTERED, UNASSIGNED]);
    expect(stats[0]).toMatchObject({
      total: 2,
      open: 1,
      delivered: 2,
      live: 1,
      medianToDeliver: 3 * DAY,
      medianToLive: 10 * DAY,
    });
    expect(stats[1].medianToDeliver).toBeNull();
  });
});

describe("recentActivity", () => {
  it("junta os acontecimentos de todos, do mais recente ao mais antigo", () => {
    const rows = buildRows(
      [
        projeto({ id: "1", generations: [geracao({ createdBy: "Ana" })] }),
        projeto({ id: "2", createdTime: at(10) }),
      ],
      null,
    );
    const eventos = recentActivity(rows, null, 2);
    expect(eventos.map((event) => [event.row.project.id, event.title])).toEqual([
      ["2", "Material recebido"],
      ["1", "Site gerado no Lovable"],
    ]);
    expect(recentActivity(rows, Date.parse(at(9)), 10)).toHaveLength(1);
  });
});

describe("median e axisTicks", () => {
  it("mediana de lista par e vazia", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("janela curta marca dias; longa, meses — sem passar de poucas marcas", () => {
    const curto = axisTicks(NOW - 30 * DAY, NOW);
    expect(curto.length).toBeGreaterThanOrEqual(4);
    expect(curto.length).toBeLessThanOrEqual(6);
    expect(curto[0].label).toMatch(/^\d{2}\/\d{2}$/);

    const longo = axisTicks(NOW - 900 * DAY, NOW);
    expect(longo.length).toBeLessThanOrEqual(9);
    expect(longo.every((tick) => tick.at >= NOW - 900 * DAY && tick.at <= NOW)).toBe(true);
  });
});
