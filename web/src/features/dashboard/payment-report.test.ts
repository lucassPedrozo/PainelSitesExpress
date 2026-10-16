import { describe, expect, it } from "vitest";
import type { Generation, Project } from "@/lib/api";
import { buildRows } from "./dashboard-metrics";
import { buildReport, csvField, reportCsv, reportFileName, reportTotals, type ReportFilters } from "./payment-report";

/**
 * O relatório paga os desenvolvedores: um site a mais é pagamento em dobro,
 * um a menos é alguém sem receber. Cada regra daqui tem um caso.
 */

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

const geracao = (over: Partial<Generation> = {}): Generation =>
  ({
    id: "gen-1",
    createdAt: at(2),
    createdBy: "Ana",
    deliveredAt: null,
    deliveredBy: null,
    agentState: "done",
    previewState: "alive",
    sharePreviewUrl: "https://lovable.app/x",
    clientUrl: "https://link.exemplo.com.br/x",
    devArea: null,
    ...over,
  }) as unknown as Generation;

const projeto = (id: string, over: Partial<Project> = {}): Project =>
  ({
    id,
    name: `[01/10/2026] ${id}.com.br`,
    alias: null,
    domain: `${id}.com.br`,
    createdTime: at(1),
    fileCount: 5,
    folderCount: 0,
    totalSize: 1,
    kinds: {},
    tagIds: [],
    generations: [],
    brief: null,
    publication: null,
    webViewLink: "https://drive.exemplo/pasta",
    domainCollections: 1,
    ...over,
  }) as unknown as Project;

const publicacao = (domain: string, over: object = {}) => ({
  domain,
  repoFullName: `org/${domain}`,
  configuredAt: at(6),
  lastDeployAt: null,
  firstDeployAt: null,
  lastAttempt: null,
  deploys: [],
  ...over,
});

const filtros = (over: Partial<ReportFilters> = {}): ReportFilters => ({
  etapas: ["cliente", "publicacao"],
  developer: null,
  from: "",
  to: "",
  dateField: "delivered",
  onePerDomain: true,
  includeFinished: false,
  ...over,
});

const lista = [
  // Cliente: pronto para enviar, e já com o cliente.
  projeto("pronto", { generations: [geracao()] }),
  projeto("enviado", { generations: [geracao({ createdBy: "Bruno", deliveredAt: at(5), deliveredBy: "Bruno" })] }),
  // Publicação em andamento.
  projeto("publicando", {
    generations: [geracao({ deliveredAt: at(4) })],
    publication: publicacao("publicando.com.br", { lastAttempt: { at: at(7), status: "pending", runUrl: null } }),
  } as never),
  // No ar, e a recoleta do mesmo domínio (sem site: herda a publicação).
  projeto("noar", {
    generations: [geracao({ deliveredAt: at(3) })],
    publication: publicacao("noar.com.br", { lastDeployAt: at(8), firstDeployAt: at(8) }),
  } as never),
  projeto("noar-recoleta", {
    domain: "noar.com.br",
    createdTime: at(9),
    publication: publicacao("noar.com.br", { lastDeployAt: at(8), firstDeployAt: at(8) }),
  } as never),
  // Ainda na geração.
  projeto("gerar"),
];
const rows = buildRows(lista, null);

