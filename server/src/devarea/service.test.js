import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "yaml";
import {
  devAreaStateOf,
  devAreaTarget,
  findRepoForGeneration,
  joinsAutomatically,
  latestDevRun,
  pickDevAreaSlug,
  probeDevArea,
} from "./service.js";
import {
  buildDevAreaWorkflowFile,
  DEV_AREA_TEMPLATE_VERSION,
  readTemplateVersion,
} from "../deploy/workflow-template.js";

const area = { url: "https://aprovacao.exemplo.com.br", ftpDir: "domains/aprovacao.exemplo.com.br/public_html" };

describe("devAreaTarget", () => {
  it("monta a pasta no FTP, a base do build e o endereço do cliente", () => {
    assert.deepEqual(devAreaTarget("zezinho", area), {
      basePath: "/zezinho/",
      serverDir: "domains/aprovacao.exemplo.com.br/public_html/zezinho/",
      url: "https://aprovacao.exemplo.com.br/zezinho/",
    });
  });

  it("aceita uma conta FTP presa ao public_html", () => {
    for (const ftpDir of ["/", ".", "./", ""]) {
      assert.equal(devAreaTarget("zezinho", { ...area, ftpDir }).serverDir, "zezinho/");
    }
  });
});

describe("pickDevAreaSlug", () => {
  it("reaproveita a pasta que o projeto já tem, mesmo que o nome mude", () => {
    const geracoes = { p1: [{ devArea: { slug: "zezinho" } }, { devArea: null }] };
    assert.equal(pickDevAreaSlug("p1", "ze-novo", geracoes), "zezinho");
  });

  it("numera quando outra coleta já usa a pasta", () => {
    const geracoes = {
      outro: [{ devArea: { slug: "zezinho" } }],
      terceiro: [{ devArea: { slug: "zezinho-2" } }],
      p1: [{ devArea: null }],
    };
    assert.equal(pickDevAreaSlug("p1", "zezinho", geracoes), "zezinho-3");
  });
});

describe("findRepoForGeneration", () => {
  const repos = [
    { full_name: "Org/sbc-cobran-as-smart-recovery", name: "sbc-cobran-as-smart-recovery" },
    { full_name: "Org/outro", name: "outro" },
  ];

  it("acha pelo nome que o GitHub dá ao projeto do Lovable", () => {
    const repo = findRepoForGeneration({ lovableName: "SBC Cobranças: Smart Recovery" }, repos);
    assert.equal(repo?.full_name, "Org/sbc-cobran-as-smart-recovery");
  });

  it("prefere o repositório confirmado ao publicar", () => {
    const repo = findRepoForGeneration(
      { repoFullName: "org/outro", lovableName: "SBC Cobranças: Smart Recovery" },
      repos,
    );
    assert.equal(repo?.full_name, "Org/outro");
  });

  it("sem repositório com o nome, não adivinha", () => {
    assert.equal(findRepoForGeneration({ lovableName: "Nada a ver" }, repos), null);
    assert.equal(findRepoForGeneration({ lovableName: null }, repos), null);
  });
});

describe("joinsAutomatically", () => {
  const producao = new Set(["org/no-ar"]);

  it("entra o site novo, sem link e sem publicação no domínio", () => {
    assert.equal(joinsAutomatically({}, "Org/novo", producao), true);
    assert.equal(joinsAutomatically({}, null, producao), true);
  });

  it("fica de fora quem já está com o cliente pelo link curto ou no ar", () => {
    assert.equal(joinsAutomatically({ shortUrl: "https://x/y" }, "Org/novo", producao), false);
    assert.equal(joinsAutomatically({ deliveredAt: "2026-09-01" }, "Org/novo", producao), false);
    assert.equal(joinsAutomatically({}, "Org/No-Ar", producao), false);
  });
});

describe("latestDevRun e devAreaStateOf", () => {
  const run = (created_at, status, conclusion, head_sha = "abc") => ({
    created_at,
    status,
    conclusion,
    head_sha,
    html_url: `https://github.com/run/${created_at}`,
  });

  it("ignora as canceladas pela fila e pega a mais recente", () => {
    const ultima = latestDevRun([
      run("2026-09-24T10:00:00Z", "completed", "success", "a"),
      run("2026-09-24T10:05:00Z", "completed", "cancelled", "b"),
      run("2026-09-24T10:03:00Z", "in_progress", null, "c"),
    ]);
    assert.equal(ultima?.status, "pending");
    assert.equal(ultima?.sha, "c");
  });

  it("só está no ar quando o commit da execução foi conferido na pasta", () => {
    const sucesso = { at: "x", status: /** @type {const} */ ("success"), runUrl: null, sha: "abc" };
    assert.equal(devAreaStateOf(sucesso, "abc"), "live");
    assert.equal(devAreaStateOf(sucesso, "velho"), "publishing");
    assert.equal(devAreaStateOf({ ...sucesso, status: "failure" }, "abc"), "failed");
    assert.equal(devAreaStateOf({ ...sucesso, status: "pending" }, "abc"), "publishing");
    assert.equal(devAreaStateOf(null, null), "publishing");
  });
});

