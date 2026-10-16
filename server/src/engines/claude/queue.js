import { EventEmitter } from "node:events";

/**
 * A fila do motor Claude: uma, para o painel inteiro. Gerar em lote é pôr
 * vários pedidos nela.
 *
 * Há duas cotas, uma ao lado da outra: a da criação de sites (briefing,
 * geração, continuação, crítica e refino) e a dos ajustes de sites já
 * entregues. Até `vagas().criacoes` sites nascem ao mesmo tempo e até
 * `vagas().ajustes` ajustes rodam juntos; uma cota não espera a outra. Nunca
 * duas execuções no mesmo site. Com `ajustes` em zero, tudo volta a rodar um
 * de cada vez.
 *
 * Um site em criação não perde a vez entre uma etapa e a seguinte: quando uma
 * execução termina, a vaga dela fica segura enquanto `seguir` põe na fila o
 * passo seguinte do mesmo site, e esse passo (`primeiro`) passa à frente dos
 * pedidos que ainda nem começaram. Sem isso, o site que esperava a vez
 * entrava no meio e o que já estava andando parava até outro terminar.
 *
 * O que fica guardado é só o bastante para o painel reabrir sabendo o que
 * estava na fila e o que estava rodando. Depois de um reinício a fila volta
 * **pausada**: reabrir o painel não pode gastar a assinatura sozinho. E o que
 * estava rodando não volta para a fila — aparece como interrompido, para a
 * pessoa decidir entre retomar e descartar.
 */

/**
 * @typedef {import("./executor.js").Pedido} Pedido
 * @typedef {import("./executor.js").Execucao} Execucao
 * @typedef {import("./executor.js").ResultadoDaExecucao} ResultadoDaExecucao
 * @typedef {import("./executor.js").EventoDaExecucao} EventoDaExecucao
 * @typedef {{
 *   id: string, pedido: Pedido, frase: string, criadoEm: string,
 *   estado: "esperando" | "rodando" | "interrompida", inicio?: string,
 *   slug?: string, sessionId?: string, execucaoId?: string,
 *   extra?: Record<string, any>, primeiro?: boolean,
 * }} ItemDaFila `slug`, `sessionId` e `execucaoId` são preenchidos enquanto
 *   roda, assim que o executor descobre: servem para retomar o que foi
 *   interrompido. `extra` é do painel: o projeto, quem pediu e, na sequência
 *   de um site, os passos que ela já deu. `primeiro`: passa à frente de quem
 *   ainda não começou (o passo seguinte de um site em andamento).
 * @typedef {{ item: ItemDaFila, resultado?: ResultadoDaExecucao, erro?: string, status?: number,
 *   seguindo?: Promise<void> }} FimDeItem `seguindo`: o `seguir` deste fim, quando ele devolveu
 *   uma promessa; resolve (nunca rejeita) quando a vaga é liberada.
 * @typedef {{ criacoes: number, ajustes: number }} Vagas
 * @typedef {{
 *   rodando: ItemDaFila | null, rodandoTodos: ItemDaFila[], esperando: ItemDaFila[],
 *   interrompidas: ItemDaFila[], pausada: boolean, ultimo: FimDeItem | null,
 * }} EstadoDaFila `rodando` é a execução principal: a da criação quando há
 *   uma, senão o ajuste mais antigo. `rodandoTodos` traz todas.
 * @typedef {(pedido: Pedido, deps: { onEvento?: (evento: EventoDaExecucao) => void,
 *   extra?: Record<string, any> }) => Execucao} Iniciar
 */

/** O site (ou, antes de ele existir, o cliente) em que um pedido mexe. */
const alvoDe = (/** @type {ItemDaFila} */ item) =>
  item.slug ?? ("slug" in item.pedido ? item.pedido.slug : `cliente:${item.pedido.pasta}`);

/** Os ajustes — do motor e a edição livre de um site de repositório — rodam na cota deles. */
const ehAjuste = (/** @type {ItemDaFila} */ item) => item.pedido.tipo === "ajuste" || item.pedido.tipo === "edicao";

/** Quanto a vaga espera o `seguir` de quem terminou antes de passar adiante. */
const ESPERA_DO_SEGUIR_MS = 2 * 60_000;

const inteiro = (valor) => Math.max(0, Math.floor(Number(valor) || 0));

/**
 * Eventos: `mudou` (EstadoDaFila), `evento` (EventoDaExecucao e o item) e
 * `fim` (FimDeItem).
 */
