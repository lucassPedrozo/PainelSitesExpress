import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

/**
 * O store guarda estado no módulo e lê a pasta de dados da configuração, que é
 * resolvida uma vez. Por isso: uma pasta temporária para o arquivo inteiro,
 * limpa entre os testes, e o estado em memória esquecido no começo de cada
 * teste — como num reinício, a primeira leitura volta ao disco. Os módulos
 * são importados depois de definir a pasta, para a configuração enxergá-la.
 */
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "painel-store-"));
process.env.PANEL_DATA_DIR = dataDir;

const { resetStoreForTests } = await import("./db.js");
const modules = await Promise.all(
  ["tags", "project-names", "generations", "publications", "access-users"].map(
    (name) => import(`./${name}.js`),
  ),
);
const store = Object.assign({}, ...modules);
const freshStore = async () => {
  resetStoreForTests();
  return store;
};

const dataFile = path.join(dataDir, "painel.json");
const readDisk = async () => JSON.parse(await fs.readFile(dataFile, "utf8"));

const silenced = async (fn) => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
};

describe("store", () => {
  beforeEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.mkdir(dataDir, { recursive: true });
  });

  after(() => fs.rm(dataDir, { recursive: true, force: true }));

  it("primeira execução cria as tags de exceção uma vez só, mesmo com leituras simultâneas", () =>
    silenced(async () => {
      const store = await freshStore();

      // Antes, cada leitura concorrente criava o seu conjunto de ids.
      const [a, b] = await Promise.all([store.listTags(), store.listTags()]);
      assert.deepEqual(
        a.map((tag) => tag.id),
        b.map((tag) => tag.id),
      );

      const disk = await readDisk();
      assert.deepEqual(
        disk.tags.map((tag) => tag.id),
        a.map((tag) => tag.id),
      );
      assert.deepEqual(
        disk.tags.map((tag) => tag.name),
        ["Material incompleto", "Aguardando cliente", "Finalizado"],
      );
      assert.ok(disk.finishedTagId);
      assert.equal(disk.stageTagsRetired, true);
    }));

  it("aposenta as tags de etapa uma vez, tirando-as dos projetos", () =>
    silenced(async () => {
      await fs.writeFile(
        dataFile,
        JSON.stringify({
          tags: [
            { id: "t1", name: "A avaliar", color: "amber" },
            { id: "t2", name: "Material incompleto", color: "red" },
            { id: "t3", name: "entregue", color: "violet" },
            { id: "t4", name: "Finalizado", color: "slate" },
          ],
          projectTags: { a: ["t1"], b: ["t1", "t2"], c: ["t3", "t4"] },
          defaultTagId: "t1",
          finishedTagId: "t4",
        }),
      );

      const store = await freshStore();
      const nomes = (await store.listTags()).map((tag) => tag.name);
      assert.deepEqual(nomes, ["Material incompleto", "Finalizado", "Aguardando cliente"]);

      const disk = await readDisk();
      assert.deepEqual(disk.projectTags, { b: ["t2"], c: ["t4"] });
      assert.equal(disk.defaultTagId, undefined);
      assert.equal(disk.stageTagsRetired, true);

      // Depois disso, uma "A avaliar" criada à mão é decisão de alguém.
      await store.createTag({ name: "A avaliar", color: "amber" });
      const denovo = await freshStore();
      assert.ok((await denovo.listTags()).some((tag) => tag.name === "A avaliar"));
    }));

  it("renomeia o tags.json antigo para painel.json sem perder dados", () =>
    silenced(async () => {
      const legado = {
        tags: [{ id: "t1", name: "Cliente VIP", color: "amber" }],
        projectTags: { "pasta-1": ["t1"] },
        finishedTagId: null,
        names: { "pasta-1": "Cliente Um" },
      };
      await fs.writeFile(path.join(dataDir, "tags.json"), JSON.stringify(legado));

      const store = await freshStore();
      assert.equal((await store.listProjectNames())["pasta-1"], "Cliente Um");

      await assert.rejects(fs.access(path.join(dataDir, "tags.json")));
      assert.deepEqual((await readDisk()).projectTags, { "pasta-1": ["t1"] });
    }));

  it("arquivo corrompido sobe a partir da cópia mais recente que abre", () =>
    silenced(async () => {
      await fs.writeFile(dataFile, "{ corrompido");
      const backups = path.join(dataDir, "backups");
      await fs.mkdir(backups);
      await fs.writeFile(
        path.join(backups, "tags-2026-09-10.json"),
        JSON.stringify({ tags: [], names: { p: "antigo" }, defaultTagId: null, finishedTagId: null }),
      );
      await fs.writeFile(
        path.join(backups, "painel-2026-09-12.json"),
        JSON.stringify({ tags: [], names: { p: "recente" }, defaultTagId: null, finishedTagId: null }),
      );
      await fs.writeFile(path.join(backups, "painel-2026-09-13.json"), "também ilegível");

      const store = await freshStore();
      assert.equal((await store.listProjectNames()).p, "recente");
    }));

  it("recusa tag inexistente e esquece projeto sem tag", () =>
    silenced(async () => {
      const store = await freshStore();
      const [tag] = await store.listTags();

      await assert.rejects(store.setProjectTags("pasta-1", ["nao-existe"]), (err) => err.status === 400);

      assert.deepEqual(await store.setProjectTags("pasta-1", [tag.id, tag.id]), [tag.id]);
      assert.deepEqual(await store.setProjectTags("pasta-1", []), []);
      assert.deepEqual(await store.listProjectTags(), {});
    }));

  it("só registra entrega de link que abre", () =>
    silenced(async () => {
      const store = await freshStore();
      await store.recordGeneration("pasta-1", { id: "lov-1", url: "https://lovable.dev/projects/1" });

      await store.setGenerationPreviewState("pasta-1", "lov-1", { state: "alive", detail: "ok" });
      const entregue = await store.setGenerationDelivered("pasta-1", "lov-1", { delivered: true, by: "Ana" });
      assert.equal(entregue.deliveredBy, "Ana");

      await store.setGenerationPreviewState("pasta-1", "lov-1", { state: "dead", detail: "excluído" });
      await assert.rejects(
        store.setGenerationDelivered("pasta-1", "lov-1", { delivered: true, by: "Ana" }),
        (err) => err.status === 409,
      );
    }));

  it("o link do cliente passa a ser a pasta da área depois de conferida", () =>
    silenced(async () => {
      const store = await freshStore();
      await store.recordGeneration("pasta-1", { id: "lov-1" });
      await store.setGenerationPreview("pasta-1", "lov-1", {
        sharePreviewUrl: "https://lovable.dev/preview/abcdefgh",
        shortUrl: "https://curto.com/ze",
      });

      const publicando = await store.setGenerationDevArea("pasta-1", "lov-1", {
        state: "publishing",
        url: "https://area.dev/zezinho/",
      });
      // Enquanto a pasta não foi conferida, o link antigo continua valendo.
      assert.equal(publicando.clientUrl, "https://curto.com/ze");

      const noAr = await store.setGenerationDevArea(
        "pasta-1",
        "lov-1",
        { state: "live", publishedSha: "abc" },
        { state: "alive", detail: null },
      );
      assert.equal(noAr.clientUrl, "https://area.dev/zezinho/");
      assert.equal(noAr.devArea.url, "https://area.dev/zezinho/");
      assert.equal(noAr.previewState, "alive");

      const [lida] = (await store.listGenerations())["pasta-1"];
      assert.equal(lida.clientUrl, "https://area.dev/zezinho/");
      const entregue = await store.setGenerationDelivered("pasta-1", "lov-1", { delivered: true, by: "Ana" });
      assert.equal(entregue.clientUrl, "https://area.dev/zezinho/");
    }));

  it("chave de acesso: mostrada uma vez, guardada só em hash, revogável", () =>
    silenced(async () => {
      const store = await freshStore();
      const { user, key } = await store.createAccessUser("Ana", ["organizar"]);

      assert.deepEqual(user.permissions, ["organizar"]);
      assert.equal((await store.findAccessUserByKey(key))?.id, user.id);
      assert.equal(await store.findAccessUserByKey(`${key}x`), null);

      const disk = await fs.readFile(dataFile, "utf8");
      assert.ok(!disk.includes(key), "a chave foi gravada em claro");

      await assert.rejects(store.createAccessUser(" ana ", []), (err) => err.status === 409);
      await assert.rejects(store.setAccessUserPermissions(user.id, ["voar"]), (err) => err.status === 400);

      await store.revokeAccessUser(user.id);
      assert.equal(await store.findAccessUserByKey(key), null);
    }));

  it("histórico de publicação guarda os últimos 20 disparos", () =>
    silenced(async () => {
      const store = await freshStore();
      await store.recordPublicationConfig("org/site", { domain: "site.com.br", branch: "main", by: "Ana" });

      for (let n = 0; n < 25; n += 1) {
        await store.recordDeploy("org/site", { by: "Ana", dryRun: false, branch: "main" });
      }
      const real = (await store.listPublications())[0];
      assert.equal(real.deploys.length, 20);
      assert.equal(real.domain, "site.com.br");
    }));

  it("disparo real marca 'publicando'; o resultado vem das execuções", () =>
    silenced(async () => {
      const store = await freshStore();
      await store.recordPublicationConfig("org/site", { domain: "site.com.br", branch: "main", by: "Ana" });

      const { deploy } = await store.recordDeploy("org/site", { by: "Ana", dryRun: false, branch: "main" });
      let pub = (await store.listPublications())[0];
      assert.equal(pub.lastDeployAt, undefined);
      assert.deepEqual(store.lastAttemptOf(pub), { at: deploy.at, status: "pending", runUrl: null, progress: null });

      await store.setPublicationRuns("org/site", {
        lastRun: { at: "2026-09-23T12:00:05Z", status: "success", runUrl: "https://gh/run/1", event: "workflow_dispatch" },
        lastSuccessAt: "2026-09-23T12:00:05Z",
      });
      pub = (await store.listPublications())[0];
      assert.equal(pub.lastDeployAt, "2026-09-23T12:00:05Z");

      // Nenhum sucesso na janela lida não apaga o que se sabia.
      await store.setPublicationRuns("org/site", {
        lastRun: { at: "2026-09-23T13:00:00Z", status: "failure", runUrl: "https://gh/run/2", event: "push" },
        lastSuccessAt: null,
      });
      pub = (await store.listPublications())[0];
      assert.equal(pub.lastDeployAt, "2026-09-23T12:00:05Z");
      assert.equal(store.lastAttemptOf(pub)?.status, "failure");

      // Simulação não mexe no estado da publicação.
      await store.recordDeploy("org/site", { by: "Ana", dryRun: true, branch: "main" });
      pub = (await store.listPublications())[0];
      assert.equal(store.lastAttemptOf(pub)?.status, "failure");
    }));

  it("trocar o projeto do Lovable mantém o link do cliente e a pasta, e zera o resto", () =>
    silenced(async () => {
      const store = await freshStore();
      await store.recordGeneration("pasta-1", { id: "lov-velho" });
      await store.setGenerationPreview("pasta-1", "lov-velho", {
        sharePreviewUrl: "https://lovable.dev/preview/velho",
        shortLinkId: 7,
        shortSlug: "aurora-eng-br",
        shortUrl: "https://formularios.joinvix.com.br/aurora-eng-br",
      });
      await store.setGenerationDevArea("pasta-1", "lov-velho", {
        slug: "aurora-eng-br",
        url: "https://area/aurora-eng-br/",
        repoFullName: "org/velho",
        branch: "main",
        state: "live",
        publishedSha: "abc",
      });

      const { generation, previousRepo, previousBranch } = await store.changeGenerationProject(
        "pasta-1",
        "lov-velho",
        { id: "lov-novo", url: "https://lovable.dev/projects/lov-novo", lovableName: "Aurora Novo" },
      );
      assert.equal(generation.id, "lov-novo");
      assert.equal(generation.lovableName, "Aurora Novo");
      assert.equal(generation.sharePreviewUrl, null);
      assert.equal(generation.repoFullName, null);
      // O cliente continua com o mesmo endereço.
      assert.equal(generation.shortUrl, "https://formularios.joinvix.com.br/aurora-eng-br");
      assert.equal(generation.clientUrl, "https://formularios.joinvix.com.br/aurora-eng-br");
      // A pasta fica; o repositório antigo sai.
      assert.deepEqual(generation.devArea, { slug: "aurora-eng-br", url: "https://area/aurora-eng-br/", state: "retired" });
      assert.equal(previousRepo, "org/velho");
      assert.equal(previousBranch, "main");

      const lista = (await store.listGenerations())["pasta-1"];
      assert.equal(lista.length, 1);
      await assert.rejects(
        store.changeGenerationProject("pasta-1", "lov-inexistente", { id: "x", url: "u", lovableName: null }),
        /não encontrada/,
      );
    }));
});
