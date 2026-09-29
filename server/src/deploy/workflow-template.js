import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readTemplateVersion,
  renderWorkflow,
  WORKFLOW_TEMPLATE_VERSION,
} from "./workflow-render.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(here, "..", "..", "workflows");

const read = (...segments) =>
  readFileSync(path.join(templatesDir, ...segments), "utf8");

// Lidos uma vez: os templates só mudam quando o painel é atualizado.
const buildWorkflowTemplate = read("build.yml");
const deployWorkflowTemplate = read("deploy-via-ftp.yml");
const devAreaWorkflowTemplate = read("dev-area-via-ftp.yml");

export const workflowScripts = {
  __DETECT_PACKAGE_MANAGER__: read("scripts", "detect-package-manager.sh"),
  __INSTALL_AND_BUILD__: read("scripts", "install-and-build.sh"),
  __RESOLVE_BUILD_OUTPUT__: read("scripts", "resolve-build-output.sh"),
  __ENSURE_JOINVIX_SIGNATURE__: read("scripts", "ensure-joinvix-signature.sh"),
  __SELECT_FTP_PROTOCOL__: read("scripts", "select-ftp-protocol.sh"),
  __ENSURE_STATIC_BUILD__: read("scripts", "ensure-static-build.sh"),
  __PREPARE_DEV_AREA__: read("scripts", "prepare-dev-area.sh"),
  __FINALIZE_DEV_AREA__: read("scripts", "finalize-dev-area.sh"),
};

export const DEPLOY_WORKFLOW_FILE = "Deploy-via-FTP.yml";
export const BUILD_WORKFLOW_FILE = "Build.yml";
export const DEV_AREA_WORKFLOW_FILE = "Area-de-desenvolvimento.yml";

/**
 * Versão do workflow da área de desenvolvimento, separada da do deploy: o
 * painel regrava sozinho o workflow de área velho, sem ninguém pedir.
 */
export const DEV_AREA_TEMPLATE_VERSION = "3";

export const buildWorkflowFiles = (options) => [
  {
    path: `.github/workflows/${BUILD_WORKFLOW_FILE}`,
    // O workflow de build roda a cada push por definição; o gatilho automático
    // de publicação é decidido apenas no workflow de deploy.
    content: renderWorkflow(buildWorkflowTemplate, workflowScripts, {
      ...options,
      autoDeploy: false,
    }),
    message: "Adicionar workflow de build",
  },
  {
    path: `.github/workflows/${DEPLOY_WORKFLOW_FILE}`,
    content: renderWorkflow(deployWorkflowTemplate, workflowScripts, options),
    message: "Adicionar workflow de deploy via FTP",
  },
];

/**
 * O workflow que publica o site na pasta dele na área de desenvolvimento, a
 * cada push.
 *
 * @param {{ branch: string, basePath: string, serverDir: string, publicUrl: string }} options
 */
export const buildDevAreaWorkflowFile = ({ branch, basePath, serverDir, publicUrl }) => ({
  path: `.github/workflows/${DEV_AREA_WORKFLOW_FILE}`,
  content: renderWorkflow(devAreaWorkflowTemplate, workflowScripts, {
    branch,
    values: {
      __DEV_AREA_TEMPLATE_VERSION__: DEV_AREA_TEMPLATE_VERSION,
      __DEV_BASE_PATH__: basePath,
      __DEV_SERVER_DIR__: serverDir,
      __DEV_PUBLIC_URL__: publicUrl,
    },
  }),
  message: "Publicar na area de desenvolvimento",
});

export { readTemplateVersion, renderWorkflow, WORKFLOW_TEMPLATE_VERSION };