export class Fila extends EventEmitter {
  /** @type {ItemDaFila[]} */
  #esperando = [];
  /** @type {ItemDaFila[]} */
  #interrompidas = [];
  /** As execuções em andamento, na ordem em que começaram. @type {Map<string, { item: ItemDaFila, exec: Execucao }>} */
  #rodando = new Map();
  /** As que já terminaram e ainda seguram a vaga, à espera do `seguir`. @type {Map<string, ItemDaFila>} */
  #segurando = new Map();
  #pausada = false;
  /** @type {FimDeItem | null} */
  #ultimo = null;
  #seq = 0;
  #iniciar;
  #salvar;
  #vagas;
  #seguir;

  /**
   * @param {{
   *   iniciar: Iniciar,
   *   salvos?: ItemDaFila[] | null,
   *   salvar?: (itens: ItemDaFila[]) => unknown,
   *   vagas?: () => Partial<Vagas>,
   *   seguir?: (fim: FimDeItem) => unknown,
   * }} opcoes
   *   `salvos`: os itens que estavam guardados quando o painel subiu.
   *   `salvar`: chamado a cada mudança, com tudo o que precisa sobreviver a um reinício.
   *   `vagas`: quantos sites nascem e quantos ajustes rodam ao mesmo tempo,
   *   lido a cada pedido que pode começar. Ajustes em zero: nada roda junto.
   *   `seguir`: chamado quando uma execução termina; se devolver uma promessa,
   *   a vaga dela só passa adiante quando a promessa acabar (ou demorar demais).
   */
  constructor({ iniciar, salvos = null, salvar = () => undefined, vagas = () => ({}), seguir = () => undefined }) {
    super();
    this.#iniciar = iniciar;
    this.#salvar = salvar;
    this.#vagas = vagas;
    this.#seguir = seguir;
    if (!Array.isArray(salvos) || salvos.length === 0) return;

    this.#interrompidas = salvos
      .filter((item) => item.estado !== "esperando")
      .map((item) => ({ ...item, estado: /** @type {const} */ ("interrompida") }));
    this.#esperando = salvos.filter((item) => item.estado === "esperando");
    // Reabrir o painel não pode gastar a assinatura sozinho.
    this.#pausada = this.#esperando.length > 0;
    this.#guardar();
  }

