import { randomUUID } from "node:crypto";
import { httpError } from "../http.js";
import { flush, normalize, read } from "./db.js";

/** Cores disponíveis para as tags — o front tem a classe CSS de cada uma. */
export const TAG_COLORS = [
  "slate",
  "blue",
  "cyan",
  "emerald",
  "amber",
  "orange",
  "red",
  "violet",
  "pink",
];

/** Id da etiqueta que esconde o projeto do painel — `null` se foi excluída. */
export async function getFinishedTagId() {
  const { finishedTagId } = await read();
  return finishedTagId;
}

export async function listTags() {
  const { tags, projectTags } = await read();
  const usage = new Map();
  for (const ids of Object.values(projectTags)) {
    for (const id of ids) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return tags.map((tag) => ({ ...tag, projectCount: usage.get(tag.id) ?? 0 }));
}

/** Projeto -> tags. Projeto sem tag nenhuma não aparece. */
export async function listProjectTags() {
  const { projectTags } = await read();
  return projectTags;
}

export async function createTag({ name, color }) {
  const data = await read();
  const label = String(name ?? "").trim();

  if (!label) throw httpError(400, "Informe o nome da tag");
  if (label.length > 40) throw httpError(400, "Nome muito longo (máx. 40)");
  if (data.tags.some((tag) => normalize(tag.name) === normalize(label)))
    throw httpError(409, `Já existe uma tag chamada "${label}"`);

  const tag = {
    id: randomUUID(),
    name: label,
    color: TAG_COLORS.includes(color) ? color : "slate",
    createdAt: new Date().toISOString(),
  };

  data.tags.push(tag);
  await flush();
  return { ...tag, projectCount: 0 };
}

export async function updateTag(id, { name, color }) {
  const data = await read();
  const tag = data.tags.find((item) => item.id === id);
  if (!tag) throw httpError(404, "Tag não encontrada");

  if (name !== undefined) {
    const label = String(name).trim();
    if (!label) throw httpError(400, "Informe o nome da tag");
    if (
      data.tags.some(
        (item) => item.id !== id && normalize(item.name) === normalize(label),
      )
    )
      throw httpError(409, `Já existe uma tag chamada "${label}"`);
    tag.name = label;
  }

  if (color !== undefined && TAG_COLORS.includes(color)) tag.color = color;

  await flush();
  return tag;
}

export async function deleteTag(id) {
  const data = await read();
  const index = data.tags.findIndex((tag) => tag.id === id);
  if (index === -1) throw httpError(404, "Tag não encontrada");

  data.tags.splice(index, 1);
  for (const [projectId, ids] of Object.entries(data.projectTags)) {
    data.projectTags[projectId] = ids.filter((tagId) => tagId !== id);
  }
  if (data.finishedTagId === id) data.finishedTagId = null;

  await flush();
}

/** Substitui as tags de um projeto pelo conjunto informado. */
export async function setProjectTags(projectId, tagIds) {
  const data = await read();
  const known = new Set(data.tags.map((tag) => tag.id));
  const unknown = tagIds.filter((id) => !known.has(id));
  if (unknown.length) throw httpError(400, "Tag inexistente na seleção");

  const unique = [...new Set(tagIds)];
  if (unique.length) data.projectTags[projectId] = unique;
  else delete data.projectTags[projectId];

  await flush();
  return unique;
}
