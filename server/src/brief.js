import { cached, invalidate } from "./cache.js";
import { pickBrief } from "./brief-file.js";
import { extractDocumentText, listFolderChildren } from "./drive.js";

/** Extrair texto de PDF é caro; o briefing muda pouco. */
const BRIEF_TTL_MS = 10 * 60_000;

/**
 * Texto do arquivo "Informações do Site" — o prompt que vai para o Lovable.
 * Procurado no primeiro nível da pasta, o mesmo alcance da detecção que acende
 * o botão nos cards.
 */
export function loadBrief(projectId, { refresh = false } = {}) {
  if (refresh) invalidate(`brief:${projectId}`);

  return cached(
    `brief:${projectId}`,
    async () => {
      const { file, count } = pickBrief(await listFolderChildren(projectId));
      if (!file) return { found: false };

      const text = await extractDocumentText(file.id, file.mimeType);
      return {
        found: true,
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
        },
        /** Outros briefings na pasta, além deste — a tela avisa. */
        others: count - 1,
        text: text.trim(),
      };
    },
    BRIEF_TTL_MS,
  );
}
