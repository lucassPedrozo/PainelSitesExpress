import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fraseDe } from "./fixtures/apoio.mjs";
import { Fila } from "./queue.js";

/**
 * A fila do motor Claude, com um executor de mentira: cada execução termina
 * quando o teste mandar. Nada aqui lança processo nenhum.
 */

const pedido = (n) => ({ tipo: "ajuste", slug: "h", pedido: `pedido ${n}` });
const proximoFim = (fila) => new Promise((ok) => fila.once("fim", ok));
const tick = () => new Promise((ok) => setTimeout(ok, 10));

function executorFalso() {
  const iniciadas = [];
  const iniciar = (pedidoDaVez, deps) => {
    let terminar;
    let recusar;
    const promessa = new Promise((ok, falha) => {
      terminar = (status = "sucesso") =>
        ok({ id: "x", status, pedido: fraseDe(pedidoDaVez), slug: "h", codigoSaida: 0, duracaoMs: 1, custoEstimadoUsd: null, mensagem: "ok", sinais: [], log: "" });
      recusar = falha;
    });
    const execucao = { pedido: pedidoDaVez, deps, terminar, recusar, cancelada: false };
    iniciadas.push(execucao);
    // O executor de verdade avisa o slug e a sessão assim que os descobre.
    queueMicrotask(() => deps.onEvento?.({ ts: "", legiveis: [], slug: "h", sessionId: "sessao-da-fila" }));
    return {
      id: `exec-${iniciadas.length}`,
      promessa,
      cancelar: () => {
        execucao.cancelada = true;
        terminar("cancelada");
      },
      slug: "h",
      sessionId: "sessao-da-fila",
    };
  };
  return { iniciar, iniciadas };
}

const adicionar = (fila, n, extra) => fila.adicionar(pedido(n), { frase: fraseDe(pedido(n)), extra });

