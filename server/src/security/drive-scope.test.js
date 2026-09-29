import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDescendantOf, isValidDriveId } from "./drive-scope.js";

const ROOT = "raiz-das-coletas-0001";

/** Árvore de mentira: id → pais. */
const parentsFrom = (tree) => {
  const calls = [];
  const getParents = async (id) => {
    calls.push(id);
    if (!(id in tree)) {
      throw Object.assign(new Error("File not found"), { code: 404 });
    }
    return tree[id];
  };
  return { getParents, calls };
};

describe("isValidDriveId", () => {
  it("aceita ids reais do Drive", () => {
    assert.equal(isValidDriveId("1a2B3c4D5e6F7g8H9i0J_kLm-NoP"), true);
  });

  it("recusa o que poderia alterar a consulta ao Drive", () => {
    assert.equal(isValidDriveId("abc' in parents or name contains '"), false);
    assert.equal(isValidDriveId("../../etc"), false);
    assert.equal(isValidDriveId("curto"), false);
    assert.equal(isValidDriveId(undefined), false);
  });
});

describe("isDescendantOf", () => {
  const tree = {
    "projeto-cliente-a": [ROOT],
    "subpasta-logos-000": ["projeto-cliente-a"],
    "imagem-logo-00001": ["subpasta-logos-000"],
    "outra-pasta-000001": ["drive-da-empresa-01"],
    "contrato-secreto-01": ["outra-pasta-000001"],
    "drive-da-empresa-01": [],
    "atalho-com-dois-pais": ["outra-pasta-000001", "projeto-cliente-a"],
    "ciclo-a-0000000001": ["ciclo-b-0000000001"],
    "ciclo-b-0000000001": ["ciclo-a-0000000001"],
  };

  it("aceita arquivo dentro de um projeto, em qualquer nível", async () => {
    const { getParents } = parentsFrom(tree);
    assert.equal(await isDescendantOf("imagem-logo-00001", ROOT, getParents), true);
    assert.equal(await isDescendantOf("projeto-cliente-a", ROOT, getParents), true);
    assert.equal(await isDescendantOf(ROOT, ROOT, getParents), true);
  });

  it("recusa arquivo que a service account vê, mas fica fora da raiz", async () => {
    const { getParents } = parentsFrom(tree);
    assert.equal(await isDescendantOf("contrato-secreto-01", ROOT, getParents), false);
  });

  it("basta um dos pais estar dentro da raiz", async () => {
    const { getParents } = parentsFrom(tree);
    assert.equal(await isDescendantOf("atalho-com-dois-pais", ROOT, getParents), true);
  });

  it("não entra em laço com pais circulares", async () => {
    const { getParents, calls } = parentsFrom(tree);
    assert.equal(await isDescendantOf("ciclo-a-0000000001", ROOT, getParents), false);
    assert.ok(calls.length <= 2, `consultou ${calls.length} vezes`);
  });

  it("id malformado nem chega ao Drive", async () => {
    const { getParents, calls } = parentsFrom(tree);
    assert.equal(await isDescendantOf("x' or '1'='1", ROOT, getParents), false);
    assert.equal(calls.length, 0);
  });
});
