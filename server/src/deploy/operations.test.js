import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitHubRequestError } from "./github/client.js";
import { refreshOutdatedWorkflows } from "./operations.js";
import { readAutoDeploy } from "./workflow-render.js";
import { readTemplateVersion, WORKFLOW_TEMPLATE_VERSION } from "./workflow-template.js";

const DEPLOY = ".github/workflows/Deploy-via-FTP.yml";
const BUILD = ".github/workflows/Build.yml";
const params = { owner: "Org", repo: "site", branch: "main" };

const velho = (autoDeploy) =>
  `# joinvix-deploy-template: 9\nname: Deploy via FTP\non:\n  workflow_dispatch:\n${autoDeploy ? "  push:\n    branches:\n      - main\n" : ""}`;

const repositorio = (arquivos) => {
  const gravados = [];
  return {
    gravados,
    deps: {
      read: async (path) => {
        if (path in arquivos) return arquivos[path];
        throw new GitHubRequestError("Não encontrado", 404);
      },
      write: async (file) => {
        gravados.push(file);
        return { path: file.path, action: "updated" };
      },
    },
  };
};

describe("refreshOutdatedWorkflows", () => {
  it("regrava o deploy antes do build, mantendo o gatilho automático", async () => {
    const { gravados, deps } = repositorio({ [DEPLOY]: velho(true), [BUILD]: "# joinvix-deploy-template: 9\n" });
    const regravados = await refreshOutdatedWorkflows(params, deps);
    assert.deepEqual(regravados, [DEPLOY, BUILD]);
    assert.equal(readTemplateVersion(gravados[0].content), WORKFLOW_TEMPLATE_VERSION);
    assert.equal(readAutoDeploy(gravados[0].content), true);
  });

  it("não liga o gatilho automático de quem não tinha, nem recria o build removido", async () => {
    const { gravados, deps } = repositorio({ [DEPLOY]: velho(false) });
    assert.deepEqual(await refreshOutdatedWorkflows(params, deps), [DEPLOY]);
    assert.equal(readAutoDeploy(gravados[0].content), false);
  });

  it("não mexe no que já está na versão atual, sem marcador do painel ou sem deploy", async () => {
    for (const arquivos of [
      { [DEPLOY]: `# joinvix-deploy-template: ${WORKFLOW_TEMPLATE_VERSION}\n` },
      { [DEPLOY]: "name: feito a mao\n" },
      {},
    ]) {
      const { gravados, deps } = repositorio(arquivos);
      assert.deepEqual(await refreshOutdatedWorkflows(params, deps), []);
      assert.equal(gravados.length, 0);
    }
  });
});