  /** @returns {EstadoDaFila} */
  estado() {
    const rodando = [...this.#rodando.values()].map((atual) => atual.item);
    return {
      rodando: rodando.find((item) => !ehAjuste(item)) ?? rodando[0] ?? null,
      rodandoTodos: rodando,
      esperando: [...this.#esperando],
      interrompidas: [...this.#interrompidas],
      pausada: this.#pausada,
      ultimo: this.#ultimo,
    };
  }

  /** Todos os itens que a fila conhece agora — rodando, esperando e interrompidos. */
  itens() {
    return [...[...this.#rodando.values()].map((atual) => atual.item), ...this.#esperando, ...this.#interrompidas];
  }

  /**
   * @param {Pedido} pedido
   * @param {{ frase: string, extra?: Record<string, any>, primeiro?: boolean }} dados a frase do
   *   runbook que vai ao claude, já conferida pelo motor. `primeiro`: entra
   *   na frente de quem espera sem `primeiro` (atrás dos outros que têm).
   * @returns {ItemDaFila}
   */
  adicionar(pedido, { frase, extra, primeiro = false }) {
    /** @type {ItemDaFila} */
    const item = {
      id: `${Date.now().toString(36)}-${++this.#seq}`,
      pedido,
      frase,
      criadoEm: new Date().toISOString(),
      estado: "esperando",
      ...(extra ? { extra } : {}),
      ...(primeiro ? { primeiro: true } : {}),
    };
    const antesDe = primeiro ? this.#esperando.findIndex((outro) => !outro.primeiro) : -1;
    if (antesDe < 0) this.#esperando.push(item);
    else this.#esperando.splice(antesDe, 0, item);
    this.#mudou();
    this.#processar();
    return item;
  }

  /** Tira da fila um pedido que ainda não começou. Devolve o item retirado. */
  remover(id) {
    const item = this.#esperando.find((candidato) => candidato.id === id);
    if (!item) return null;
    this.#esperando = this.#esperando.filter((candidato) => candidato.id !== id);
    this.#mudou();
    return item;
  }

  /**
   * Cancela uma execução em andamento; a fila segue para o próximo quando o
   * processo sair. Sem `id`, cancela a principal.
   *
   * @param {string} [id] o item da fila
   */
  cancelar(id) {
    const atual = id ? this.#rodando.get(id) : this.#rodando.get(this.estado().rodando?.id ?? "");
    if (!atual) return false;
    atual.exec.cancelar();
    return true;
  }

  /**
   * Encerramento do painel: nada mais começa, e as execuções em andamento são
   * canceladas e esperadas, para ficarem registradas.
   */
  async parar() {
    this.#pausada = true;
    const rodando = [...this.#rodando.values()];
    for (const atual of rodando) atual.exec.cancelar();
    await Promise.all(rodando.map((atual) => atual.exec.promessa.catch(() => undefined)));
  }

  /** Libera a fila que voltou pausada de um reinício. */
  retomar() {
    this.#pausada = false;
    this.#mudou();
    this.#processar();
  }

  /** Devolve o item descartado. */
  descartarInterrompida(id) {
    const item = this.#interrompidas.find((candidato) => candidato.id === id);
    if (!item) return null;
    this.#interrompidas = this.#interrompidas.filter((candidato) => candidato.id !== id);
    this.#mudou();
    return item;
  }

  /**
   * Tira uma interrompida da lista para ser retomada. Quem chama põe na fila
   * o pedido "continue o site" — que retoma a sessão original quando ela ainda
   * existe.
   */
  retirarInterrompida(id) {
    return this.descartarInterrompida(id);
  }

  #guardar() {
    try {
      void Promise.resolve(this.#salvar(this.itens())).catch(() => undefined);
    } catch {
      // guardar a fila não pode derrubar a execução
    }
  }

  #mudou() {
    this.#guardar();
    this.emit("mudou", this.estado());
  }

  /** O pedido pode começar agora, com o que já está rodando (ou segurando a vaga)? */
  #cabe(item) {
    const ocupando = [...[...this.#rodando.values()].map((atual) => atual.item), ...this.#segurando.values()];
    if (ocupando.length === 0) return true;
    const vagas = this.#vagas() ?? {};
    const ajustes = inteiro(vagas.ajustes);
    if (ajustes === 0) return false;
    if (ocupando.some((outro) => alvoDe(outro) === alvoDe(item))) return false;
    const limite = ehAjuste(item) ? ajustes : Math.max(1, inteiro(vagas.criacoes));
    return ocupando.filter((outro) => ehAjuste(outro) === ehAjuste(item)).length < limite;
  }

  /**
   * O `seguir` de um fim, como promessa que nunca rejeita e não passa do
   * prazo; `null` quando ele não devolveu promessa (a vaga passa adiante já).
   * @param {FimDeItem} fim
   * @returns {Promise<void> | null}
   */
  #seguirDe(fim) {
    /** @type {any} */
    let retorno;
    try {
      retorno = this.#seguir(fim);
    } catch {
      return null;
    }
    if (typeof retorno?.then !== "function") return null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let relogio;
    const prazo = new Promise((ok) => {
      relogio = setTimeout(ok, ESPERA_DO_SEGUIR_MS);
      relogio.unref?.();
    });
    return Promise.race([Promise.resolve(retorno).then(() => undefined, () => undefined), prazo]).finally(() =>
      clearTimeout(relogio),
    );
  }

  /** Começa, na ordem de chegada, cada pedido que cabe ao lado do que já roda. */
  #processar() {
    if (this.#pausada) return;
    for (const item of [...this.#esperando]) {
      if (!this.#cabe(item)) continue;
      this.#esperando = this.#esperando.filter((outro) => outro !== item);
      this.#comecar(item);
    }
  }

  #comecar(item) {
    item.estado = "rodando";
    item.inicio = new Date().toISOString();

    const exec = this.#iniciar(item.pedido, {
      extra: { ...(item.extra ?? {}), item: item.id },
      onEvento: (evento) => {
        if (evento.slug !== item.slug || evento.sessionId !== item.sessionId) {
          item.slug = evento.slug;
          item.sessionId = evento.sessionId;
          this.#mudou();
        }
        this.emit("evento", evento, item);
      },
    });
    item.execucaoId = exec.id;
    this.#rodando.set(item.id, { item, exec });
    this.#mudou();

    exec.promessa
      .then(
        /** @returns {FimDeItem} */
        (resultado) => ({
          item: { ...item, slug: resultado.slug ?? item.slug, sessionId: resultado.sessionId ?? item.sessionId },
          resultado,
        }),
      )
      .catch(
        /** @returns {FimDeItem} */
        (/** @type {any} */ erro) => ({ item, erro: String(erro?.message ?? erro), status: Number(erro?.status) || 500 }),
      )
      .then((fim) => {
        this.#rodando.delete(item.id);
        const seguindo = this.#seguirDe(fim);
        // A vaga fica com este site até o passo seguinte dele entrar na fila.
        if (seguindo) this.#segurando.set(item.id, fim.item);
        this.#ultimo = fim;
        this.#mudou();
        this.emit("fim", seguindo ? { ...fim, seguindo } : fim);
        const liberar = () => {
          this.#segurando.delete(item.id);
          this.#processar();
        };
        if (seguindo) void seguindo.then(liberar);
        else liberar();
      });
  }
}