describe("probeDevArea", () => {
  const resposta = (status, corpo) => async () =>
    new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

  it("lê o commit publicado na pasta", async () => {
    const sonda = await probeDevArea("https://a.b/z/", resposta(200, { sha: "abc" }));
    assert.equal(sonda.state, "alive");
    assert.equal(sonda.sha, "abc");
  });

  it("pasta ausente é link morto; erro do servidor não condena", async () => {
    assert.equal((await probeDevArea("https://a.b/z/", resposta(404))).state, "dead");
    assert.equal((await probeDevArea("https://a.b/z/", resposta(503))).state, "unknown");
    const falha = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal((await probeDevArea("https://a.b/z/", falha)).state, "unknown");
  });

  it("fura o cache pedindo o marcador com um parâmetro novo", async () => {
    let pedido = "";
    await probeDevArea("https://a.b/z/", async (url) => {
      pedido = String(url);
      return new Response("{}", { status: 200 });
    });
    assert.match(pedido, /^https:\/\/a\.b\/z\/joinvix-build\.json\?v=\d+$/);
  });
});

describe("workflow da área de desenvolvimento", () => {
  const arquivo = buildDevAreaWorkflowFile({
    branch: "main",
    basePath: "/zezinho/",
    serverDir: "domains/aprovacao.exemplo.com.br/public_html/zezinho/",
    publicUrl: "https://aprovacao.exemplo.com.br/zezinho/",
  });
  const yaml = parse(arquivo.content);

  it("publica a cada push na branch padrão e também sob demanda", () => {
    assert.deepEqual(yaml.on.push.branches, ["main"]);
    assert.ok("workflow_dispatch" in yaml.on);
  });

  it("leva a pasta à base do build e ao envio", () => {
    assert.equal(yaml.jobs.publish.env.BASE_PATH, "/zezinho/");
    const envio = yaml.jobs.publish.steps.find((passo) => passo.id === "upload");
    assert.equal(envio.with["server-dir"], "domains/aprovacao.exemplo.com.br/public_html/zezinho/");
    assert.match(envio.with.password, /secrets\.DEV_AREA_FTP_PASSWORD/);
  });

  it("prepara antes do build e dá o acabamento depois da assinatura", () => {
    const nomes = yaml.jobs.publish.steps.map((passo) => passo.name);
    const antes = nomes.indexOf("Prepare the dev area folder");
    assert.ok(antes >= 0 && antes < nomes.indexOf("Install dependencies and build"));
    assert.ok(nomes.indexOf("Finish the dev area build") > nomes.indexOf("Ensure Joinvix signature"));
  });

  it("marca a versão própria, para o painel regravar o workflow velho", () => {
    assert.equal(readTemplateVersion(arquivo.content), DEV_AREA_TEMPLATE_VERSION);
  });

  it("recusa valor que mudaria o sentido do YAML", () => {
    for (const serverDir of ['pasta"; rm -rf /', "a/../b/", "a b/", "$HOME/"]) {
      assert.throws(
        () =>
          buildDevAreaWorkflowFile({
            branch: "main",
            basePath: "/zezinho/",
            serverDir,
            publicUrl: "https://a.b/zezinho/",
          }),
        /Valor inválido/,
      );
    }
  });
});

describe("failureReasonFromLog", () => {
  it("junta as linhas de erro do log, sem o código de saída", async () => {
    const { failureReasonFromLog } = await import("./service.js");
    const log = [
      "2026-09-24T14:06:42.2460745Z ##[error]Nenhuma pasta de build com index.html foi encontrada.",
      "2026-09-24T14:06:42.2473131Z Conteudo da raiz do projeto:",
      "2026-09-24T14:06:42.2505934Z ##[error]Este projeto e renderizado no servidor.",
      "2026-09-24T14:06:42.2505934Z ##[error]Este projeto e renderizado no servidor.",
      "2026-09-24T14:06:42.2518427Z ##[error]Process completed with exit code 1.",
    ].join("\r\n");
    assert.equal(
      failureReasonFromLog(log),
      "Nenhuma pasta de build com index.html foi encontrada. Este projeto e renderizado no servidor.",
    );
    assert.equal(failureReasonFromLog("sem erro nenhum"), null);
  });
});