describe("buildReport", () => {
  it("traz só as etapas escolhidas, com a situação fina de cada uma", () => {
    const { rows: linhas } = buildReport(rows, filtros());
    expect(linhas.map((linha) => [linha.domain, linha.etapaLabel, linha.situation])).toEqual([
      ["pronto.com.br", "Cliente", "Pronto para enviar"],
      ["publicando.com.br", "Publicação", "Publicando"],
      ["enviado.com.br", "Cliente", "Com o cliente"],
    ]);
  });

  it("o desenvolvedor é o do Dashboard; o filtro por ele separa o de cada um", () => {
    const { rows: daAna } = buildReport(rows, filtros({ developer: "Ana" }));
    expect(daAna.map((linha) => linha.domain)).toEqual(["pronto.com.br", "publicando.com.br"]);
    expect(daAna.every((linha) => linha.developer === "Ana" && linha.generatedBy === "Ana")).toBe(true);
  });

  it("um domínio, um site: a recoleta fica de fora e é contada", () => {
    const um = buildReport(rows, filtros({ etapas: ["no-ar"] }));
    expect(um.rows.map((linha) => linha.id)).toEqual(["noar"]);
    expect(um.duplicates).toBe(1);
    const todos = buildReport(rows, filtros({ etapas: ["no-ar"], onePerDomain: false }));
    expect(todos.rows).toHaveLength(2);
    expect(todos.duplicates).toBe(0);
  });

  it("o período filtra pela data escolhida, com os dois dias inclusos; quem não tem a data sai e é contado", () => {
    const resultado = buildReport(rows, filtros({ from: "2026-10-04", to: "2026-10-05" }));
    expect(resultado.rows.map((linha) => linha.domain)).toEqual(["publicando.com.br", "enviado.com.br"]);
    // "pronto" ainda não foi enviado: sem a data de envio, não está no período.
    expect(resultado.withoutDate).toBe(1);
    expect(buildReport(rows, filtros({ from: "2026-10-05", to: "2026-10-05" })).rows.map((l) => l.domain)).toEqual([
      "enviado.com.br",
    ]);
  });

  it("a etapa escolhida à mão vem marcada, e o responsável definido vira o desenvolvedor", () => {
    const manual = projeto("manual", {
      generations: [geracao({ createdBy: "Ana" })],
      details: {
        domain: null,
        receivedAt: null,
        responsible: "Carla",
        note: "=SOMA(A1)",
        stage: { etapa: "publicacao", at: at(20), by: "Lucas" },
      },
    } as never);
    const [linha] = buildReport(buildRows([manual], null), filtros({ etapas: ["publicacao"] })).rows;
    expect([linha.manual, linha.developer, linha.responsible, linha.generatedBy]).toEqual([true, "Carla", "Carla", "Ana"]);
  });
});

describe("os ocultos", () => {
  it("ficam fora das contas do Dashboard e, com isso, do relatório", () => {
    const oculto = projeto("teste", {
      generations: [geracao({ deliveredAt: at(5) })],
      details: { hidden: { at: at(6), by: "Ana" } },
    } as never);
    expect(buildRows([oculto], null)).toHaveLength(0);
    expect(buildReport(buildRows([...lista, oculto], null), filtros()).rows.map((linha) => linha.id)).not.toContain("teste");
  });
});

describe("os finalizados", () => {
  it("ficam de fora por padrão e são contados; ligados, entram com a marca", () => {
    const finalizado = projeto("pago", {
      tagIds: ["fim"],
      generations: [geracao({ deliveredAt: at(3) })],
      publication: publicacao("pago.com.br", { lastDeployAt: at(4), firstDeployAt: at(4) }),
    } as never);
    const linhas = buildRows([finalizado], "fim");
    const fora = buildReport(linhas, filtros({ etapas: ["no-ar"] }));
    expect([fora.rows.length, fora.finished]).toEqual([0, 1]);
    const dentro = buildReport(linhas, filtros({ etapas: ["no-ar"], includeFinished: true }));
    expect([dentro.rows.length, dentro.rows[0].finished, dentro.finished]).toEqual([1, true, 0]);
  });
});

describe("a planilha", () => {
  it("abre no Excel em português: marca de UTF-8, ponto e vírgula, datas dd/mm/aaaa e CRLF", () => {
    const csv = reportCsv(buildReport(rows, filtros()).rows);
    expect(csv.startsWith("﻿Domínio;Projeto;Etapa;Situação;")).toBe(true);
    const linhas = csv.split("\r\n");
    expect(linhas).toHaveLength(5); // cabeçalho, 3 sites e a linha final vazia
    expect(linhas[3]).toContain("enviado.com.br;");
    expect(linhas[3]).toContain(";05/10/2026;Bruno;");
  });

  it("aspas, ponto e vírgula e quebra de linha vão entre aspas; fórmula não roda", () => {
    expect(csvField("simples")).toBe("simples");
    expect(csvField('a;b "c"')).toBe('"a;b ""c"""');
    expect(csvField("linha\nnova")).toBe('"linha\nnova"');
    expect(csvField("=SOMA(A1)")).toBe("'=SOMA(A1)");
    expect(csvField("-10")).toBe("'-10");
    expect(csvField("@cliente")).toBe("'@cliente");
  });

  it("os totais por desenvolvedor somam as linhas, por etapa", () => {
    const totais = reportTotals(buildReport(rows, filtros()).rows);
    expect(totais.map((total) => [total.developer, total.total])).toEqual([
      ["Ana", 2],
      ["Bruno", 1],
    ]);
    expect(totais[0].etapas.get("cliente")).toBe(1);
    expect(totais.reduce((soma, total) => soma + total.total, 0)).toBe(3);
  });

  it("o nome do arquivo diz as etapas e o dia", () => {
    expect(reportFileName(filtros({ etapas: ["publicacao", "cliente"] }), new Date(2026, 9, 14).getTime())).toBe(
      "relatorio-cliente-publicacao-2026-10-14.csv",
    );
  });
});
