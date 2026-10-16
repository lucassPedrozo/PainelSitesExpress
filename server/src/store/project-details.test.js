import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

/*
 * Como em store.test.js: uma pasta de dados temporária para o arquivo
 * inteiro, e o estado em memória esquecido a cada teste — a primeira leitura
 * volta ao disco, como num reinício.
 */
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "painel-detalhes-"));
process.env.PANEL_DATA_DIR = dataDir;

const { resetStoreForTests } = await import("./db.js");
const { listProjectDetails, updateProjectDetails } = await import("./project-details.js");

const AGORA = new Date("2026-10-14T15:00:00.000Z");
const dataFile = path.join(dataDir, "painel.json");
const readDisk = async () => JSON.parse(await fs.readFile(dataFile, "utf8"));

describe("o que a equipe corrige à mão no projeto", () => {
  beforeEach(async () => {
    await fs.rm(dataFile, { force: true });
    resetStoreForTests();
  });
  after(() => fs.rm(dataDir, { recursive: true, force: true }));

  it("grava os campos e devolve o domínio limpo", async () => {
    const gravado = await updateProjectDetails(
      "pasta-1",
      {
        domain: " https://www.Aurora.eng.br/ ",
        receivedAt: "2026-09-29T12:00:00.000Z",
        responsible: " Ana ",
        note: "Cliente pediu para esperar a logo nova.",
      },
      { now: AGORA },
    );
    assert.deepEqual(gravado, {
      domain: "aurora.eng.br",
      receivedAt: "2026-09-29T12:00:00.000Z",
      responsible: "Ana",
      note: "Cliente pediu para esperar a logo nova.",
    });
    // Sobrevive a um reinício: está no disco.
    resetStoreForTests();
    assert.equal((await listProjectDetails())["pasta-1"].responsible, "Ana");
    assert.equal((await readDisk()).details["pasta-1"].domain, "aurora.eng.br");
  });

  it("só muda o que veio; vazio volta ao cálculo e o registro some quando esvazia", async () => {
    await updateProjectDetails("pasta-1", { responsible: "Ana", note: "Nota" }, { now: AGORA });
    const parcial = await updateProjectDetails("pasta-1", { note: "" }, { now: AGORA });
    assert.deepEqual(parcial, { responsible: "Ana" });
    assert.equal(await updateProjectDetails("pasta-1", { responsible: null }, { now: AGORA }), null);
    assert.equal((await listProjectDetails())["pasta-1"], undefined);
  });

  it("a etapa manual guarda quando e por quem foi escolhida", async () => {
    const gravado = await updateProjectDetails("pasta-1", { stage: "no-ar" }, { by: "Bruno", now: AGORA });
    assert.deepEqual(gravado?.stage, { etapa: "no-ar", at: AGORA.toISOString(), by: "Bruno" });
    const limpo = await updateProjectDetails("pasta-1", { stage: null }, { now: AGORA });
    assert.equal(limpo, null);
  });

  it("ocultar guarda quando e por quem; mostrar de novo apaga", async () => {
    const oculto = await updateProjectDetails("pasta-1", { hidden: true }, { by: "Ana", now: AGORA });
    assert.deepEqual(oculto?.hidden, { at: AGORA.toISOString(), by: "Ana" });
    assert.equal(await updateProjectDetails("pasta-1", { hidden: false }, { now: AGORA }), null);
    await assert.rejects(updateProjectDetails("pasta-1", { hidden: "sim" }, { now: AGORA }), /sim ou não/);
  });

  it("recusa o que não é domínio, data inválida ou futura e etapa desconhecida", async () => {
    await assert.rejects(updateProjectDetails("p", { domain: "contato@aurora.eng.br" }, { now: AGORA }), /Domínio inválido/);
    await assert.rejects(updateProjectDetails("p", { domain: "aurora.eng.br e outro.com.br" }, { now: AGORA }), /Domínio inválido/);
    await assert.rejects(updateProjectDetails("p", { receivedAt: "ontem" }, { now: AGORA }), /inválida/);
    await assert.rejects(updateProjectDetails("p", { receivedAt: "2027-01-01" }, { now: AGORA }), /futuro/);
    await assert.rejects(updateProjectDetails("p", { stage: "aprovado" }, { now: AGORA }), /Etapa desconhecida/);
    await assert.rejects(updateProjectDetails("p", { note: "x".repeat(1001) }, { now: AGORA }), /muito longa/);
  });

  it("um campo inválido não deixa os outros gravados pela metade", async () => {
    await assert.rejects(
      updateProjectDetails("pasta-1", { responsible: "Ana", domain: "não é domínio" }, { now: AGORA }),
      /Domínio inválido/,
    );
    assert.equal((await listProjectDetails())["pasta-1"], undefined);
  });
});
