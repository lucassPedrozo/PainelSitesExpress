import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";

/**
 * Projetos criados no painel: as regras do que vai ao repositório, o caminho
 * que vem do navegador, a API de verdade gravando em disco e o commit do site
 * contra um GitHub de mentira. Nada sai da máquina.
 */

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "painel-local-"));
process.env.PANEL_DATA_DIR = dataDir;
process.env.PANEL_ACCESS_TOKEN = "";
process.env.PREVIEW_WATCH_INTERVAL_MS = "0";

const { planSiteFiles, wrapperPrefix, openSiteSource, findSiteSources } = await import("./site-source.js");
const { cleanRelativePath, localFileId, parseLocalFileId } = await import("./storage.js");
const { blobShaOf, commitSite } = await import("../deploy/github/git-data.js");
const { createApp } = await import("../app.js");

const file = (filePath, size = 10) => ({ path: filePath, size });

describe("o que vai ao repositório", () => {
  it("tira a pasta que só embrulha o projeto", () => {
    assert.equal(wrapperPrefix(["meu-site/package.json", "meu-site/src/main.tsx"]), "meu-site/");
    assert.equal(wrapperPrefix(["a/b/index.html", "a/b/css/site.css"]), "a/b/");
    assert.equal(wrapperPrefix(["package.json", "src/main.tsx"]), "");
    // `src/` sozinha é o projeto sem a raiz, não um embrulho.
    assert.equal(wrapperPrefix(["src/main.tsx", "src/App.tsx"]), "");
  });

  it("deixa de fora dependências, build, .env e workflows", () => {
    const plan = planSiteFiles([
      file("site/package.json"),
      file("site/package-lock.json"),
      file("site/src/main.tsx"),
      file("site/node_modules/react/index.js"),
      file("site/dist/index.html"),
      file("site/.env"),
      file("site/.env.local"),
      file("site/.env.example"),
      file("site/.github/workflows/ci.yml"),
      file("site/.git/HEAD"),
      file("site/.DS_Store"),
    ]);
    assert.equal(plan.kind, "build");
    assert.deepEqual(
      plan.files.map((item) => item.repoPath).sort(),
      [".env.example", "package-lock.json", "package.json", "src/main.tsx"],
    );
    assert.equal(plan.skipped.reduce((sum, item) => sum + item.count, 0), 7);
    assert.deepEqual(plan.warnings, []);
  });

  it("site estático: dist não é build a descartar, e não há aviso de lock", () => {
    const plan = planSiteFiles([file("index.html"), file("dist/app.js"), file("css/site.css")]);
    assert.equal(plan.kind, "static");
    assert.equal(plan.files.length, 3);
    assert.deepEqual(plan.warnings, []);
  });

  it("avisa quando falta o arquivo de lock", () => {
    const plan = planSiteFiles([file("package.json"), file("src/main.tsx")]);
    assert.match(plan.warnings[0], /lock/);
  });

  it("recusa origem sem package.json nem index.html na raiz", () => {
    assert.throws(() => planSiteFiles([file("fotos/a.jpg"), file("logo.png")]), { status: 422 });
    assert.throws(() => planSiteFiles([]), { status: 422 });
  });

  it("recusa arquivo grande demais para o repositório", () => {
    assert.throws(
      () => planSiteFiles([file("index.html"), file("video.mp4", 60 * 1024 * 1024)]),
      { status: 422, message: /video\.mp4/ },
    );
  });
});

describe("caminho vindo do navegador", () => {
  it("normaliza barras e recusa o que sairia do projeto", () => {
    assert.equal(cleanRelativePath("site\\src//App.tsx"), "site/src/App.tsx");
    assert.equal(cleanRelativePath("./a/b"), "a/b");
    assert.equal(cleanRelativePath(""), "");
    for (const ruim of ["../x", "a/../../x", "a/con", "a/b:c", "nome. ", "a/b?.txt"]) {
      assert.throws(() => cleanRelativePath(ruim), { status: 400 }, ruim);
    }
  });

  it("o id local guarda o caminho e não se confunde com um id do Drive", () => {
    const projectId = "painel-0123456789abcdef";
    const id = localFileId(projectId, "site/imagens/ação.png");
    assert.deepEqual(parseLocalFileId(id), { projectId, path: "site/imagens/ação.png" });
    assert.deepEqual(parseLocalFileId(projectId), { projectId, path: "" });
    assert.equal(parseLocalFileId("1AbCdEfGhIjKlMnOpQrStUvWxYz"), null);
    assert.equal(parseLocalFileId(`${projectId}~!!!`), null);
  });
});

