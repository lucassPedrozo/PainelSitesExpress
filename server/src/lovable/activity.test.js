import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentActivityFrom, describeTool } from "./activity.js";

/**
 * Mensagens no formato do `list_messages`: cada ferramenta vira uma tag
 * `<lov-tool-use>` com o `data` em JSON de aspas escapadas — e o patch traz
 * `>` e `=>`, que cortavam a leitura na primeira versão.
 */
const tool = (name, data) =>
  `<lov-tool-use id="x" name="${name}" integration-id="code" data="${JSON.stringify(data).replace(/"/g, '\\"')}"> </lov-tool-use>`;

const pedido = { role: "user", created_at: "2026-09-24T12:00:00Z", content: "Crie o site" };
const resposta = (...tools) => ({
  role: "assistant",
  created_at: "2026-09-24T12:05:00Z",
  content: tools.join("\n"),
});

describe("agentActivityFrom", () => {
  it("começa planejando, lendo o material", () => {
    const atividade = agentActivityFrom([
      resposta(tool("lov-think", {}), tool("code--view", { file_path: "user-uploads://briefing.pdf" })),
      pedido,
    ]);
    assert.equal(atividade?.phase, "planning");
    assert.equal(atividade?.current, "Lendo anexo briefing.pdf");
    assert.equal(atividade?.startedAt, "2026-09-24T12:00:00Z");
  });

  it("conta os arquivos escritos, mesmo com => e <div> dentro do patch", () => {
    const patch = "*** Begin Patch\n*** Add File: src/components/Hero.tsx\n+const Hero = () => <div>oi</div>;\n*** Update File: src/App.tsx\n*** End Patch";
    const atividade = agentActivityFrom([
      resposta(
        tool("code--apply_patch", { patch }),
        tool("code--write", { file_path: "src/pages/Index.tsx", content: "<main/>" }),
        tool("lov-think", {}),
      ),
      pedido,
    ]);
    assert.equal(atividade?.phase, "writing");
    assert.equal(atividade?.filesWritten, 3);
    assert.equal(atividade?.steps, 3);
    // O pensamento entre ações não esconde a última ação concreta.
    assert.equal(atividade?.current, "Editando src/pages/Index.tsx");
  });

  it("depois de escrever, rodar o build é conferência; a resposta é o fim", () => {
    const escrita = tool("code--write", { file_path: "src/a.tsx" });
    const build = tool("code--exec", { command: "bun run build", user_facing_description: "Conferindo o build" });
    assert.equal(agentActivityFrom([resposta(escrita, build), pedido])?.phase, "checking");
    assert.equal(
      agentActivityFrom([resposta(escrita, build, tool("user_messaging--message_user", {})), pedido])?.phase,
      "answering",
    );
    // Rodar um comando antes de escrever qualquer coisa ainda é planejamento.
    assert.equal(agentActivityFrom([resposta(build), pedido])?.phase, "planning");
  });

  it("só conta o trabalho em curso: o que veio antes do último pedido fica de fora", () => {
    const antigo = { ...resposta(tool("code--write", { file_path: "src/velho.tsx" })), created_at: "2026-09-24T11:00:00Z" };
    const atividade = agentActivityFrom([pedido, antigo]);
    assert.equal(atividade?.steps, 0);
    assert.equal(atividade?.filesWritten, 0);
  });
});

describe("describeTool", () => {
  it("fala português com o arquivo ou o comando", () => {
    assert.equal(describeTool("imagegen--generate_image", {}), "Gerando uma imagem");
    assert.equal(describeTool("comments--read_thread", {}), "Respondendo comentários no projeto");
    assert.equal(describeTool("code--exec", {}), "Executando um comando");
    assert.equal(describeTool("code--line_replace", { file_path: "src/x.tsx" }), "Editando src/x.tsx");
  });
});
