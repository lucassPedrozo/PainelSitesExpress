import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeCritique,
  ClaudeOptions,
  ClaudeProjectDetail,
  ClaudeReview,
  ClaudeSite,
  ClaudeSiteOptions,
  Project,
} from "@/lib/api";

/**
 * As telas do motor Claude que mudam com as rodadas, renderizadas: a linha da
 * criação e a última crítica, as rotas da direção, o "Continuar" que diz o que
 * roda e as opções na revisão. Sem navegador, é a prova de que cada botão que
 * gasta passa pela confirmação e manda o que a tela mostra.
 */

const fetchMe = vi.fn();
const fetchClaudeProject = vi.fn();
const fetchClaudeStatus = vi.fn();
const fetchClaudeOptions = vi.fn();
const chooseClaudeRoute = vi.fn();
const continueClaudeSite = vi.fn();
const generateClaudeSite = vi.fn();
const saveClaudeOptions = vi.fn();
const setClaudeSiteType = vi.fn();

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchMe: () => fetchMe(),
  fetchClaudeProject: (...args: unknown[]) => fetchClaudeProject(...args),
  fetchClaudeStatus: () => fetchClaudeStatus(),
  fetchClaudeOptions: (...args: unknown[]) => fetchClaudeOptions(...args),
  chooseClaudeRoute: (...args: unknown[]) => chooseClaudeRoute(...args),
  continueClaudeSite: (...args: unknown[]) => continueClaudeSite(...args),
  generateClaudeSite: (...args: unknown[]) => generateClaudeSite(...args),
  saveClaudeOptions: (...args: unknown[]) => saveClaudeOptions(...args),
  setClaudeSiteType: (...args: unknown[]) => setClaudeSiteType(...args),
}));

const { createQueryClient } = await import("@/lib/query");
const { ClaudeBriefingCard } = await import("./claude-briefing-card");
const { ClaudePanel } = await import("./claude-panel");
const { ClaudeApprovalCard, ClaudeContinueCard, ClaudeSiteCard } = await import("./claude-site-card");

const projeto = { id: "p1", name: "[04/09/2026] cliente.com.br", generations: [], claude: null } as unknown as Project;

const opcoesDoProjeto: ClaudeOptions = {
  options: { modelo: null, esforco: null },
  defaults: {
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
  },
  site: null,
};

const critica: ClaudeCritique = {
  rodada: 1,
  veredito: "refinar",
  resumo: "O site tem uma ideia clara, mas a tipografia ainda é a de qualquer oficina.",
  notas: { unicidade: 6, composicao: 8, tipografia: 5, espacamento: 8, responsividade: 9, movimento: 7, texto: 8, acabamento: 8 },
  problemas: [
    { gravidade: "grave", onde: "Abertura, no celular", problema: "O título quebra em quatro linhas.", correcao: "Reduzir a escala no celular." },
    { gravidade: "media", onde: "Serviços", problema: "Os cartões têm alturas diferentes.", correcao: "Alinhar pela base." },
    { gravidade: "media", onde: "Sobre", problema: "O texto passa de noventa caracteres por linha.", correcao: "Estreitar a coluna." },
    { gravidade: "leve", onde: "Rodapé", problema: "Os links estão apertados.", correcao: "Dar mais espaço entre eles." },
    { gravidade: "leve", onde: "Contato", problema: "O botão não tem estado de foco.", correcao: "Desenhar o foco." },
  ],
};

const etapa = (n: number, nome: string, rodada: number | null = null): ClaudeSite["etapas"][number] => ({
  n,
  etapa: nome,
  rodada,
  modo: "headless",
  modelo: "claude-opus-5-5",
  status: "concluida",
  chamadas: 10,
  limite: 80,
  builds: 1,
  errosBuild: 0,
  inicio: "2026-10-07T12:00:00.000Z",
  fim: "2026-10-07T12:10:00.000Z",
  pedido: null,
  motivoFalha: null,
});

