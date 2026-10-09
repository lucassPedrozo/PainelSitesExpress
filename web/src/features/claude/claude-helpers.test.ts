import { describe, expect, it } from "vitest";
import type { ClaudeBriefing, ClaudeMaterial, Project } from "@/lib/api";
import {
  briefingToJson,
  fieldValue,
  linesToList,
  listToLines,
  parseBriefingJson,
  sameBriefing,
  servicesOf,
  withDifferentials,
  withField,
  withServices,
} from "./briefing-fields";
import { claudeBatchPlan, claudeBatchPlanFromProject } from "./claude-batch-plan";
import { formatDuration, formatEstimate } from "./claude-text";

const briefing: ClaudeBriefing = {
  empresa: { nome: "Voltagem Auto Elétrica", ramo: "auto elétrica", fundacao: 2015 },
  contato: { whatsapp: "5527999990000" },
  servicos: [{ nome: "Diagnóstico", descricao: "Em uma hora" }],
  diferenciais: ["Atende a domicílio"],
  depoimentos: [{ autor: "Carla", texto: "Resolveram no mesmo dia." }],
};

describe("briefing como campos de formulário", () => {
  it("lê e troca campos simples e aninhados sem tocar no resto", () => {
    expect([fieldValue(briefing, "empresa.nome"), fieldValue(briefing, "empresa.fundacao"), fieldValue(briefing, "objetivo"), fieldValue(briefing, "contato.email")]).toEqual([
      "Voltagem Auto Elétrica",
      "2015",
      "",
      "",
    ]);

    const novo = withField(withField(briefing, "empresa.ramo", "auto elétrica e ar-condicionado"), "objetivo", "Pedir orçamento pelo WhatsApp");
    expect(novo.empresa).toEqual({ nome: "Voltagem Auto Elétrica", ramo: "auto elétrica e ar-condicionado", fundacao: 2015 });
    expect(novo.objetivo).toBe("Pedir orçamento pelo WhatsApp");
    expect(novo.depoimentos).toBe(briefing.depoimentos);
    expect(briefing.empresa?.ramo).toBe("auto elétrica");

    // Campo de grupo que ainda não existe nasce com o grupo.
    expect(withField({}, "contato.email", "a@b.com.br")).toEqual({ contato: { email: "a@b.com.br" } });
  });

  it("campo sem informação fica de fora: apagar o texto tira a chave", () => {
    const semRamo = withField(briefing, "empresa.ramo", "   ");
    expect("ramo" in (semRamo.empresa ?? {})).toBe(false);
    expect("objetivo" in withField({ objetivo: "x" }, "objetivo", "")).toBe(false);
    expect("diferenciais" in withDifferentials(briefing, " \n \n")).toBe(false);
  });

  it("o ano de fundação continua número; o resto é texto como foi digitado", () => {
    expect(withField(briefing, "empresa.fundacao", "2016").empresa?.fundacao).toBe(2016);
    expect(withField(briefing, "empresa.fundacao", "por volta de 2015").empresa?.fundacao).toBe("por volta de 2015");
    expect(withField(briefing, "contato.whatsapp", "5527988880000").contato?.whatsapp).toBe("5527988880000");
  });

  it("listas: diferenciais um por linha, e serviços sem campo vazio", () => {
    expect(listToLines(briefing.diferenciais)).toBe("Atende a domicílio");
    expect(listToLines("não é lista")).toBe("");
    expect(linesToList("  um \n\n dois\n")).toEqual(["um", "dois"]);
    expect(withDifferentials(briefing, "um\ndois").diferenciais).toEqual(["um", "dois"]);

    expect(servicesOf({})).toEqual([]);
    expect(withServices(briefing, [{ nome: "Bateria", descricao: " ", preco: "" }, {}]).servicos).toEqual([{ nome: "Bateria" }, {}]);
  });

  it("a vista em JSON só aceita um objeto, e diz o que há de errado", () => {
    expect(parseBriefingJson(briefingToJson(briefing))).toEqual({ ok: true, value: briefing });
    const quebrado = parseBriefingJson('{ "empresa": ');
    expect(quebrado.ok === false && quebrado.error).toMatch(/não é um JSON válido/);
    for (const texto of ["[]", '"texto"', "null", "3"]) {
      const lido = parseBriefingJson(texto);
      expect(lido.ok === false && lido.error).toMatch(/precisa ser um objeto/);
    }
    expect(sameBriefing(briefing, JSON.parse(briefingToJson(briefing)))).toBe(true);
    expect(sameBriefing(briefing, withField(briefing, "objetivo", "x"))).toBe(false);
    expect(sameBriefing(null, null)).toBe(true);
  });
});

