import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertBranch,
  assertBuildEnv,
  assertDomain,
  assertPort,
  assertServerDir,
  parsePublicationRequest,
} from "./input.js";

const rejects400 = (fn) =>
  assert.throws(fn, (err) => err.status === 400);

const valid = {
  branch: "main",
  domain: "Cliente.com.br",
  ftpServer: "ftp.cliente.com.br",
  ftpLogin: "usuario",
  ftpPassword: "senha",
};

const secretOf = (secrets, name) =>
  secrets.find((secret) => secret.name === name)?.value;

describe("entrada do deploy", () => {
  it("domínio sem protocolo nem caminho, normalizado em minúsculas", () => {
    assert.equal(assertDomain(" Site.COM.br "), "site.com.br");
    rejects400(() => assertDomain("https://site.com.br"));
    rejects400(() => assertDomain("site.com.br/pagina"));
    rejects400(() => assertDomain("localhost"));
  });

  it("branch recusa subida de pasta", () => {
    assert.equal(assertBranch("feature/nova"), "feature/nova");
    rejects400(() => assertBranch("../main"));
    rejects400(() => assertBranch(undefined));
  });

  it("pasta remota: vazia é permitida, '..' não, barra final sai", () => {
    assert.equal(assertServerDir(""), "");
    assert.equal(assertServerDir("public_html/"), "public_html");
    rejects400(() => assertServerDir("public_html/../etc"));
  });

  it("porta vazia usa o padrão; fora da faixa é recusada", () => {
    assert.equal(assertPort(""), "");
    assert.equal(assertPort("21"), "21");
    rejects400(() => assertPort("70000"));
    rejects400(() => assertPort("21.5"));
  });

  it("variáveis de build no formato CHAVE=valor, comentários aceitos", () => {
    assert.equal(assertBuildEnv("# nota\nVITE_API=https://x"), "# nota\nVITE_API=https://x");
    rejects400(() => assertBuildEnv("sem sinal de igual"));
  });

  it("opcionais vazios removem o secret; build env vazio mantém o do repositório", () => {
    const { secrets, domain, autoDeploy } = parsePublicationRequest(valid);
    assert.equal(domain, "cliente.com.br");
    assert.equal(autoDeploy, false);
    assert.equal(secretOf(secrets, "FTP_SERVER_DIR"), null);
    assert.equal(secretOf(secrets, "FTP_PROTOCOL"), null);
    assert.equal(secretOf(secrets, "FTP_PORT"), null);
    // `undefined` é "não mexer": as variáveis de build não voltam à interface.
    assert.equal(secretOf(secrets, "BUILD_ENV_FILE"), undefined);

    const limpo = parsePublicationRequest({ ...valid, clearBuildEnv: true });
    assert.equal(secretOf(limpo.secrets, "BUILD_ENV_FILE"), null);
  });

  it("não aceita enviar e remover as variáveis de build ao mesmo tempo", () => {
    rejects400(() =>
      parsePublicationRequest({ ...valid, buildEnv: "A=1", clearBuildEnv: true }),
    );
  });
});