/** Por padrão, o site no meio das rodadas: a crítica 1 pediu refino. */
const site = (over: Partial<ClaudeSite> = {}): ClaudeSite => ({
  slug: "cliente-1a2b",
  situacao: "em refino",
  etapaAberta: null,
  aguardandoAprovacao: false,
  entregue: false,
  pipeline: { rodadas: 2, rodada: 1, fase: "refino" },
  proximo: "refinar",
  critica,
  rotas: [],
  brief: null,
  fotosPropostas: [],
  etapas: [etapa(1, "direcao"), etapa(2, "geracao"), etapa(3, "revisao"), etapa(4, "critica", 1)],
  temDist: true,
  telas: [],
  ...over,
});

const opcoesDoSite: ClaudeSiteOptions = {
  multiplas_paginas: false,
  banco_de_imagens: true,
  skills: [],
  observacoes: "",
  rodadas: null,
  direcao_de_arte: "ousada",
  movimento: null,
  escolher_rota: null,
  referencias: { links: [], notas: "" },
};

const revisao = (over: Partial<ClaudeReview> = {}): ClaudeReview => ({
  pasta: "cliente-1a2b",
  existe: true,
  arquivo: "clientes/cliente-1a2b/briefing.json",
  erros: [],
  avisos: [],
  resumo: [],
  projetos: [],
  briefing: { empresa: { nome: "Voltagem Auto Elétrica", ramo: "auto elétrica" } },
  fotos: [],
  opcoes: opcoesDoSite,
  skillsDisponiveis: [],
  maxSkills: 2,
  bancos: [],
  padroes: { rodadas: 2, direcao_de_arte: "autoral", movimento: "expressivo", escolher_rota: false },
  aprovacaoHumana: false,
  ...over,
});

const detalhe = (over: Partial<ClaudeProjectDetail> = {}): ClaudeProjectDetail => ({
  installed: true,
  reason: null,
  generation: { enabled: true, reason: null },
  project: { folder: "cliente-1a2b", slug: "cliente-1a2b", queue: null, material: null, briefing: null, site: null, lastRun: null },
  review: null,
  site: null,
  runs: [],
  ...over,
});

/** Um cliente por teste: o cache de um caso não vaza para o outro. */
const mostrar = (tela: ReactElement) => {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  return render(<QueryClientProvider client={client}>{tela}</QueryClientProvider>);
};

const botao = (name: string | RegExp) => screen.getByRole("button", { name });
const semBotao = (name: string | RegExp) => expect(screen.queryByRole("button", { name })).toBeNull();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMe.mockResolvedValue({ user: { id: "u1", name: "Ana" }, canManageAccess: false, permissions: ["gerar", "publicar"] });
  fetchClaudeOptions.mockResolvedValue(opcoesDoProjeto);
  chooseClaudeRoute.mockResolvedValue({});
  continueClaudeSite.mockResolvedValue({});
  generateClaudeSite.mockResolvedValue({});
  saveClaudeOptions.mockResolvedValue(opcoesDoProjeto);
});

