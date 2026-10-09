import { EventEmitter } from "node:events";

/**
 * A fila do motor Claude: uma execução por vez, as demais esperando.
 *
 * O claude consome a assinatura de uma pessoa, e o motor aponta um projeto
 * "atual" só — então a fila é uma, para o painel inteiro. Gerar em lote é pôr
 * vários pedidos nela.
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
 *   interrompido. `extra` é do painel: o projeto e quem pediu.
 * @typedef {{ item: ItemDaFila, resultado?: ResultadoDaExecucao, erro?: string, status?: number }} FimDeItem
 * @typedef {{
 *   rodando: ItemDaFila | null, esperando: ItemDaFila[], interrompidas: ItemDaFila[],
 *   pausada: boolean, ultimo: FimDeItem | null,
 * }} EstadoDaFila
 * @typedef {(pedido: Pedido, deps: { onEvento?: (evento: EventoDaExecucao) => void,
 *   extra?: Record<string, any> }) => Execucao} Iniciar
 */

/**
 * Eventos: `mudou` (EstadoDaFila), `evento` (EventoDaExecucao e o item) e
 * `fim` (FimDeItem).
 */
export class Fila extends EventEmitter {
  /** @type {ItemDaFila[]} */
  #esperando = [];
  /** @type {ItemDaFila[]} */
  #interrompidas = [];
  /** @type {{ item: ItemDaFila, exec: Execucao } | undefined} */
  #atual;
  #pausada = false;
  /** @type {FimDeItem | null} */
  #ultimo = null;
  #seq = 0;
  #iniciar;
  #salvar;
  #frase;

  /**
   * @param {{
   *   iniciar: Iniciar,
   *   salvos?: ItemDaFila[] | null,
   *   salvar?: (itens: ItemDaFila[]) => unknown,
   * }} opcoes
   *   `salvos`: os itens que estavam guardados quando o painel subiu.
   *   `salvar`: chamado a cada mudança, com tudo o que precisa sobreviver a um reinício.
   */
  constructor({ iniciar, salvos = null, salvar = () => undefined }) {
    super();
    this.#iniciar = iniciar;
    this.#salvar = salvar;
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
    return {
      rodando: this.#atual?.item ?? null,
      esperando: [...this.#esperando],
      interrompidas: [...this.#interrompidas],
      pausada: this.#pausada,
      ultimo: this.#ultimo,
    };
  }

  /** Todos os itens que a fila conhece agora — rodando, esperando e interrompidos. */
  itens() {
    return [...(this.#atual ? [this.#atual.item] : []), ...this.#esperando, ...this.#interrompidas];
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

  /** Cancela a execução em andamento; a fila segue para o próximo quando o processo sair. */
  cancelar() {
    if (!this.#atual) return false;
    this.#atual.exec.cancelar();
    return true;
  }

  /**
   * Encerramento do painel: nada mais começa, e a execução em andamento é
   * cancelada e esperada, para ficar registrada.
   */
  async parar() {
    this.#pausada = true;
    const atual = this.#atual;
    if (!atual) return;
    atual.exec.cancelar();
    await atual.exec.promessa.catch(() => undefined);
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

  #processar() {
    if (this.#atual || this.#pausada) return;
    const item = this.#esperando.shift();
    if (!item) return;
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
    this.#atual = { item, exec };
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
        this.#atual = undefined;
        this.#ultimo = fim;
        this.#mudou();
        this.emit("fim", fim);
        this.#processar();
      });
  }
}