describe("fila do motor Claude", () => {
  it("uma execução por vez; quem espera pode ser removido", async () => {
    const a = executorFalso();
    const guardados = [];
    const fila = new Fila({ iniciar: a.iniciar, salvar: (itens) => guardados.push(structuredClone(itens)) });
    const [, segundo] = [1, 2, 3].map((n) => adicionar(fila, n, { projectId: `p${n}`, por: "Ana" }));

    assert.deepEqual(
      [fila.estado().rodando?.frase, fila.estado().esperando.length, a.iniciadas.length],
      ["ajuste o site h: pedido 1", 2, 1],
    );
    assert.deepEqual(a.iniciadas[0].deps.extra, { projectId: "p1", por: "Ana", item: fila.estado().rodando.id }, "o que é do painel acompanha a execução");
    assert.equal(fila.remover(segundo.id)?.frase, "ajuste o site h: pedido 2");
    assert.equal(fila.remover("nao-existe"), null);
    assert.equal(fila.remover(fila.estado().rodando.id), null, "o que já começou não sai por aqui: é cancelado");

    const fim = proximoFim(fila);
    a.iniciadas[0].terminar();
    assert.equal((await fim).resultado?.status, "sucesso");
    assert.deepEqual(
      [fila.estado().rodando?.frase, a.iniciadas.length, fila.estado().esperando.length],
      ["ajuste o site h: pedido 3", 2, 0],
      "o removido não roda",
    );
    await tick();
    assert.deepEqual([fila.estado().rodando.slug, fila.estado().rodando.sessionId], ["h", "sessao-da-fila"]);
    assert.equal(fila.estado().ultimo.resultado.status, "sucesso");

    // Cada mudança é guardada: é o que deixa o painel reabrir sabendo o que havia.
    const ultimo = guardados.at(-1);
    assert.deepEqual(ultimo.map((item) => [item.frase, item.estado, item.slug, item.execucaoId]), [
      ["ajuste o site h: pedido 3", "rodando", "h", "exec-2"],
    ]);
  });

  it("depois de um reinício a fila volta pausada, e o que rodava aparece como interrompido", async () => {
    // O painel cai com o pedido 3 rodando e o 4 esperando.
    const salvos = [
      { id: "i3", pedido: pedido(3), frase: "ajuste o site h: pedido 3", criadoEm: "2026-01-01T10:00:00.000Z", estado: "rodando", slug: "h", sessionId: "sessao-da-fila", extra: { projectId: "p3" } },
      { id: "i4", pedido: pedido(4), frase: "ajuste o site h: pedido 4", criadoEm: "2026-01-01T10:01:00.000Z", estado: "esperando", extra: { projectId: "p4" } },
    ];
    const b = executorFalso();
    const guardados = [];
    const reaberta = new Fila({ iniciar: b.iniciar, salvos, salvar: (itens) => guardados.push(structuredClone(itens)) });
    const estado = reaberta.estado();
    assert.deepEqual(
      [estado.rodando, estado.pausada, estado.esperando.map((i) => i.frase), estado.interrompidas.map((i) => [i.frase, i.estado, i.slug, i.sessionId])],
      [null, true, ["ajuste o site h: pedido 4"], [["ajuste o site h: pedido 3", "interrompida", "h", "sessao-da-fila"]]],
    );
    await tick();
    assert.equal(b.iniciadas.length, 0, "reabrir o painel não roda nada sozinho");
    assert.deepEqual(guardados.at(-1).map((item) => item.estado), ["esperando", "interrompida"], "a interrupção fica gravada");

    // Um pedido novo entra na fila pausada, mas também não roda.
    adicionar(reaberta, 5);
    await tick();
    assert.equal(b.iniciadas.length, 0);

    reaberta.retomar();
    assert.deepEqual([reaberta.estado().pausada, b.iniciadas.map((i) => i.pedido)], [false, [pedido(4)]]);

    // Retomar a interrompida: ela sai da lista, e quem chama põe na fila o "continue o site".
    const retirada = reaberta.retirarInterrompida("i3");
    assert.deepEqual([retirada.slug, retirada.extra, reaberta.estado().interrompidas.length], ["h", { projectId: "p3" }, 0]);
    assert.equal(reaberta.retirarInterrompida("i3"), null);
  });

  it("descartar uma interrompida a tira da lista sem rodar nada", () => {
    const c = executorFalso();
    const fila = new Fila({
      iniciar: c.iniciar,
      salvos: [{ id: "i1", pedido: pedido(1), frase: "ajuste o site h: pedido 1", criadoEm: "2026-01-01T10:00:00.000Z", estado: "rodando" }],
    });
    assert.equal(fila.estado().pausada, false, "sem ninguém esperando, não há o que pausar");
    assert.equal(fila.descartarInterrompida("nao-existe"), null);
    assert.equal(fila.descartarInterrompida("i1")?.id, "i1");
    assert.deepEqual([fila.estado().interrompidas, c.iniciadas.length], [[], 0]);
  });

  it("cancelar encerra a execução em andamento e a fila segue; parar não começa mais nada", async () => {
    const d = executorFalso();
    const fila = new Fila({ iniciar: d.iniciar });
    assert.equal(fila.cancelar(), false, "sem nada rodando não há o que cancelar");
    adicionar(fila, 1);
    adicionar(fila, 2);
    adicionar(fila, 3);

    const fim = proximoFim(fila);
    assert.equal(fila.cancelar(), true);
    assert.deepEqual([(await fim).resultado.status, d.iniciadas[0].cancelada], ["cancelada", true]);
    assert.equal(fila.estado().rodando.frase, "ajuste o site h: pedido 2", "a fila segue para o próximo");

    await fila.parar();
    assert.equal(d.iniciadas[1].cancelada, true, "ao encerrar o painel, a execução em andamento é cancelada e esperada");
    await tick();
    assert.deepEqual([fila.estado().rodando, fila.estado().esperando.length, d.iniciadas.length], [null, 1, 2], "e o que esperava não começa");
  });

  it("pedido recusado antes de rodar vira o fim do item, com o motivo, e a fila segue", async () => {
    const e = executorFalso();
    const fila = new Fila({ iniciar: e.iniciar });
    adicionar(fila, 1);
    adicionar(fila, 2);
    const fim = proximoFim(fila);
    const recusa = Object.assign(new Error("Já há uma execução do Claude em andamento."), { status: 409 });
    e.iniciadas[0].recusar(recusa);
    const terminado = await fim;
    assert.deepEqual([terminado.erro, terminado.status, terminado.resultado], ["Já há uma execução do Claude em andamento.", 409, undefined]);
    assert.equal(fila.estado().rodando.frase, "ajuste o site h: pedido 2");
  });

  it("guardar a fila nunca derruba a execução", async () => {
    const f = executorFalso();
    const fila = new Fila({
      iniciar: f.iniciar,
      salvar: () => {
        throw new Error("disco cheio");
      },
    });
    assert.doesNotThrow(() => adicionar(fila, 1));
    assert.equal(f.iniciadas.length, 1);
  });
});