describe("o site nas rodadas de crítica e refino", () => {
  it("mostra onde o site está, o que a última crítica disse e a rodada de cada etapa", () => {
    mostrar(<ClaudeSiteCard project={projeto} detail={detalhe({ site: site() })} busy={false} onPush={() => {}} />);

    const linha = screen.getByRole("list", { name: "Andamento da criação do site" });
    expect(within(linha).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Direção, concluído",
      "Geração, concluído",
      "Revisão, concluído",
      "Crítica 1, concluído",
      "Refino 1, é onde o site está",
      "Crítica 2, pela frente",
      "Refino 2, pela frente",
      "Entregue, pela frente",
    ]);
    expect(within(linha).getByText("Refino 1").closest("[aria-current]")).toHaveAttribute("aria-current", "step");

    expect(screen.getByRole("heading", { name: "Última crítica · rodada 1" })).toBeInTheDocument();
    expect(screen.getByText("Pediu refino")).toBeInTheDocument();
    expect(screen.getByText(critica.resumo)).toBeInTheDocument();
    expect(screen.getByText(/Ficaram abaixo: unicidade, tipografia e movimento\./)).toBeInTheDocument();
    // Muitos problemas: a lista começa fechada, com a contagem por gravidade à vista.
    const resumo = screen.getByText("5 problemas apontados: 1 grave, 2 médios e 2 leves");
    expect(resumo.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Correção pedida: Reduzir a escala no celular.")).toBeInTheDocument();

    expect(screen.getByRole("cell", { name: "crítica · rodada 1" })).toBeInTheDocument();
    // O que saiu, e o que só vale num site entregue.
    semBotao(/Filmar/);
    expect(screen.queryByText("Filme da abertura")).toBeNull();
    expect(screen.queryByLabelText("Pedir um ajuste")).toBeNull();
    expect(botao("Fotografar telas")).toBeEnabled();
    expect(botao("Validar")).toBeEnabled();
  });

  it("com poucos problemas a lista vem aberta; entregue antes do fim, a linha diz por quê", () => {
    const aprovou: ClaudeCritique = { ...critica, veredito: "aprovado", problemas: critica.problemas.slice(3) };
    mostrar(
      <ClaudeSiteCard
        project={projeto}
        detail={detalhe({
          site: site({ situacao: "entregue", entregue: true, proximo: null, pipeline: { rodadas: 2, rodada: 1, fase: "entregue" }, critica: aprovou }),
        })}
        busy={false}
        onPush={() => {}}
      />,
    );
    expect(screen.getByText("Aprovou o site")).toBeInTheDocument();
    expect(screen.getByText("2 problemas apontados: 2 leves").closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/A crítica da rodada 1 aprovou o site/)).toBeInTheDocument();
    expect(screen.getByText("Refino 1").closest("li")).toHaveTextContent("Refino 1, dispensado");
  });

  it("o ajuste não escolhe modelo: diz com qual roda e onde se troca", async () => {
    fetchClaudeOptions.mockResolvedValue({ ...opcoesDoProjeto, options: { modelo: "claude-sonnet-5-5", esforco: null } });
    mostrar(
      <ClaudeSiteCard
        project={projeto}
        detail={detalhe({
          site: site({ situacao: "entregue", entregue: true, proximo: null, pipeline: { rodadas: 2, rodada: 2, fase: "entregue" }, critica: { ...critica, rodada: 2 } }),
        })}
        busy={false}
        onPush={() => {}}
      />,
    );
    expect(screen.getByLabelText("Pedir um ajuste")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "O ajuste roda com modelo Sonnet 5.5 (deste projeto) e esforço alto (padrão do painel). Para trocar, grave outros em “Opções do site”, no briefing abaixo.",
      ),
    ).toBeInTheDocument();
  });
});

describe("o tipo do site depois de entregue", () => {
  const entregue = (over: Partial<ClaudeSite> = {}) =>
    detalhe({ site: site({ situacao: "entregue", entregue: true, proximo: null, pipeline: { rodadas: 2, rodada: 2, fase: "entregue" }, ...over }) });

  it("página única: a tela diz que páginas novas são recusadas, e ligar a opção não gasta", async () => {
    setClaudeSiteType.mockResolvedValue({ multiplasPaginas: true, paginas: [] });
    mostrar(<ClaudeSiteCard project={projeto} detail={entregue({ multiplasPaginas: false, paginas: [] })} busy={false} onPush={() => {}} />);
    const opcao = screen.getByRole("switch", { name: "Várias páginas" });
    expect(opcao).not.toBeChecked();
    expect(screen.getByText(/Site de página única: um ajuste que peça páginas novas é recusado\./)).toBeInTheDocument();
    fireEvent.click(opcao);
    await waitFor(() => expect(setClaudeSiteType).toHaveBeenCalledWith(projeto.id, true));
  });

  it("várias páginas: mostra as que o site tem; motor de antes da opção não a oferece", () => {
    const { unmount } = mostrar(
      <ClaudeSiteCard project={projeto} detail={entregue({ multiplasPaginas: true, paginas: ["facilities", "obras"] })} busy={false} onPush={() => {}} />,
    );
    expect(screen.getByRole("switch", { name: "Várias páginas" })).toBeChecked();
    expect(screen.getByText(/mais 2 páginas \(facilities, obras\)\. Um ajuste pode criar, tirar ou dividir páginas\./)).toBeInTheDocument();
    unmount();
    mostrar(<ClaudeSiteCard project={projeto} detail={entregue()} busy={false} onPush={() => {}} />);
    expect(screen.queryByRole("switch", { name: "Várias páginas" })).not.toBeInTheDocument();
  });
});

