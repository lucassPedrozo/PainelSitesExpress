import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CONTRATO_DA_EDICAO, MODELO_PADRAO } from "./contrato.js";

/**
 * O contrato da edição é uma adaptação do contrato do motor
 * (`joinvixable/config/headless.json`): as regras de arquivo mudam, porque o
 * agente trabalha num clone e não na pasta do motor, mas o resto — o modo, o
 * ambiente, as variáveis tiradas e os comandos de shell negados — acompanha o
 * do motor. Quando o motor muda, estes testes apontam o que a edição precisa
 * rever.
 *
 * O pacote do motor vive num repositório privado. Onde ele não está — um clone
 * público, o CI — estes testes são pulados.
 */

const arquivo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "joinvixable", "config", "headless.json");
const pular = fs.existsSync(arquivo) ? false : "pacote do motor ausente";
const motor = pular ? null : JSON.parse(fs.readFileSync(arquivo, "utf8"));

describe("o contrato da edição acompanha o do motor", { skip: pular }, () => {
  it("tem as mesmas chaves (a nota e o modelo, a edição define à parte)", () => {
    const doMotor = Object.keys(motor).filter((chave) => chave !== "_nota" && chave !== "modelo");
    assert.deepEqual(Object.keys(CONTRATO_DA_EDICAO).sort(), doMotor.sort());
    assert.deepEqual(Object.keys(CONTRATO_DA_EDICAO.esforco).sort(), Object.keys(motor.esforco).sort());
  });

  it("o modo, as configurações, o ambiente, a espera do cancelamento e o modelo são os do motor", () => {
    for (const chave of ["modo_de_permissao", "fontes_de_configuracao", "configuracoes", "variaveis_definidas", "cancelamento_espera_ms"]) {
      assert.deepEqual(CONTRATO_DA_EDICAO[chave], motor[chave], chave);
    }
    for (const nome of motor.variaveis_removidas) {
      assert.ok(CONTRATO_DA_EDICAO.variaveis_removidas.includes(nome), `falta tirar ${nome} do ambiente`);
    }
    assert.equal(MODELO_PADRAO, motor.modelo);
  });

  it("nenhuma ferramenta além das do motor", () => {
    for (const ferramenta of CONTRATO_DA_EDICAO.ferramentas) {
      assert.ok(motor.ferramentas.includes(ferramenta), `${ferramenta} não está no motor`);
    }
  });

  it("nega todo comando de shell e toda leitura que o motor nega", () => {
    for (const regra of motor.negar.filter((r) => /^(Bash|Read)\(/.test(r))) {
      assert.ok(CONTRATO_DA_EDICAO.negar.includes(regra), `falta negar ${regra}`);
    }
  });
});
