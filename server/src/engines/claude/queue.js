import { EventEmitter } from "node:events";

/**
 * A fila do motor Claude: uma, para o painel inteiro. Gerar em lote é pôr
 * vários pedidos nela.
 *
 * A criação de um site (briefing, geração, continuação, crítica e refino)
 * roda uma de cada vez: cada site é comparado com os anteriores, e dois
 * nascendo juntos não se enxergariam. O ajuste de um site já entregue não
 * depende de nenhum outro: roda ao lado da criação, e até `vagas` ajustes
 * rodam ao mesmo tempo. Nunca duas execuções no mesmo site. Com `vagas` em
 * zero, tudo volta a rodar um de cada vez.
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
 *   extra?: Record<string, any>,
 * }} ItemDaFila `slug`, `sessionId` e `execucaoId` são preenchidos enquanto
 *   roda, assim que o executor descobre: servem para retomar o que foi
 *   interrompido. `extra` é do painel: o projeto, quem pediu e, na sequência
 *   de um site, os passos que ela já deu.
 * @typedef {{ item: ItemDaFila, resultado?: ResultadoDaExecucao, erro?: string, status?: number }} FimDeItem
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

const ehAjuste = (/** @type {ItemDaFila} */ item) => item.pedido.tipo === "ajuste";

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
  #pausada = false;
  /** @type {FimDeItem | null} */
  #ultimo = null;
  #seq = 0;
  #iniciar;
  #salvar;
  #vagas;

  /**
   * @param {{
   *   iniciar: Iniciar,
   *   salvos?: ItemDaFila[] | null,
   *   salvar?: (itens: ItemDaFila[]) => unknown,
   *   vagas?: () => number,
   * }} opcoes
   *   `salvos`: os itens que estavam guardados quando o painel subiu.
   *   `salvar`: chamado a cada mudança, com tudo o que precisa sobreviver a um reinício.
   *   `vagas`: quantos ajustes rodam ao mesmo tempo, lido a cada pedido que
   *   pode começar. Zero: nada roda junto.
   */
  constructor({ iniciar, salvos = null, salvar = () => undefined, vagas = () => 0 }) {
    super();
    this.#iniciar = iniciar;
    this.#salvar = salvar;
    this.#vagas = vagas;
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
   * @param {{ frase: string, extra?: Record<string, any> }} dados a frase do
   *   runbook que vai ao claude, já conferida pelo motor
   * @returns {ItemDaFila}
   */
  adicionar(pedido, { frase, extra }) {
    /** @type {ItemDaFila} */
    const item = {
      id: `${Date.now().toString(36)}-${++this.#seq}`,
      pedido,
      frase,
      criadoEm: new Date().toISOString(),
      estado: "esperando",
      ...(extra ? { extra } : {}),
    };
    this.#esperando.push(item);
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

  /** O pedido pode começar agora, com o que já está rodando? */
  #cabe(item) {
    const rodando = [...this.#rodando.values()].map((atual) => atual.item);
    if (rodando.length === 0) return true;
    const vagas = Math.max(0, Math.floor(Number(this.#vagas()) || 0));
    if (vagas === 0) return false;
    if (rodando.some((outro) => alvoDe(outro) === alvoDe(item))) return false;
    return ehAjuste(item)
      ? rodando.filter(ehAjuste).length < vagas
      : !rodando.some((outro) => !ehAjuste(outro));
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
        this.#ultimo = fim;
        this.#mudou();
        this.emit("fim", fim);
        this.#processar();
      });
  }
}