describe("a direção criativa esperando aprovação, com as rotas", () => {
  const esperando = (over: Partial<ClaudeSite> = {}) =>
    site({
      situacao: "aguardando aprovação",
      aguardandoAprovacao: true,
      proximo: null,
      pipeline: { rodadas: 2, rodada: 0, fase: "aprovacao" },
      critica: null,
      brief: "Rota escolhida: Bancada. Conceito: a oficina como laboratório.",
      rotas: [
        { n: 1, nome: "Oficina à vista", ideia: "A fachada e as mãos trabalhando, sem filtro.", escolhida: false },
        { n: 2, nome: "Bancada", ideia: "A oficina como laboratório: ordem, medida e ferramenta.", escolhida: true },
        { n: 3, nome: "Faísca", ideia: "Contraste alto e um traço elétrico que corta a página.", escolhida: false },
      ],
      etapas: [etapa(1, "direcao")],
      ...over,
    });

  it("a escolhida aprova; as outras refazem a direção, com a confirmação que diz isso", async () => {
    const user = userEvent.setup();
    mostrar(<ClaudeApprovalCard project={projeto} detail={detalhe({ site: esperando() })} busy={false} />);

    expect(screen.getByText("Rota escolhida: Bancada. Conceito: a oficina como laboratório.")).toBeInTheDocument();
    expect(screen.getByText("Escolhida pelo Claude").closest("li")).toHaveTextContent("Rota 2");
    expect(screen.getAllByRole("button", { name: "Aprovar e gerar o site" })).toHaveLength(1);
    const outras = screen.getAllByRole("button", { name: "Usar esta rota" });
    expect(outras).toHaveLength(2);

    await user.click(outras[0]);
    const confirmacao = await screen.findByRole("alertdialog");
    expect(within(confirmacao).getByRole("heading")).toHaveTextContent("Refazer a direção criativa com a rota “Oficina à vista”?");
    expect(confirmacao).toHaveTextContent("feita com a rota “Bancada”, é descartada, e o Claude a refaz seguindo esta rota");
    expect(confirmacao).toHaveTextContent("consome a assinatura");
    expect(chooseClaudeRoute).not.toHaveBeenCalled();

    await user.click(within(confirmacao).getByRole("button", { name: "Refazer a direção e usar a assinatura" }));
    await waitFor(() => expect(chooseClaudeRoute).toHaveBeenCalledWith("p1", 1));
  });

  it("site de antes das rotas: o botão de aprovar continua onde sempre esteve", () => {
    mostrar(<ClaudeApprovalCard project={projeto} detail={detalhe({ site: esperando({ rotas: [] }) })} busy={false} />);
    expect(screen.getAllByRole("button", { name: "Aprovar e gerar o site" })).toHaveLength(1);
    semBotao("Usar esta rota");
    expect(screen.queryByText(/Rotas que a direção considerou/)).toBeNull();
  });
});