const projeto = (over: Record<string, unknown> = {}): Project =>
  ({ id: "p1", name: "cliente.com.br", generations: [], claude: null, ...over }) as unknown as Project;

const material = (over: Partial<ClaudeMaterial> = {}): ClaudeMaterial =>
  ({
    prompt: { found: true, text: "Texto do formulário de coleta.", file: null, others: 0 },
    files: [
      { id: "a", name: "fachada.jpg", recommended: true },
      { id: "b", name: "video.mp4", recommended: false },
    ],
    limits: { maxArquivos: 300, maxBytesPorArquivo: 1, maxBytesTotal: 1, maxCaracteresDoTexto: 1, maxCaracteresDasObservacoes: 1 },
    engine: "claude",
    generation: { enabled: true, reason: null },
    ...over,
  }) as unknown as ClaudeMaterial;

const resumo = (over: Record<string, unknown>) => ({ folder: "f", slug: null, queue: null, material: null, briefing: null, site: null, lastRun: null, ...over });

describe("lote do Claude — o pedido de cada projeto", () => {
  it("sem briefing, pede o briefing com o material recomendado", () => {
    expect(claudeBatchPlanFromProject(projeto())).toBeNull();
    expect(claudeBatchPlan(projeto(), material())).toEqual({
      ok: true,
      kind: "briefing",
      summary: "1 arquivo · 30 caracteres de informações",
      warnings: [],
    });
    const semTexto = claudeBatchPlan(projeto({ generations: [{ id: "g" }] }), material({ prompt: { found: false, text: "", file: null, others: 0 } }));
    expect(semTexto).toMatchObject({ ok: true, kind: "briefing", summary: "1 arquivo" });
    expect(semTexto.ok && semTexto.warnings).toEqual([
      "Já tem site gerado — este será outro.",
      "Sem o texto das informações do site: o briefing sai só dos arquivos.",
    ]);
  });

  it("com briefing aceito, pede o site — sem precisar ler o material", () => {
    const plano = claudeBatchPlanFromProject(projeto({ claude: resumo({ briefing: { state: "ok", errors: 0, warnings: 0, checkedAt: "" } }) }));
    expect(plano).toMatchObject({ ok: true, kind: "site" });
  });

  it("o que pede uma decisão fica de fora, com o motivo", () => {
    const motivo = (claude: Record<string, unknown>, generations: unknown[] = []) => {
      const plano = claudeBatchPlanFromProject(projeto({ claude: resumo(claude), generations }));
      return plano && !plano.ok ? plano.reason : null;
    };
    expect(motivo({ queue: { estado: "esperando" } })).toMatch(/Já tem um pedido na fila/);
    expect(motivo({ queue: { estado: "interrompida" } })).toMatch(/execução interrompida/);
    expect(motivo({ briefing: { state: "refused", errors: 2 } })).toMatch(/2 pendências/);
    expect(motivo({ site: { awaitingApproval: true } })).toMatch(/espera aprovação/);
    expect(motivo({ site: { openStage: "geracao" } })).toMatch(/etapa aberta/);
    expect(motivo({ briefing: { state: "ok" } }, [{ id: "ext-1", engine: "claude" }])).toMatch(/Já tem site gerado pelo Claude/);

    const vazio = claudeBatchPlan(projeto(), material({ files: [], prompt: { found: false, text: "  ", file: null, others: 0 } }));
    expect(!vazio.ok && vazio.reason).toMatch(/Sem material para o Claude ler/);
  });
});

describe("textos das execuções", () => {
  it("a duração e a estimativa, sempre com o rótulo de quem estimou", () => {
    expect([formatDuration(null), formatDuration(900), formatDuration(59_400), formatDuration(192_000)]).toEqual([null, "1 s", "59 s", "3 min 12 s"]);
    expect(formatEstimate(0.4242)).toBe("estimativa do Claude Code: US$ 0.42");
    expect(formatEstimate(null)).toBeNull();
  });
});
