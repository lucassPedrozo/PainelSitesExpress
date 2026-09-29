import { Router } from "express";
import { requirePermission } from "../security/permissions.js";
import {
  createTag,
  deleteTag,
  getFinishedTagId,
  listTags,
  TAG_COLORS,
  updateTag,
} from "../store/tags.js";

/**
 * Tags — estado do painel, guardado no banco local (o Drive é acessado apenas
 * para leitura). A atribuição de tags a um projeto mora no router de projetos.
 */
export const tagsRouter = Router();

tagsRouter.get("/tags", async (_req, res) => {
  res.json({
    tags: await listTags(),
    colors: TAG_COLORS,
    finishedTagId: await getFinishedTagId(),
  });
});

tagsRouter.post("/tags", requirePermission("organizar"), async (req, res) => {
  const tag = await createTag(req.body ?? {});
  res.status(201).json({ tag });
});

tagsRouter.patch("/tags/:id", requirePermission("organizar"), async (req, res) => {
  const tag = await updateTag(req.params.id, req.body ?? {});
  res.json({ tag });
});

tagsRouter.delete("/tags/:id", requirePermission("organizar"), async (req, res) => {
  await deleteTag(req.params.id);
  res.status(204).end();
});