describe("Continuar — o botão e a confirmação dizem o que vai rodar", () => {
  it("sequência parada antes da crítica: roda a crítica, e não há etapa a encerrar", async () => {
    const user = userEvent.setup();
    mostrar(
      <ClaudeContinueCard
        project={projeto}
        detail={detalhe({ site: site({ situacao: "em crítica", proximo: "criticar", pipeline: { rodadas: 2, rodada: 1, fase: "critica" }, critica: null }) })}
        busy={false}
      />,
    );
    expect(screen.getByText("A criação do site parou antes da crítica · rodada 1 de 2")).toBeInTheDocument();
    semBotao("Encerrar etapa");

    await user.click(botao("Rodar a crítica"));
    const confirmacao = await screen.findByRole("alertdialog");
    expect(within(confirmacao).getByRole("heading")).toHaveTextContent("Rodar a crítica do site?");
    expect(confirmacao).toHaveTextContent("que não escreveu o site");
    expect(confirmacao).toHaveTextContent("põe na fila sozinho os passos que faltam");
    await user.click(within(confirmacao).getByRole("button", { name: "Rodar a crítica e usar a assinatura" }));
    await waitFor(() => expect(continueClaudeSite).toHaveBeenCalledWith("p1"));
  });

  it("etapa aberta: continua de onde parou ou encerra; a de ajuste só encerra", () => {
    const { unmount } = mostrar(
      <ClaudeContinueCard
        project={projeto}
        detail={detalhe({ site: site({ etapaAberta: "revisao", proximo: "continuar", pipeline: { rodadas: 2, rodada: 0, fase: "revisao" }, critica: null }) })}
        busy={false}
      />,
    );
    expect(screen.getByText("A execução terminou com a etapa de revisão aberta")).toBeInTheDocument();
    expect(botao("Continuar de onde parou")).toBeEnabled();
    expect(botao("Encerrar etapa")).toBeEnabled();
    unmount();

    mostrar(
      <ClaudeContinueCard
        project={projeto}
        detail={detalhe({ site: site({ etapaAberta: "ajuste", proximo: null, pipeline: { rodadas: 2, rodada: 2, fase: "entregue" } }) })}
        busy={false}
      />,
    );
    expect(screen.getByText(/ela não pode ser continuada/)).toBeInTheDocument();
    expect(botao("Encerrar etapa")).toBeEnabled();
    semBotao(/Continuar|Rodar/);
  });

  it("com a trava desligada o botão que gasta fica fora de alcance, com o motivo escrito", () => {
    mostrar(
      <ClaudeContinueCard
        project={projeto}
        detail={detalhe({ generation: { enabled: false, reason: "Trava desligada." }, site: site({ critica: null }) })}
        busy={false}
      />,
    );
    expect(botao("Rodar o refino")).toBeDisabled();
    expect(screen.getByText("A geração pelo Claude está desligada neste painel.")).toBeInTheDocument();
  });
});

