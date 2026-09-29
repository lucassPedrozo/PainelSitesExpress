import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findRunForDispatch, outcomeOf, summarizeRuns, syncPublication } from "./watch.js";

const run = (created_at, event, status, conclusion = null, id = created_at) => ({
  id,
  created_at,
  event,
  status,
  conclusion,
  html_url: `https://gh/run/${id}`,
});

const agora = Date.parse("2026-09-23T13:00:00Z");

describe("execuções do deploy", () => {
  it("acha a primeira execução disparada depois do pedido", () => {
    const runs = [
      run("2026-09-23T12:05:00Z", "workflow_dispatch", "completed", "success", 3),
      run("2026-09-23T12:00:04Z", "workflow_dispatch", "completed", "success", 2),
      run("2026-09-23T12:00:02Z", "push", "completed", "success", 9),
      run("2026-09-23T11:40:00Z", "workflow_dispatch", "completed", "success", 1),
    ];
    assert.equal(findRunForDispatch(runs, "2026-09-23T12:00:00Z")?.id, 2);
    assert.equal(findRunForDispatch([runs[3]], "2026-09-23T12:00:00Z"), null);
  });

  it("só sucesso conta como sucesso", () => {
    assert.equal(outcomeOf({ status: "in_progress", conclusion: null }), null);
    assert.equal(outcomeOf({ status: "completed", conclusion: "success" }), "success");
    assert.equal(outcomeOf({ status: "completed", conclusion: "failure" }), "failure");
  });

  it("disparos falhos seguidos de push bem-sucedido: está no ar", () => {
    const runs = [
      run("2026-09-10T13:01:39Z", "push", "completed", "success"),
      run("2026-09-10T13:01:37Z", "push", "completed", "cancelled"),
      run("2026-09-10T12:58:04Z", "push", "completed", "failure"),
      run("2026-09-10T12:43:59Z", "workflow_dispatch", "completed", "failure"),
    ];
    const { lastRun, lastSuccessAt } = summarizeRuns(runs, { now: agora });
    assert.equal(lastRun?.status, "success");
    assert.equal(lastRun?.event, "push");
    assert.equal(lastSuccessAt, "2026-09-10T13:01:39Z");
  });

  it("cancelada não conta como a mais recente — foi atropelada por outra", () => {
    const runs = [
      run("2026-09-10T13:01:40Z", "push", "completed", "cancelled"),
      run("2026-09-10T13:01:39Z", "push", "in_progress"),
    ];
    assert.equal(summarizeRuns(runs, { now: agora }).lastRun?.status, "pending");
  });

  it("a simulação não entra: não publica nada", () => {
    const runs = [
      run("2026-09-23T12:00:05Z", "workflow_dispatch", "completed", "failure"),
      run("2026-09-22T10:00:00Z", "push", "completed", "success"),
    ];
    const { lastRun } = summarizeRuns(runs, {
      dryRunDispatches: ["2026-09-23T12:00:00Z"],
      now: agora,
    });
    assert.equal(lastRun?.status, "success");
  });

  it("disparo cuja execução ainda não apareceu segue publicando, até desistir", () => {
    const pendente = { at: "2026-09-23T12:59:50Z", status: "pending", runUrl: null };
    const runs = [run("2026-09-22T10:00:00Z", "push", "completed", "success")];

    const cedo = summarizeRuns(runs, { current: pendente, now: agora });
    assert.equal(cedo.lastRun, pendente);
    assert.equal(cedo.lastSuccessAt, "2026-09-22T10:00:00Z");

    const tarde = summarizeRuns(runs, { current: pendente, now: agora + 2 * 60 * 60_000 });
    assert.equal(tarde.lastRun?.status, "unknown");
  });

  it("grava o que leu do GitHub", async () => {
    const gravados = [];
    await syncPublication(
      { repoFullName: "org/site", branch: "main", deploys: [] },
      {
        listRuns: async () => [run("2026-09-23T12:00:00Z", "push", "completed", "failure")],
        record: async (repo, estado) => {
          gravados.push({ repo, ...estado });
        },
        now: () => agora,
      },
    );
    assert.equal(gravados[0].repo, "org/site");
    assert.equal(gravados[0].lastRun?.status, "failure");
    assert.equal(gravados[0].lastSuccessAt, null);
  });
});
