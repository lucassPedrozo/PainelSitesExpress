import { assertInsideDriveRoot } from "../drive.js";
import { getLocalProject } from "../store/local-projects.js";

/**
 * `:id` de projeto, pasta ou arquivo precisa ser um id válido do Drive e estar
 * dentro da pasta raiz das coletas. Aplicado rota a rota, e não com
 * `app.param`, porque `:id` também nomeia tags e chaves de acesso.
 * @param {import("express").Request} req
 * @param {import("express").Response} _res
 * @param {import("express").NextFunction} next
 */
export const driveScoped = async (req, _res, next) => {
  await assertInsideDriveRoot(String(req.params.id));
  next();
};

/**
 * Um id de projeto: uma pasta do Drive dentro da raiz, ou um projeto criado no
 * painel. É o que vale para o que o painel guarda por projeto — tags, apelido,
 * sites —, que não depende de onde os arquivos moram.
 * @param {string} id
 */
export const assertProjectId = async (id) => {
  if (await getLocalProject(id)) return;
  await assertInsideDriveRoot(id);
};

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} _res
 * @param {import("express").NextFunction} next
 */
export const projectScoped = async (req, _res, next) => {
  await assertProjectId(String(req.params.id));
  next();
};
