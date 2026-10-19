import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseSettingsPayload } from "./settings.js";

/**
 * A rota legada /api/deploy/config grava o .env com as mesmas recusas da tela
 * de Configurações: sem quebra de linha e sem apagar a chave do administrador
 * com o painel aberto para a rede.
 */
describe("configuração legada do deploy", () => {
  const hostAntes = process.env.SERVER_HOST;
  afterEach(() => {
    if (hostAntes === undefined) delete process.env.SERVER_HOST;
    else process.env.SERVER_HOST = hostAntes;
  });

  it("recusa quebra de linha no meio de um valor", () => {
    assert.throws(
      () => parseSettingsPayload({ organization: "acme\nPANEL_ACCESS_TOKEN=" }),
      (erro) => erro.status === 400 && /quebra de linha/.test(erro.message),
    );
    assert.throws(
      () => parseSettingsPayload({ panelAccessToken: "chave-longa-o-bastante\r\nX=1" }),
      (erro) => erro.status === 400 && /quebra de linha/.test(erro.message),
    );
  });

  it("com o painel aberto para a rede, não apaga a chave do administrador", () => {
    process.env.SERVER_HOST = "0.0.0.0";
    assert.throws(
      () => parseSettingsPayload({ panelAccessToken: "" }),
      (erro) => erro.status === 400 && /aberto para a rede/.test(erro.message),
    );
  });

  it("só nesta máquina, apagar a chave continua permitido; trocar também", () => {
    process.env.SERVER_HOST = "127.0.0.1";
    assert.deepEqual(parseSettingsPayload({ panelAccessToken: "" }), { PANEL_ACCESS_TOKEN: "" });
    process.env.SERVER_HOST = "0.0.0.0";
    assert.deepEqual(parseSettingsPayload({ panelAccessToken: "uma-chave-nova-com-16+" }), {
      PANEL_ACCESS_TOKEN: "uma-chave-nova-com-16+",
    });
  });

  it("espaços e a quebra de linha nas pontas continuam sendo aparados", () => {
    assert.deepEqual(parseSettingsPayload({ organization: "  acme\n" }), { GITHUB_ORG: "acme" });
  });
});
