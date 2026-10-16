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

describe("sites e ajustes ao mesmo tempo", () => {
  /** Um executor de mentira em que cada execução é do site do próprio pedido. */
  function executorPorSite() {
    const iniciadas = [];
    const iniciar = (pedidoDaVez) => {
      let terminar;
      const promessa = new Promise((ok) => {
        terminar = (status = "sucesso") =>
          ok({ id: "x", status, pedido: fraseDe(pedidoDaVez), slug: pedidoDaVez.slug, codigoSaida: 0, duracaoMs: 1, custoEstimadoUsd: null, mensagem: "ok", sinais: [], log: "" });
      });
      const execucao = { pedido: pedidoDaVez, terminar, cancelada: false };
      iniciadas.push(execucao);
      return {
        id: `exec-${iniciadas.length}`,
        promessa,
        cancelar: () => {
          execucao.cancelada = true;
          terminar("cancelada");
        },
        slug: pedidoDaVez.slug,
        sessionId: undefined,
      };
    };
    return { iniciar, iniciadas };
  }
  const ajuste = (slug) => ({ tipo: "ajuste", slug, pedido: "troque o telefone" });
  const por = (fila, pedidoDaVez) => fila.adicionar(pedidoDaVez, { frase: fraseDe(pedidoDaVez) });
  const frases = (itens) => itens.map((item) => item.frase);

  it("o ajuste não espera a criação de outro site, e cada cota tem o seu limite", async () => {
    const a = executorPorSite();
    const fila = new Fila({ iniciar: a.iniciar, vagas: () => ({ criacoes: 1, ajustes: 2 }) });
    por(fila, { tipo: "criticar", slug: "novo" });
    por(fila, { tipo: "refinar", slug: "outro" });
    por(fila, ajuste("a"));
    por(fila, ajuste("b"));
    por(fila, ajuste("c"));

    assert.deepEqual(frases(fila.estado().rodandoTodos), ["critique o site novo", "ajuste o site a: troque o telefone", "ajuste o site b: troque o telefone"]);
    assert.equal(fila.estado().rodando.frase, "critique o site novo", "a principal é a da criação");
    assert.deepEqual(frases(fila.estado().esperando), ["refine o site outro", "ajuste o site c: troque o telefone"], "a segunda criação e o terceiro ajuste esperam");

    // Um ajuste termina: entra o que esperava a vaga, e a criação seguinte continua esperando a dela.
    let fim = proximoFim(fila);
    a.iniciadas[1].terminar();
    await fim;
    assert.deepEqual(frases(fila.estado().rodandoTodos), ["critique o site novo", "ajuste o site b: troque o telefone", "ajuste o site c: troque o telefone"]);
    assert.deepEqual(frases(fila.estado().esperando), ["refine o site outro"]);

    fim = proximoFim(fila);
    a.iniciadas[0].terminar();
    await fim;
    assert.equal(fila.estado().rodando.frase, "refine o site outro", "a criação seguinte entra quando a anterior sai");
    assert.equal(fila.itens().length, 3);
  });

  it("nunca duas execuções no mesmo site; cancelar é por item, e parar encerra todas", async () => {
    const a = executorPorSite();
    const fila = new Fila({ iniciar: a.iniciar, vagas: () => ({ criacoes: 3, ajustes: 3 }) });
    por(fila, { tipo: "refinar", slug: "a" });
    const mesmoSite = por(fila, ajuste("a"));
    const outro = por(fila, ajuste("b"));

    assert.deepEqual(frases(fila.estado().rodandoTodos), ["refine o site a", "ajuste o site b: troque o telefone"]);
    assert.deepEqual(fila.estado().esperando.map((item) => item.id), [mesmoSite.id], "o ajuste do site em refino espera o refino");

    assert.equal(fila.cancelar("nao-existe"), false);
    assert.equal(fila.cancelar(mesmoSite.id), false, "o que espera é removido, não cancelado");
    const fim = proximoFim(fila);
    assert.equal(fila.cancelar(outro.id), true);
    assert.equal((await fim).resultado.status, "cancelada");
    assert.deepEqual([a.iniciadas[0].cancelada, a.iniciadas[1].cancelada], [false, true], "só a que foi pedida");

    por(fila, ajuste("c"));
    assert.equal(fila.estado().rodandoTodos.length, 2);
    await fila.parar();
    assert.deepEqual(a.iniciadas.map((e) => e.cancelada), [true, true, true], "o encerramento do painel cancela todas");
    assert.equal(fila.estado().rodandoTodos.length, 0);
    assert.deepEqual(fila.estado().esperando.map((item) => item.id), [mesmoSite.id], "e nada mais começa");
  });

  it("sem vagas de ajuste, tudo roda um de cada vez — a criação também", async () => {
    const a = executorPorSite();
    const fila = new Fila({ iniciar: a.iniciar, vagas: () => ({ criacoes: 3, ajustes: 0 }) });
    por(fila, { tipo: "refinar", slug: "outro" });
    por(fila, { tipo: "criticar", slug: "novo" });
    por(fila, ajuste("a"));
    por(fila, ajuste("b"));
    assert.deepEqual([fila.estado().rodandoTodos.length, fila.estado().esperando.length], [1, 3]);
    const fim = proximoFim(fila);
    a.iniciadas[0].terminar();
    await fim;
    assert.deepEqual(frases(fila.estado().rodandoTodos), ["critique o site novo"], "a outra criação só entra quando a primeira sai");
  });

  it("até três sites nascem juntos; o quarto espera uma vaga de criação", async () => {
    const a = executorPorSite();
    const fila = new Fila({ iniciar: a.iniciar, vagas: () => ({ criacoes: 3, ajustes: 5 }) });
    for (const slug of ["a", "b", "c", "d"]) por(fila, { tipo: "criticar", slug });
    for (const slug of ["e", "f", "g", "h", "i", "j"]) por(fila, ajuste(slug));

    assert.deepEqual(frases(fila.estado().rodandoTodos), [
      "critique o site a",
      "critique o site b",
      "critique o site c",
      ...["e", "f", "g", "h", "i"].map((slug) => `ajuste o site ${slug}: troque o telefone`),
    ]);
    assert.deepEqual(frases(fila.estado().esperando), ["critique o site d", "ajuste o site j: troque o telefone"]);

    // Uma criação termina: entra a criação que esperava, não o ajuste.
    const fim = proximoFim(fila);
    a.iniciadas[1].terminar();
    await fim;
    assert.equal(fila.estado().rodandoTodos.filter((item) => item.pedido.tipo === "criticar").length, 3);
    assert.deepEqual(frases(fila.estado().esperando), ["ajuste o site j: troque o telefone"]);
  });

  it("o site em andamento não perde a vez: o passo seguinte segura a vaga e passa à frente de um site novo", async () => {
    const a = executorPorSite();
    /** O `seguir` que o painel passa: o passo seguinte só entra depois de uma conferência demorada. */
    let soltarConferencia = () => undefined;
    const fila = new Fila({
      iniciar: a.iniciar,
      vagas: () => ({ criacoes: 2, ajustes: 1 }),
      seguir: async (fim) => {
        if (fim.item.pedido.tipo !== "criticar") return;
        await new Promise((ok) => (soltarConferencia = ok));
        fila.adicionar({ tipo: "refinar", slug: fim.item.slug }, { frase: `refine o site ${fim.item.slug}`, primeiro: true });
      },
    });
    por(fila, { tipo: "criticar", slug: "a" });
    por(fila, { tipo: "criticar", slug: "b" });
    por(fila, { tipo: "criticar", slug: "novo" });
    por(fila, ajuste("z"));
    assert.deepEqual(frases(fila.estado().esperando), ["critique o site novo"]);

    const fim = proximoFim(fila);
    a.iniciadas[0].terminar();
    const terminou = await fim;
    assert.ok(terminou.seguindo instanceof Promise, "o fim avisa que a vaga ainda está segura");
    await tick();
    // A conferência ainda não acabou: a vaga de "a" não foi para o site novo.
    assert.deepEqual(frases(fila.estado().rodandoTodos), ["critique o site b", "ajuste o site z: troque o telefone"]);
    assert.deepEqual(frases(fila.estado().esperando), ["critique o site novo"]);

    // Um ajuste que termina no meio da espera não libera vaga de criação.
    a.iniciadas[2].terminar();
    await tick();
    assert.deepEqual(frases(fila.estado().esperando), ["critique o site novo"]);

    soltarConferencia();
    await terminou.seguindo;
    await tick();
    assert.deepEqual(frases(fila.estado().rodandoTodos), ["critique o site b", "refine o site a"], "o refino de \"a\" ficou com a vaga dele");
    assert.deepEqual(frases(fila.estado().esperando), ["critique o site novo"]);
  });

  it("o passo seguinte entra na frente de quem nem começou, atrás de outros passos seguintes", () => {
    const fila = new Fila({ iniciar: executorPorSite().iniciar, vagas: () => ({ criacoes: 1, ajustes: 1 }) });
    por(fila, { tipo: "criticar", slug: "ocupa" });
    por(fila, { tipo: "criticar", slug: "novo" });
    fila.adicionar({ tipo: "refinar", slug: "a" }, { frase: "refine o site a", primeiro: true });
    fila.adicionar({ tipo: "refinar", slug: "b" }, { frase: "refine o site b", primeiro: true });
    assert.deepEqual(frases(fila.estado().esperando), ["refine o site a", "refine o site b", "critique o site novo"]);
  });

  it("um seguir que falha ou demora não prende a vaga para sempre", async () => {
    const a = executorPorSite();
    const fila = new Fila({
      iniciar: a.iniciar,
      vagas: () => ({ criacoes: 1, ajustes: 1 }),
      seguir: async () => {
        throw new Error("o motor não respondeu");
      },
    });
    por(fila, { tipo: "criticar", slug: "a" });
    por(fila, { tipo: "criticar", slug: "b" });
    const fim = proximoFim(fila);
    a.iniciadas[0].terminar();
    await (await fim).seguindo;
    await tick();
    assert.deepEqual(frases(fila.estado().rodandoTodos), ["critique o site b"]);
  });
});
