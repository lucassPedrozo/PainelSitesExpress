import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSignatureAsset, interpretProgress, readProject, replyToAgent } from "./progress.js";

describe("andamento do agente", () => {
  it("parado esperando alguém ganha de tudo", () => {
    const r = interpretProgress({ agentFinished: false }, [
      { role: "assistant", status: "awaiting_input" },
      { role: "user", status: "accepted" },
    ]);
    assert.equal(r.state, "awaiting");
  });

  it("a pausa também pode vir no status aninhado da resposta", () => {
    const r = interpretProgress({ agentFinished: false }, [
      { role: "user", status: "running", response: { status: "awaiting_input" } },
    ]);
    assert.equal(r.state, "awaiting");
  });

  it("parado: traz a pergunta que o agente fez", () => {
    const pergunta =
      '<lov-tool-use name="user_messaging--message_user" data="{\\"message\\":\\"Aprova o plano?\\"}"></lov-tool-use>';
    const r = interpretProgress({ agentFinished: false }, [
      { role: "assistant", status: "awaiting_input", content: pergunta },
    ]);
    assert.equal(r.question, "Aprova o plano?");
  });

  it("sem pausa e sem terminar, está trabalhando", () => {
    const r = interpretProgress({ agentFinished: false }, [
      { role: "user", status: "accepted" },
    ]);
    assert.equal(r.state, "running");
  });

  it("terminou: devolve a resposta mais recente do agente", () => {
    const r = interpretProgress({ agentFinished: true }, [
      { role: "assistant", status: "completed", content: "Já usado: x" },
      { role: "user", status: "accepted", content: "briefing" },
    ]);
    assert.deepEqual(r, { state: "done", lastReply: "Já usado: x" });
  });
});

describe("assinatura no código", () => {
  it("reconhece o arquivo que a Knowledge manda salvar", () => {
    assert.equal(hasSignatureAsset(["src/assets/joinvix-rodape-claro.webp"]), true);
    assert.equal(hasSignatureAsset(["public/joinvix-assinatura.png"]), true);
  });

  it("sem o arquivo, ou fora de src/public, não conta", () => {
    assert.equal(hasSignatureAsset(["src/assets/logo.png", "README.md"]), false);
    assert.equal(hasSignatureAsset(["docs/joinvix.md"]), false);
  });
});

describe("mensagem recém-chegada", () => {
  it("última mensagem do usuário: o agente ainda vai responder", () => {
    const r = interpretProgress({ agentFinished: true }, [
      { role: "user", status: "queued", content: "Adicione a assinatura" },
      { role: "assistant", status: "completed", content: "Site pronto" },
    ]);
    assert.equal(r.state, "running");
  });
});

describe("resposta ao agente parado", () => {
  it("recusa resposta vazia e geração desligada antes de chamar o Lovable", async () => {
    let chamadas = 0;
    const call = async () => {
      chamadas += 1;
    };
    const liberada = () => ({ enabled: true, reason: null });
    const desligada = () => ({ enabled: false, reason: "desligada" });

    await assert.rejects(replyToAgent("p", "l", "   ", { call, gate: liberada }), (err) => err.status === 400);
    await assert.rejects(replyToAgent("p", "l", "Pode seguir", { call, gate: desligada }), (err) => err.status === 423);
    assert.equal(chamadas, 0);
  });
});

describe("leitura do get_project", () => {
  it("agentFinished e a captura vêm do objeto aninhado; o nome, do nível de cima", () => {
    const raw = {
      name: "SBC Cobranças: Smart Recovery",
      latest_screenshot_url: "https://shot/topo.png",
      project: { agentFinished: true, screenshotUrl: "https://shot/aninhado.png" },
    };
    assert.deepEqual(readProject(raw), {
      agentFinished: true,
      screenshotUrl: "https://shot/aninhado.png",
      name: "SBC Cobranças: Smart Recovery",
    });
    assert.equal(readProject({ project: {} }).agentFinished, false);
    assert.equal(readProject({ latest_screenshot_url: "x" }).screenshotUrl, "x");
  });
});
