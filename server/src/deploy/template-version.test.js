import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildDevAreaWorkflowFile,
  buildWorkflowFiles,
  DEV_AREA_TEMPLATE_VERSION,
  WORKFLOW_TEMPLATE_VERSION,
} from "./workflow-template.js";

/**
 * O painel só regrava o workflow de um repositório quando a versão do template
 * muda. Mexer num workflow ou num script dele sem subir a versão deixa os
 * sites que já existem com o conteúdo antigo, sem aviso — foi assim que a
 * faixa da assinatura Joinvix continuou branca num site já publicado.
 *
 * Este teste prende o conteúdo à versão: mudou o conteúdo, suba
 * WORKFLOW_TEMPLATE_VERSION e DEV_AREA_TEMPLATE_VERSION (e o marcador dos
 * .yml) e grave aqui o par novo.
 */
const GRAVADO = { versao: "12/6", conteudo: "a93cb6feca9dd92a" };

const conteudoAtual = () => {
  const arquivos = [
    ...buildWorkflowFiles({ branch: "main", autoDeploy: false }),
    buildDevAreaWorkflowFile({ branch: "main", basePath: "/x/", serverDir: "/x/", publicUrl: "https://exemplo.test/x/" }),
  ];
  const texto = arquivos
    .map((arquivo) => arquivo.content.replace(/\r\n/g, "\n").replace(/^# joinvix-deploy-template: .*$/m, ""))
    .join("\n---\n");
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
};

test("conteúdo dos workflows mudou: a versão do template sobe junto", () => {
  const versao = `${WORKFLOW_TEMPLATE_VERSION}/${DEV_AREA_TEMPLATE_VERSION}`;
  assert.deepEqual(
    { versao, conteudo: conteudoAtual() },
    GRAVADO,
    "Os workflows mudaram. Suba as duas versões do template e atualize GRAVADO neste teste.",
  );
});
