import sodium from "libsodium-wrappers";
// O cliente HTTP é o de github/client.js: mesmo timeout, mesma tradução de erro e as
// mesmas novas tentativas em leitura. Antes este módulo tinha uma cópia própria
// sem as novas tentativas — uma falha passageira ao ler a chave pública dos
// secrets derrubava a configuração inteira.
import {
  getGitHubBaseUrl,
  GitHubRequestError,
  requestJson,
  requestNoContent,
} from "./github/client.js";
import { createOrUpdateFile } from "./github/contents.js";

const defaultWorkflowBranch = "main";
const defaultWorkflowMessage = "Adicionar workflow de publicacao";

const isConflictError = (error) =>
  error instanceof GitHubRequestError && error.status === 409;

const getRepositoryPublicKey = (params) =>
  requestJson(
    `${getGitHubBaseUrl(params.config)}/repos/${params.owner}/${params.repo}/actions/secrets/public-key`,
    params.config,
    { method: "GET" },
  );

const encryptSecret = async (value, publicKey) => {
  // GitHub Actions secrets usam sealed box do libsodium.
  await sodium.ready;
  const messageBytes = new TextEncoder().encode(value);
  const keyBytes = sodium.from_base64(
    publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
};

const secretUrl = (config, owner, repo, name) =>
  `${getGitHubBaseUrl(config)}/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`;

const setRepositorySecret = async (params) => {
  const encryptedValue = await encryptSecret(
    params.value,
    params.publicKey.key,
  );

  await requestNoContent(
    secretUrl(params.config, params.owner, params.repo, params.name),
    params.config,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encrypted_value: encryptedValue,
        key_id: params.publicKey.key_id,
      }),
    },
  );
};

const deleteRepositorySecret = async (params) => {
  try {
    await requestNoContent(
      secretUrl(params.config, params.owner, params.repo, params.name),
      params.config,
      { method: "DELETE" },
    );
  } catch (error) {
    // Remover um secret inexistente é o estado desejado, não uma falha.
    if (error instanceof GitHubRequestError && error.status === 404) return;
    throw error;
  }
};

/**
 * `value: null` remove o secret do repositório em vez de gravá-lo;
 * `value: undefined` não toca nele — o valor atual continua valendo.
 */
export const configurePublication = async (params) => {
  const workflowBranch = params.workflowBranch ?? defaultWorkflowBranch;
  const workflows = params.workflows;

  if (!workflows || workflows.length === 0) {
    throw new Error("Nenhum workflow fornecido para publicação.");
  }

  const secretsToSet = params.secrets.filter(
    (secret) =>
      typeof secret.value === "string" && secret.value.trim().length > 0,
  );
  const secretsToRemove = params.secrets.filter(
    (secret) => secret.value === null,
  );

  if (secretsToSet.length > 0) {
    const publicKey = await getRepositoryPublicKey({
      config: params.config,
      owner: params.owner,
      repo: params.repo,
    });

    await Promise.all(
      secretsToSet.map((secret) =>
        setRepositorySecret({
          config: params.config,
          owner: params.owner,
          repo: params.repo,
          name: secret.name,
          value: secret.value,
          publicKey,
        }),
      ),
    );
  }

  await Promise.all(
    secretsToRemove.map((secret) =>
      deleteRepositorySecret({
        config: params.config,
        owner: params.owner,
        repo: params.repo,
        name: secret.name,
      }),
    ),
  );

  const workflowStatuses = [];

  const createOrUpdateWorkflow = async (workflow) => {
    const write = () =>
      createOrUpdateFile({
        config: params.config,
        owner: params.owner,
        repo: params.repo,
        path: workflow.path,
        content: workflow.content,
        message: workflow.message ?? defaultWorkflowMessage,
        branch: workflowBranch,
      });

    try {
      return await write();
    } catch (error) {
      // Dois workflows gravados em sequência disputam o mesmo HEAD; o 409
      // significa apenas que o SHA envelheceu entre a leitura e a escrita.
      if (!isConflictError(error)) throw error;
      return write();
    }
  };

  for (const workflow of workflows) {
    workflowStatuses.push(await createOrUpdateWorkflow(workflow));
  }

  return {
    workflowPaths: workflows.map((workflow) => workflow.path),
    workflowBranch,
    secretNames: secretsToSet.map((secret) => secret.name),
    workflowStatuses,
  };
};
