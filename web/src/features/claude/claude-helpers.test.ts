import { describe, expect, it } from "vitest";
import type { ClaudeBriefing, ClaudeCritique, ClaudeMaterial, ClaudeOptions, ClaudeSiteOptions, Project } from "@/lib/api";
import {
  BRIEFING_GROUPS,
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
import {
  ART_DIRECTIONS,
  MOTIONS,
  OUTRO_MODELO,
  PADRAO,
  choicesLine,
  choicesSentence,
  defaultLabel,
  effortLabel,
  levelHelp,
  levelLabel,
  modelLabel,
  modelSelection,
  roundsLabel,
  routeChoiceHelp,
  routeChoiceValue,
  sameChoices,
  sameSiteOptions,
  siteOptionsDraft,
  siteOptionsPayload,
  siteOptionsProblem,
} from "./claude-options";
import {
  critiqueGroups,
  critiqueScores,
  pipelineNote,
  pipelineSteps,
  problemsSummary,
  scoresSentence,
} from "./claude-pipeline";
import {
  continueTexts,
  formatDuration,
  formatEstimate,
  pausedNotice,
  requestLabels,
  requestOrigin,
} from "./claude-text";

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

  it("os campos que a direção de arte lê ficam com o tom e o visual, em texto de várias linhas", () => {
    const doSite = BRIEFING_GROUPS.find((grupo) => grupo.fields.some((campo) => campo.path === "tom_desejado"));
    expect(doSite?.fields.map((campo) => campo.path)).toEqual([
      "objetivo",
      "publico",
      "sobre",
      "tom_desejado",
      "personalidade",
      "mundo_visual",
      "preferencias_visuais",
      "evitar",
    ]);
    for (const path of ["personalidade", "mundo_visual", "evitar"]) {
      expect(doSite?.fields.find((campo) => campo.path === path)?.multiline).toBe(true);
    }
    expect(withField({}, "mundo_visual", "Bancada de aço, cabos coloridos").mundo_visual).toBe("Bancada de aço, cabos coloridos");
    expect("evitar" in withField({ evitar: "Fotos de banco de carros" }, "evitar", " ")).toBe(false);
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
    // Site nas rodadas, com a sequência parada: gerar de novo faria outro site.
    expect(motivo({ briefing: { state: "ok" }, site: { delivered: false, next: "criticar" } })).toMatch(/parou antes da entrega/);
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

const padroes: ClaudeOptions["defaults"] = {
  modelo: "claude-opus-5-5",
  esforco: "high",
  rodadas: 2,
  direcao_de_arte: "autoral",
  movimento: "expressivo",
  escolher_rota: false,
  modelos: [
    { id: "claude-opus-5-5", rotulo: "Opus 5.5" },
    { id: "claude-fable-5-1", rotulo: "Fable 5.1" },
    { id: "claude-sonnet-5-5", rotulo: "Sonnet 5.5" },
  ],
  esforcos: ["low", "medium", "high", "xhigh", "max"],
};

describe("opções do projeto — o padrão do painel aparece, mas não é mandado como escolha", () => {
  it("o rótulo do padrão diz o que vale hoje, em cada opção", () => {
    expect([
      defaultLabel(modelLabel(padroes.modelo, padroes.modelos)),
      defaultLabel(effortLabel(padroes.esforco)),
      defaultLabel(roundsLabel(padroes.rodadas)),
      defaultLabel(levelLabel(ART_DIRECTIONS, padroes.direcao_de_arte)),
      defaultLabel(levelLabel(MOTIONS, padroes.movimento)),
      defaultLabel(null),
    ]).toEqual([
      "Padrão do painel (Opus 5.5)",
      "Padrão do painel (Alto)",
      "Padrão do painel (2 rodadas)",
      "Padrão do painel (Autoral)",
      "Padrão do painel (Expressivo)",
      "Padrão do painel",
    ]);
    expect([roundsLabel(1), effortLabel("xhigh"), effortLabel("max")]).toEqual(["1 rodada", "Muito alto", "Máximo"]);
    // O que a tela não conhece vai como veio, em vez de sumir.
    expect([effortLabel("turbo"), modelLabel("opus", padroes.modelos), levelLabel(MOTIONS, "parado")]).toEqual(["turbo", "opus", "parado"]);
  });

  it("a frase de cada nível é a do que vale: o escolhido ou, sem escolha, o padrão", () => {
    expect(levelHelp(ART_DIRECTIONS, null, "ousada")).toMatch(/comportam risco/);
    expect(levelHelp(ART_DIRECTIONS, "sobria", "ousada")).toMatch(/sobriedade/);
    expect(levelHelp(MOTIONS, null, "discreto")).toMatch(/fica parada/);
    expect(levelHelp(MOTIONS, "desconhecido", "discreto")).toBeNull();
    expect(routeChoiceHelp(true)).toMatch(/aprova a escolhida ou pede outra/);
    expect([routeChoiceValue(null), routeChoiceValue(true), routeChoiceValue(false)]).toEqual([null, "sim", "nao"]);
  });

  it("o seletor de modelo: o padrão, um dos conhecidos ou um id digitado", () => {
    const marcado = (modelo: string | null, digitando = false) => modelSelection(modelo, padroes.modelos, digitando);
    expect([marcado(null), marcado("claude-sonnet-5-5"), marcado("opus"), marcado(null, true), marcado("claude-opus-5-5", true)]).toEqual([
      PADRAO,
      "claude-sonnet-5-5",
      OUTRO_MODELO,
      OUTRO_MODELO,
      OUTRO_MODELO,
    ]);
  });

  it("o modelo e o esforço em uso: no ensaio com o valor que vai ao claude, na frase com a origem", () => {
    const nada = { modelo: null, esforco: null };
    expect(choicesLine(nada, padroes)).toBe(
      "Modelo: Opus 5.5 (claude-opus-5-5), padrão do painel · Esforço: Alto (high), padrão do painel",
    );
    expect(choicesLine({ modelo: "sonnet", esforco: "max" }, padroes)).toBe("Modelo: sonnet · Esforço: Máximo (max)");
    expect(choicesSentence(nada, padroes)).toBe("modelo Opus 5.5 e esforço alto, os padrões do painel");
    expect(choicesSentence({ modelo: "claude-fable-5-1", esforco: "xhigh" }, padroes)).toBe(
      "modelo Fable 5.1 e esforço muito alto, escolhidos para este projeto",
    );
    expect(choicesSentence({ modelo: "claude-sonnet-5-5", esforco: null }, padroes)).toBe(
      "modelo Sonnet 5.5 (deste projeto) e esforço alto (padrão do painel)",
    );
    expect(sameChoices(nada, { modelo: null, esforco: null })).toBe(true);
    expect(sameChoices(nada, { modelo: null, esforco: "high" })).toBe(false);
  });

  it("o corpo das opções do site vai inteiro, e o que não foi escolhido vai como null", () => {
    // Sem briefing, ou num briefing de antes das opções de criação: tudo no padrão.
    expect(siteOptionsPayload(siteOptionsDraft(null))).toEqual({
      multiplas_paginas: false,
      banco_de_imagens: true,
      skills: [],
      observacoes: "",
      rodadas: null,
      direcao_de_arte: null,
      movimento: null,
      escolher_rota: null,
      referencias: { links: [], notas: "" },
    });
    const antigo = { multiplas_paginas: true, banco_de_imagens: false, skills: ["a"], observacoes: "x" } as ClaudeSiteOptions;
    expect(siteOptionsPayload(siteOptionsDraft(antigo))).toMatchObject({ multiplas_paginas: true, rodadas: null, referencias: { links: [], notas: "" } });

    const gravadas: ClaudeSiteOptions = {
      multiplas_paginas: false,
      banco_de_imagens: true,
      skills: ["tipografia", "movimento"],
      observacoes: "Destacar a oficina",
      rodadas: 3,
      direcao_de_arte: "ousada",
      movimento: null,
      escolher_rota: true,
      referencias: { links: ["https://a.com.br/", "https://b.com/"], notas: "A tipografia da primeira" },
    };
    const rascunho = siteOptionsDraft(gravadas);
    expect(rascunho.links).toBe("https://a.com.br/\nhttps://b.com/");
    expect(siteOptionsPayload(rascunho)).toEqual(gravadas);

    // Links um por linha, sem linha vazia; notas sem as bordas.
    const editado = { ...rascunho, links: "  a.com.br \n\n https://c.com.br\n", notas: "  só o menu  ", rodadas: null };
    expect(siteOptionsPayload(editado)).toMatchObject({
      rodadas: null,
      referencias: { links: ["a.com.br", "https://c.com.br"], notas: "só o menu" },
    });

    expect(sameSiteOptions(rascunho, siteOptionsDraft(gravadas))).toBe(true);
    expect(sameSiteOptions(rascunho, { ...rascunho, skills: ["movimento", "tipografia"] })).toBe(true);
    expect(sameSiteOptions(rascunho, { ...rascunho, links: `${rascunho.links}\n` })).toBe(true);
    expect(sameSiteOptions(rascunho, editado)).toBe(false);
    expect(sameSiteOptions(rascunho, { ...rascunho, escolher_rota: null })).toBe(false);
  });

  it("o que o motor recusaria é dito antes de gastar: links demais e notas longas demais", () => {
    const rascunho = siteOptionsDraft(null);
    expect(siteOptionsProblem(rascunho)).toBeNull();
    expect(siteOptionsProblem({ ...rascunho, links: "a.com\nb.com\nc.com\nd.com\ne.com" })).toBeNull();
    expect(siteOptionsProblem({ ...rascunho, links: "a.com\nb.com\nc.com\nd.com\ne.com\nf.com" })).toBe(
      "As referências têm 6 links; o limite é 5 por site.",
    );
    expect(siteOptionsProblem({ ...rascunho, notas: "x".repeat(1200) })).toBeNull();
    expect(siteOptionsProblem({ ...rascunho, notas: "x".repeat(1201) })).toBe(
      "As notas das referências têm 1.201 caracteres; o limite é 1.200.",
    );
  });
});

describe("textos do pipeline — o pedido, quem o pôs na fila e o que Continuar roda", () => {
  it("os pedidos novos têm nome, e o que saiu do motor não tem mais", () => {
    expect([requestLabels.criticar, requestLabels.refinar, requestLabels.continuar]).toEqual(["Crítica", "Refino", "Continuação"]);
    expect(Object.keys(requestLabels).sort()).toEqual(["ajuste", "analisar", "cliente", "continuar", "criticar", "refinar"]);
  });

  it("o pedido que o painel pôs na fila sozinho é dito assim, com o nome de quem pediu o site", () => {
    expect([
      requestOrigin({ por: "Ana", encadeado: false }),
      requestOrigin({ por: "Ana", encadeado: true }),
      requestOrigin({ por: null, encadeado: true }),
      requestOrigin({ por: null, encadeado: false }),
    ]).toEqual(["por Ana", "seguiu sozinho, do pedido de Ana", "seguiu sozinho", null]);
  });

  it("Continuar diz o que vai rodar: a continuação, a crítica ou o refino", () => {
    const critica = continueTexts("criticar", { rodada: "rodada 1 de 2" });
    expect([critica.button, critica.confirmTitle, critica.confirmLabel, critica.queued]).toEqual([
      "Rodar a crítica",
      "Rodar a crítica do site?",
      "Rodar a crítica e usar a assinatura",
      "Crítica na fila do Claude",
    ]);
    expect(critica.confirmBody).toMatch(/não escreveu o site.*crítica da rodada 1 de 2\. Depois disso, o painel põe na fila sozinho/);

    const refino = continueTexts("refinar", { rodada: "rodada 2 de 2" });
    expect([refino.button, refino.confirmLabel]).toEqual(["Rodar o refino", "Rodar o refino e usar a assinatura"]);
    expect(refino.confirmBody).toMatch(/corrige o que a crítica da rodada 2 de 2 apontou/);
    // Sem saber a rodada, a frase não a inventa.
    expect(continueTexts("refinar").confirmBody).toMatch(/o que a crítica apontou/);

    const aberta = continueTexts("continuar", { aberta: "revisão" });
    expect([aberta.button, aberta.confirmTitle, aberta.confirmLabel]).toEqual([
      "Continuar de onde parou",
      "Continuar a geração?",
      "Continuar e usar a assinatura",
    ]);
    expect(aberta.confirmBody).toMatch(/segue da etapa de revisão\./);
    const parada = continueTexts("continuar");
    expect([parada.button, parada.confirmTitle]).toEqual(["Continuar a criação do site", "Continuar a criação do site?"]);
    expect(parada.confirmBody).toMatch(/segue de onde a criação parou\./);
  });

  it("o aviso da sequência parada diz antes do quê ela parou", () => {
    expect(pausedNotice("criticar", "rodada 1 de 2").title).toBe("A criação do site parou antes da crítica · rodada 1 de 2");
    expect(pausedNotice("refinar").title).toBe("A criação do site parou antes do refino");
    expect(pausedNotice("continuar").title).toBe("A criação do site parou antes de terminar");
    expect(pausedNotice("refinar").description).toMatch(/rode o refino/);
  });
});

const parecer = (over: Partial<ClaudeCritique> = {}): ClaudeCritique => ({
  rodada: 1,
  veredito: "refinar",
  resumo: "O site tem uma ideia clara, mas a tipografia ainda é a de qualquer oficina.",
  notas: { unicidade: 6, composicao: 8, tipografia: 5, espacamento: 8, responsividade: 9, movimento: 7, texto: 8, acabamento: 8 },
  problemas: [
    { gravidade: "leve", onde: "Rodapé", problema: "Os links estão apertados.", correcao: "Dar mais espaço entre eles." },
    { gravidade: "grave", onde: "Abertura, no celular", problema: "O título quebra em quatro linhas.", correcao: "Reduzir a escala no celular." },
    { gravidade: "leve", onde: "Serviços", problema: "Ícones genéricos.", correcao: "Trocar por fotos da oficina." },
  ],
  ...over,
});

describe("a linha da criação e a última crítica", () => {
  const linha = (pipeline: { rodadas: number; rodada: number; fase: Parameters<typeof pipelineSteps>[0]["fase"] }, critica: ClaudeCritique | null = null) =>
    pipelineSteps(pipeline, critica).map((passo) => `${passo.label}:${passo.state}`);

  it("mostra onde o site está, do briefing à entrega, com a crítica e o refino de cada rodada", () => {
    expect(linha({ rodadas: 2, rodada: 1, fase: "refino" }, parecer())).toEqual([
      "Direção:done",
      "Geração:done",
      "Revisão:done",
      "Crítica 1:done",
      "Refino 1:current",
      "Crítica 2:todo",
      "Refino 2:todo",
      "Entregue:todo",
    ]);
    expect(linha({ rodadas: 1, rodada: 0, fase: "geracao" })).toEqual([
      "Direção:done",
      "Geração:current",
      "Revisão:todo",
      "Crítica 1:todo",
      "Refino 1:todo",
      "Entregue:todo",
    ]);
    // Esperando aprovação, o site está na direção — e o passo diz o que espera.
    expect(linha({ rodadas: 1, rodada: 0, fase: "aprovacao" }).slice(0, 2)).toEqual([
      "Direção · esperando aprovação:current",
      "Geração:todo",
    ]);
    // Site de antes das rodadas: a revisão é o fim.
    expect(linha({ rodadas: 0, rodada: 0, fase: "entregue" })).toEqual(["Direção:done", "Geração:done", "Revisão:done", "Entregue:done"]);
  });

  it("entregue antes da última rodada: o que a crítica dispensou não aparece como feito", () => {
    const aprovou = parecer({ veredito: "aprovado", problemas: [] });
    expect(linha({ rodadas: 2, rodada: 1, fase: "entregue" }, aprovou)).toEqual([
      "Direção:done",
      "Geração:done",
      "Revisão:done",
      "Crítica 1:done",
      "Refino 1:skipped",
      "Crítica 2:skipped",
      "Refino 2:skipped",
      "Entregue:done",
    ]);
    expect(pipelineNote({ rodadas: 2, rodada: 1, fase: "entregue" }, aprovou)).toMatch(/rodada 1 aprovou o site.*rodadas seguintes/);
    expect(pipelineNote({ rodadas: 1, rodada: 1, fase: "entregue" }, aprovou)).toMatch(/o refino dela não foi necessário/);

    // Todas as rodadas feitas: a última crítica pediu refino, e ele rodou.
    const completo = parecer({ rodada: 2 });
    expect(linha({ rodadas: 2, rodada: 2, fase: "entregue" }, completo).every((passo) => passo.endsWith(":done"))).toBe(true);
    expect(pipelineNote({ rodadas: 2, rodada: 2, fase: "entregue" }, completo)).toBeNull();
    expect(pipelineNote({ rodadas: 2, rodada: 1, fase: "refino" }, parecer())).toBeNull();
  });

  it("as notas na ordem do motor, com a de aprovação em 8 dita por extenso", () => {
    const notas = critiqueScores(parecer().notas);
    expect(notas.map((nota) => nota.label)).toEqual([
      "Unicidade",
      "Composição",
      "Tipografia",
      "Espaçamento",
      "Responsividade",
      "Movimento",
      "Texto",
      "Acabamento",
    ]);
    expect(notas.filter((nota) => !nota.passing).map((nota) => [nota.key, nota.score])).toEqual([
      ["unicidade", 6],
      ["tipografia", 5],
      ["movimento", 7],
    ]);
    expect(scoresSentence(notas)).toBe(
      "Notas de 0 a 10; a partir de 8 o critério não pede mais trabalho. Ficaram abaixo: unicidade, tipografia e movimento.",
    );
    expect(scoresSentence(critiqueScores({ texto: 9, acabamento: 7 }))).toMatch(/Ficou abaixo: acabamento\.$/);
    expect(scoresSentence(critiqueScores({ texto: 9 }))).toMatch(/Todos chegaram lá\.$/);
    // Um critério que a tela não conhece vai ao fim, com o nome que veio.
    expect(critiqueScores({ acessibilidade: 4, texto: 9 }).map((nota) => nota.label)).toEqual(["Texto", "acessibilidade"]);
  });

  it("os problemas por gravidade, do mais grave ao mais leve", () => {
    const grupos = critiqueGroups(parecer().problemas);
    expect(grupos.map((grupo) => [grupo.label, grupo.items.map((item) => item.onde)])).toEqual([
      ["Graves", ["Abertura, no celular"]],
      ["Leves", ["Rodapé", "Serviços"]],
    ]);
    expect(problemsSummary(parecer().problemas)).toBe("3 problemas apontados: 1 grave e 2 leves");
    expect(
      problemsSummary([
        ...parecer().problemas,
        { gravidade: "media", onde: "Sobre", problema: "Texto longo.", correcao: "Cortar pela metade." },
      ]),
    ).toBe("4 problemas apontados: 1 grave, 1 médio e 2 leves");
    expect(problemsSummary(parecer().problemas.slice(0, 1))).toBe("1 problema apontado: 1 leve");
  });
});