describe("as opções na revisão antes de gerar", () => {
  it("cada opção mostra o padrão do painel sem mandá-lo como escolha", async () => {
    const user = userEvent.setup();
    mostrar(<ClaudeBriefingCard project={projeto} detail={detalhe({ review: revisao() })} busy={false} />);

    // O que cada seletor mostra marcado: o padrão, dizendo qual é, ou a escolha gravada.
    expect(await screen.findByRole("combobox", { name: "Modelo" })).toHaveTextContent("Padrão do painel (Opus 5.5)");
    expect(screen.getByRole("combobox", { name: "Esforço" })).toHaveTextContent("Padrão do painel (Alto)");
    expect(screen.getByRole("combobox", { name: "Rodadas de crítica e refino" })).toHaveTextContent("Padrão do painel (2 rodadas)");
    expect(screen.getByRole("combobox", { name: "Escolher a rota antes de gerar" })).toHaveTextContent("Padrão do painel (não)");
    expect(screen.getByRole("combobox", { name: "Direção de arte" })).toHaveTextContent("Ousada");
    expect(screen.getByRole("combobox", { name: "Movimento" })).toHaveTextContent("Padrão do painel (Expressivo)");
    // A frase é a do nível que vale: o escolhido ou, sem escolha, o padrão.
    expect(screen.getByText(/Para clientes que comportam risco\./)).toBeInTheDocument();
    expect(screen.getByText(/Cada seção tem a sua animação/)).toBeInTheDocument();
    expect(screen.getByText(/O site segue direto com a rota que o Claude escolher/)).toBeInTheDocument();

    await user.click(botao("Gerar site"));
    const confirmacao = await screen.findByRole("alertdialog");
    expect(confirmacao).toHaveTextContent("até 2 rodadas de crítica e refino");
    expect(confirmacao).toHaveTextContent("esta confirmação vale para a sequência inteira, com modelo Opus 5.5 e esforço alto, os padrões do painel.");
    expect(confirmacao).toHaveTextContent("consome a assinatura");
    await user.click(within(confirmacao).getByRole("button", { name: "Gerar e usar a assinatura" }));

    // Sem mexer no modelo nem no esforço, as chaves nem vão: vale o que o projeto tem gravado.
    await waitFor(() => expect(generateClaudeSite).toHaveBeenCalledTimes(1));
    expect(generateClaudeSite).toHaveBeenCalledWith("p1", { refazer: false, opcoes: opcoesDoSite });
  });

  it("gravar as opções não gasta, e só se oferece quando algo mudou", async () => {
    const user = userEvent.setup();
    mostrar(<ClaudeBriefingCard project={projeto} detail={detalhe({ review: revisao() })} busy={false} />);

    expect(botao("Gravar opções")).toBeDisabled();
    await user.type(screen.getByLabelText(/Referências/), "exemplo.com.br\nhttps://outro.com.br");
    expect(screen.getByText("Opções ainda não gravadas.")).toBeInTheDocument();

    await user.click(botao("Gravar opções"));
    await waitFor(() =>
      expect(saveClaudeOptions).toHaveBeenCalledWith("p1", {
        site: { ...opcoesDoSite, referencias: { links: ["exemplo.com.br", "https://outro.com.br"], notas: "" } },
      }),
    );
    expect(generateClaudeSite).not.toHaveBeenCalled();
  });

  it("links demais nas referências: o motivo aparece e o site não é gerado", async () => {
    const user = userEvent.setup();
    mostrar(<ClaudeBriefingCard project={projeto} detail={detalhe({ review: revisao() })} busy={false} />);
    await user.type(screen.getByLabelText(/Referências/), "a.com\nb.com\nc.com\nd.com\ne.com\nf.com");
    expect(screen.getAllByText("As referências têm 6 links; o limite é 5 por site.").length).toBeGreaterThan(0);
    expect(botao("Gerar site")).toBeDisabled();
    expect(botao("Gravar opções")).toBeDisabled();
  });
});

const filaVazia = {
  installed: true,
  reason: null,
  generation: { enabled: true, reason: null },
  defaultEngine: "claude",
  queue: { paused: false, running: null, waiting: [], interrupted: [], last: null },
  task: null,
};

describe("a aba do Claude com o servidor de antes das rodadas", () => {
  it("diz para reiniciar o painel, em vez de mostrar telas sem o andamento do site", async () => {
    // A interface nova com o servidor antigo: o site vem sem `pipeline`, a revisão sem `padroes`.
    const antigo = { ...site(), pipeline: undefined, proximo: undefined, rotas: undefined } as unknown as ClaudeSite;
    fetchClaudeProject.mockResolvedValue(detalhe({ site: antigo }));
    fetchClaudeStatus.mockResolvedValue(filaVazia);
    mostrar(<ClaudePanel project={projeto} onGenerateBriefing={() => {}} onPushSite={() => {}} />);

    expect(await screen.findByText("O painel precisa ser reiniciado")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Site" })).toBeNull();
  });

  it("com o servidor em dia, a aba mostra o site e o que falta para ele ser entregue", async () => {
    fetchClaudeProject.mockResolvedValue(detalhe({ site: site(), review: revisao({ projetos: ["cliente-1a2b"] }) }));
    fetchClaudeStatus.mockResolvedValue(filaVazia);
    mostrar(<ClaudePanel project={projeto} onGenerateBriefing={() => {}} onPushSite={() => {}} />);

    expect(await screen.findByText("A criação do site parou antes do refino · rodada 1 de 2")).toBeInTheDocument();
    expect(botao("Rodar o refino")).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Site" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Última crítica · rodada 1" })).toBeInTheDocument();
    expect(screen.queryByText("O painel precisa ser reiniciado")).toBeNull();
  });
});