/** Um zip mínimo (deflate), montado à mão — o painel não tem biblioteca de zip. */
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("API dos projetos do painel", () => {
  let base;
  let close;
  let projectId;

  before(async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  });
  after(async () => {
    await close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const json = (method, url, body) =>
    fetch(`${base}${url}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const upload = (filePath, content) =>
    fetch(`${base}/api/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: content,
    });

  it("cria o projeto e recusa nome vazio", async () => {
    assert.equal((await json("POST", "/api/projects", { name: "  " })).status, 400);
    const res = await json("POST", "/api/projects", { name: "cliente-novo.com.br" });
    assert.equal(res.status, 201);
    ({ id: projectId } = (await res.json()).project);
    assert.match(projectId, /^painel-[0-9a-f]{16}$/);
  });

  it("guarda arquivos e os lista como a tela espera", async () => {
    assert.equal((await upload("site/index.html", "<h1>oi</h1>")).status, 201);
    assert.equal((await upload("site/css/site.css", "body{}")).status, 201);
    assert.equal((await upload("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]))).status, 201);
    assert.equal((await upload("../fora.txt", "x")).status, 400);

    const { files } = await (await json("GET", `/api/folders/${projectId}/files`)).json();
    assert.deepEqual(files.map((item) => [item.name, item.kind]), [["site", "folder"], ["logo.png", "image"]]);
    const logo = files.find((item) => item.name === "logo.png");
    assert.equal(logo.hasThumbnail, true);
    assert.equal(logo.localPath, "logo.png");

    const pasta = files.find((item) => item.name === "site");
    const dentro = await (await json("GET", `/api/folders/${pasta.id}/files`)).json();
    assert.deepEqual(dentro.files.map((item) => item.name), ["css", "index.html"]);
  });

  it("serve o conteúdo sem deixar HTML rodar na origem do painel, e atende a faixas", async () => {
    const { files } = await (await json("GET", `/api/folders/${projectId}/files`)).json();
    const pasta = files.find((item) => item.name === "site");
    const dentro = (await (await json("GET", `/api/folders/${pasta.id}/files`)).json()).files;
    const index = dentro.find((item) => item.name === "index.html");

    const inteiro = await fetch(`${base}/api/files/${index.id}/raw`);
    assert.equal(inteiro.status, 200);
    assert.match(inteiro.headers.get("content-type"), /^text\/plain/);
    assert.equal(await inteiro.text(), "<h1>oi</h1>");

    const faixa = await fetch(`${base}/api/files/${index.id}/raw`, { headers: { Range: "bytes=1-2" } });
    assert.equal(faixa.status, 206);
    assert.equal(faixa.headers.get("content-range"), "bytes 1-2/11");
    assert.equal(await faixa.text(), "h1");
  });

  it("id local de projeto que não existe é 404, sem ir ao Drive", async () => {
    assert.equal((await json("GET", "/api/folders/painel-ffffffffffffffff/files")).status, 404);
  });

  it("o projeto aceita tag e apelido, mas não a geração pelo Lovable", async () => {
    assert.equal((await json("PUT", `/api/projects/${projectId}/name`, { name: "Cliente novo" })).status, 200);
    assert.equal((await json("PUT", `/api/projects/${projectId}/tags`, { tagIds: [] })).status, 200);
    assert.equal((await json("GET", `/api/projects/${projectId}/build-package`)).status, 409);
  });

  it("acha as origens do site: a pasta e o .zip", async () => {
    const zip = zipOf({
      "meu-site/package.json": "{}",
      "meu-site/src/main.tsx": "export {}",
      "meu-site/.env": "SEGREDO=1",
    });
    assert.equal((await upload("entrega.zip", zip)).status, 201);

    const sources = await findSiteSources(projectId);
    assert.deepEqual(
      sources.map((source) => [source.path, source.type, source.kind, source.fileCount]),
      [["site", "folder", "static", 2], ["entrega.zip", "zip", "build", 2]],
    );

    const doZip = await openSiteSource(projectId, "entrega.zip");
    assert.deepEqual(doZip.files.map((item) => item.path).sort(), ["package.json", "src/main.tsx"]);
    const main = doZip.files.find((item) => item.path === "src/main.tsx");
    assert.equal((await main.read()).toString(), "export {}");
  });

  it("apaga arquivo e, por fim, o projeto com tudo dele", async () => {
    const apagar = await fetch(`${base}/api/projects/${projectId}/files?path=logo.png`, { method: "DELETE" });
    assert.equal(apagar.status, 204);
    const { files } = await (await json("GET", `/api/folders/${projectId}/files`)).json();
    assert.equal(files.some((item) => item.name === "logo.png"), false);

    assert.equal((await json("DELETE", `/api/projects/${projectId}`)).status, 204);
    assert.equal((await json("GET", `/api/folders/${projectId}/files`)).status, 404);
    await assert.rejects(fs.stat(path.join(dataDir, "projetos", projectId)), { code: "ENOENT" });
  });
});

describe("commit do site", () => {
  /** Um GitHub de mentira: guarda blobs, árvores e commits em memória. */
  const state = { blobs: new Map(), trees: new Map(), commits: new Map(), head: "c0", posts: [] };
  let config;
  let close;

  const seedTree = (entries) => {
    const sha = `t${state.trees.size}`;
    state.trees.set(sha, entries);
    return sha;
  };

  before(async () => {
    const workflow = "name: prévia";
    state.blobs.set(blobShaOf(Buffer.from(workflow)), workflow);
    state.blobs.set(blobShaOf(Buffer.from("igual")), "igual");
    state.commits.set("c0", {
      tree: seedTree([
        { path: "README.md", mode: "100644", type: "blob", sha: "readme" },
        { path: "index.html", mode: "100644", type: "blob", sha: blobShaOf(Buffer.from("igual")) },
        { path: ".github/workflows/Area-de-desenvolvimento.yml", mode: "100644", type: "blob", sha: blobShaOf(Buffer.from(workflow)) },
      ]),
    });

    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      const url = req.url ?? "";
      const send = (value, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.method !== "GET") state.posts.push(`${req.method} ${url.replace("/repos/org/site", "")}`);

      if (url.endsWith("/git/ref/heads/main")) return send({ object: { sha: state.head } });
      if (url.includes("/git/commits/")) {
        return send({ tree: { sha: state.commits.get(url.split("/").pop()).tree } });
      }
      if (url.includes("/git/trees/")) {
        const sha = url.split("/").pop().split("?")[0];
        return send({ sha, truncated: false, tree: state.trees.get(sha) });
      }
      if (url.endsWith("/git/blobs")) {
        const bytes = Buffer.from(body.content, "base64");
        const sha = blobShaOf(bytes);
        state.blobs.set(sha, bytes.toString());
        return send({ sha }, 201);
      }
      if (url.endsWith("/git/trees")) {
        // Como o git: a mesma árvore tem o mesmo SHA.
        const chave = JSON.stringify([...body.tree].sort((a, b) => a.path.localeCompare(b.path)));
        const igual = [...state.trees].find(
          ([, entries]) => JSON.stringify([...entries].sort((a, b) => a.path.localeCompare(b.path))) === chave,
        );
        return send({ sha: igual ? igual[0] : seedTree(body.tree) }, 201);
      }
      if (url.endsWith("/git/commits")) {
        const sha = `c${state.commits.size}`;
        state.commits.set(sha, { tree: body.tree, parents: body.parents });
        return send({ sha }, 201);
      }
      if (url.endsWith("/git/refs/heads/main")) {
        state.head = body.sha;
        return send({ object: { sha: body.sha } });
      }
      send({ message: "Not Found" }, 404);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
    config = {
      token: "github_pat_teste",
      baseUrl: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`,
      userAgent: "teste",
    };
    close = () => new Promise((resolve) => server.close(resolve));
  });
  after(() => close());

  const site = (files) =>
    Object.entries(files).map(([filePath, text]) => ({ path: filePath, read: async () => Buffer.from(text) }));

  it("grava só o que mudou, num commit, e mantém os workflows do painel", async () => {
    const result = await commitSite({
      config,
      owner: "org",
      repo: "site",
      branch: "main",
      message: "Site",
      files: site({ "index.html": "igual", "css/site.css": "body{}" }),
    });

    assert.deepEqual({ ...result, sha: undefined }, { sha: undefined, changed: true, uploaded: 1, total: 2 });
    assert.equal(state.head, result.sha);
    const paths = state.trees.get(state.commits.get(result.sha).tree).map((item) => item.path).sort();
    // O README do commit inicial sai; o workflow fica.
    assert.deepEqual(paths, [".github/workflows/Area-de-desenvolvimento.yml", "css/site.css", "index.html"]);
    assert.deepEqual(state.commits.get(result.sha).parents, ["c0"]);
    assert.equal(state.posts.filter((item) => item.endsWith("/git/blobs")).length, 1);
  });

  it("sem mudança, não cria commit", async () => {
    const antes = state.head;
    const result = await commitSite({
      config,
      owner: "org",
      repo: "site",
      branch: "main",
      message: "Site",
      files: site({ "index.html": "igual", "css/site.css": "body{}" }),
    });
    assert.deepEqual(result, { sha: antes, changed: false, uploaded: 0, total: 2 });
    assert.equal(state.head, antes);
  });
});
