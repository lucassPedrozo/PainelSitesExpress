import type { TagColor } from "@shared/tag-colors.js";
import { get, send } from "./http";

export type { TagColor };

export type Tag = {
  id: string;
  name: string;
  color: TagColor;
  createdAt: string;
  projectCount: number;
};

export const fetchTags = () =>
  get<{
    tags: Tag[];
    colors: TagColor[];
    finishedTagId: string | null;
  }>("/api/tags");

export const createTag = (name: string, color: TagColor) =>
  send<{ tag: Tag }>("POST", "/api/tags", { name, color });

export const updateTag = (
  id: string,
  changes: { name?: string; color?: TagColor },
) => send<{ tag: Tag }>("PATCH", `/api/tags/${id}`, changes);

export const deleteTag = (id: string) =>
  send<void>("DELETE", `/api/tags/${id}`);
