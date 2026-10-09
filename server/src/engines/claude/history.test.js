import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { importarHistorico, mesclarHistorico } from "./history.js";

/*
 * O histórico de layouts que vem da ferramenta antiga. Tudo em pastas
 * temporárias: nenhum teste lê o Joinvixable de verdade nem a pasta de dados.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-claude-historico-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true }));

const site = (slug, arquetipo) => JSON.stringify({ slug, arquetipo, fontes: ["Anton", "Work Sans"] });

describe("histórico de layouts do motor Claude", () => {
  it("o que vem da ferramenta antiga vai na frente, e nada entra duas vezes", () => {
    const origem = [site("padaria", "limpo-moderno"), site("oficina", "vibrante-direto"), ""].join("\r\n");
    const vazio = mesclarHistorico(origem, "");
    assert.deepEqual([vazio.trazidas, vazio.repetidas, vazio.invalidas], [2, 0, 0]);
    assert.equal(vazio.texto, `${site("padaria", "limpo-moderno")}\n${site("oficina", "vibrante-direto")}\n`);

    // O painel já gerou um site: ele é o mais novo, e continua sendo o último.
    const doPainel = `${site("clinica", "editorial")}\n`;
    const junto = mesclarHistorico(origem, doPainel);
    assert.deepEqual(
      junto.texto.trim().split("\n").map((linha) => JSON.parse(linha).slug),
      ["padaria", "oficina", "clinica"],
    );

    // Rodar de novo não duplica.
    const denovo = mesclarHistorico(origem, junto.texto);
    assert.deepEqual([denovo.trazidas, denovo.repetidas, denovo.texto], [0, 2, junto.texto]);
  });

  it("linha que não é um registro em JSON fica de fora, e é contada", () => {
    const origem = [site("padaria", "limpo-moderno"), "{ quebrado", '"só um texto"', "[1, 2]"].join("\n");
    const r = mesclarHistorico(origem, "");
    assert.deepEqual([r.trazidas, r.invalidas], [1, 3]);
    assert.equal(r.texto, `${site("padaria", "limpo-moderno")}\n`);
    assert.equal(mesclarHistorico("", "").texto, "");
  });

  it("a importação só copia: cria a pasta do painel e não mexe na origem", () => {
    const origem = path.join(raiz, "joinvixable-antigo");
    const trabalho = path.join(raiz, "dados", "joinvixable", "trabalho");
    fs.mkdirSync(path.join(origem, ".history"), { recursive: true });
    const conteudo = `${site("padaria", "limpo-moderno")}\n${site("oficina", "vibrante-direto")}\n`;
    fs.writeFileSync(path.join(origem, ".history", "layouts.jsonl"), conteudo);

    const r = importarHistorico({ origem, trabalho });
    assert.deepEqual([r.trazidas, r.repetidas, r.invalidas, r.total], [2, 0, 0, 2]);
    assert.equal(r.arquivo, path.join(trabalho, ".history", "layouts.jsonl"));
    assert.equal(fs.readFileSync(r.arquivo, "utf8"), conteudo);
    assert.equal(fs.readFileSync(path.join(origem, ".history", "layouts.jsonl"), "utf8"), conteudo, "a origem fica como estava");
    assert.deepEqual(fs.readdirSync(path.join(trabalho, ".history")), ["layouts.jsonl"], "sem arquivo temporário sobrando");

    const denovo = importarHistorico({ origem, trabalho });
    assert.deepEqual([denovo.trazidas, denovo.repetidas, denovo.total], [0, 2, 2]);

    assert.throws(() => importarHistorico({ origem: path.join(raiz, "outra-pasta"), trabalho }), /Não há histórico de layouts/);
  });
});
