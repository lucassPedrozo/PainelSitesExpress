import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractAgentText } from "./agent-text.js";

describe("fala do agente", () => {
  it("tira a mensagem ao usuário e ignora pensamentos e comandos", () => {
    const content = `
<lov-tool-use id="a" name="user_messaging--message_user" integration-id="user_messaging" data="{\\"finished\\":false,\\"summary\\":\\"Opções descartadas\\",\\"message\\":\\"Prefere manter o banner atual? Posso seguir só com as seções de baixo.\\"}">
</lov-tool-use>

<lov-tool-use id="b" name="code--exec" integration-id="code" data="{\\"command\\":\\"ls\\"}">
</lov-tool-use>

<lov-tool-use id="c" name="lov-think" data="**Pensando** no layout &apos;x&apos;" duration="0">
</lov-tool-use>`;
    assert.equal(
      extractAgentText(content),
      "Prefere manter o banner atual? Posso seguir só com as seções de baixo.",
    );
  });

  it("texto solto fora das marcações também é fala", () => {
    assert.equal(
      extractAgentText('Posso seguir com o plano? <lov-tool-use name="lov-think" data="x"></lov-tool-use>'),
      "Posso seguir com o plano?",
    );
  });

  it("sem fala nenhuma, devolve null", () => {
    assert.equal(extractAgentText('<lov-tool-use name="code--view" data="{}"></lov-tool-use>'), null);
    assert.equal(extractAgentText(undefined), null);
  });
});
