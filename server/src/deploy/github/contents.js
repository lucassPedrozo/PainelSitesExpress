import { createHash } from "node:crypto";
import {
  getGitHubBaseUrl,
  getJson,
  GitHubRequestError,
  requestJson,
} from "./client.js";

/* Arquivos de workflow em .github/workflows: leitura, gravação e remoção. */

const toBase64 = (content) => Buffer.from(content, "utf8").toString("base64");

const assertValidWorkflowPath = (filePath) => {
  if (filePath.startsWith("main/")) {
    throw new Error(
      'Caminho inválido: não inclua "main/". Use apenas .github/workflows/arquivo.yml.',
    );
  }

  if (!filePath.startsWith(".github/workflows/")) {
    throw new Error(
      "Caminho inválido: o workflow deve ficar em .github/workflows/.",
    );
  }
};

const withRef = (url, branch) =>
  branch ? `${url}?${new URLSearchParams({ ref: branch }).toString()}` : url;

const getFileSha = async (params) => {
  assertValidWorkflowPath(params.path);
  const url = withRef(
    `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    params.branch,
  );

  try {
    const response = await getJson(url, params.config);
    return response.sha;
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return null;
    throw error;
  }
};

/** O SHA que o git daria ao conteúdo — o mesmo que a API devolve por arquivo. */
export const gitBlobSha = (content) => {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
};

/**
 * Grava o arquivo, ou devolve `unchanged` sem gravar quando o conteúdo é o
 * mesmo: um commit idêntico só dispararia os workflows de push à toa.
 */
export const createOrUpdateFile = async (params) => {
  assertValidWorkflowPath(params.path);
  const sha = await getFileSha(params);
  if (sha && sha === gitBlobSha(params.content)) {
    return { path: params.path, action: "unchanged" };
  }
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`;
  const payload = {
    message: params.message,
    content: toBase64(params.content),
  };

  if (params.branch) payload.branch = params.branch;
  if (sha) payload.sha = sha;

  await requestJson(url, params.config, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return { path: params.path, action: sha ? "updated" : "created" };
};

export const deleteFile = async (params) => {
  assertValidWorkflowPath(params.path);
  const url = `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`;
  const payload = { message: params.message, sha: params.sha };
  if (params.branch) payload.branch = params.branch;

  return requestJson(url, params.config, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

const isWorkflowFile = (name) => {
  const lower = name.toLowerCase();
  return lower.endsWith(".yml") || lower.endsWith(".yaml");
};

export const listWorkflowFiles = async (config, params) => {
  const url = withRef(
    `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/contents/.github/workflows`,
    params.branch,
  );

  try {
    const response = await getJson(url, config);

    if (!Array.isArray(response)) {
      if (response.type === "file" && isWorkflowFile(response.name)) {
        return [
          {
            name: response.name,
            path: response.path,
            sha: response.sha,
            size: response.size ?? 0,
          },
        ];
      }
      return [];
    }

    return response
      .filter((item) => item.type === "file" && isWorkflowFile(item.name))
      .map((item) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        size: item.size ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return [];
    throw error;
  }
};

export const getWorkflowFileContent = async (config, params) => {
  assertValidWorkflowPath(params.path);
  const url = withRef(
    `${getGitHubBaseUrl(config)}/repos/${params.owner}/${params.repo}/contents/${params.path}`,
    params.branch,
  );
  const response = await getJson(url, config);

  if (response.encoding !== "base64") {
    throw new Error("Formato de conteúdo do workflow não suportado.");
  }

  return Buffer.from(response.content.replace(/\s/g, ""), "base64").toString(
    "utf8",
  );
};
