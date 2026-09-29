import { assertInsideDriveRoot } from "../drive.js";

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
