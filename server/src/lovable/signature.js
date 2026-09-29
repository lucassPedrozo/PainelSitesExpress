import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { writeFileAtomic } from "../atomic-write.js";

/**
 * A assinatura Joinvix do rodapé, anexada a toda geração.
 *
 * A Workspace Knowledge (§8) só aplica a assinatura quando as imagens chegam
 * com a mensagem. Antes elas eram enviadas à mão depois de cada site
 * ("Adicione o rodapé da joinvix") — uma mensagem e um crédito a mais.
 *
 * A fonte é o repositório `joinvix-footer`, o mesmo do plugin de WordPress:
 * trocar a logo lá vale para os sites novos sem mexer no painel. A cópia em
 * `server/data/assinatura/` segura a geração quando o GitHub não responde.
 */

const DEFAULT_ASSETS_URL =
  "https://raw.githubusercontent.com/Sites-profissionais/joinvix-footer/main/joinvix-footer-main/assets";

/** A logo muda raramente; conferir o GitHub a cada geração seria desperdício. */
const REFRESH_MS = 6 * 60 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * Qual arquivo do repositório serve para qual fundo. No `joinvix-footer`,
 * `logo-dark` tem o texto escuro (vai em fundo claro) e `logo-light`, o texto
 * branco (vai em fundo escuro). O nome do anexo diz isso ao agente, que
 * escolhe pela cor real do rodapé.
 */
export const SIGNATURE_VARIANTS = [
  {
    variant: "Claro",
    source: "logo-dark.png",
    name: "Rodapé Claro - para rodapé de fundo claro.png",
  },
  {
    variant: "Escuro",
    source: "logo-light.png",
    name: "Rodapé Escuro - para rodapé de fundo escuro.png",
  },
];

const isFresh = async (file) => {
  try {
    const { mtimeMs } = await fs.stat(file);
    return Date.now() - mtimeMs < REFRESH_MS;
  } catch {
    return false;
  }
};

const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

async function download(url, target, fetchImpl) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error(`arquivo vazio em ${url}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, bytes);
}

/**
 * As imagens da assinatura prontas para anexar, uma por variante. Baixa do
 * repositório quando a cópia local falta ou está velha; sem rede, fica com a
 * cópia. Variante que não existe em lugar nenhum simplesmente não vem — a
 * tela avisa.
 *
 * @param {{ cacheDir?: string, assetsUrl?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Array<{ variant: string, path: string, name: string, contentType: string }>>}
 */
export async function listSignatureFiles({
  cacheDir = path.join(config.dataDir, "assinatura"),
  assetsUrl = process.env.JOINVIX_FOOTER_ASSETS_URL || DEFAULT_ASSETS_URL,
  fetchImpl = fetch,
} = {}) {
  const files = [];

  for (const { variant, source, name } of SIGNATURE_VARIANTS) {
    const local = path.join(cacheDir, source);

    if (!(await isFresh(local))) {
      try {
        await download(`${assetsUrl}/${source}`, local, fetchImpl);
      } catch (err) {
        console.warn(
          `[assinatura] não baixou ${source}: ${err?.message ?? err}. Usando a cópia local, se houver.`,
        );
      }
    }

    if (await exists(local)) {
      files.push({ variant, path: local, name, contentType: "image/png" });
    }
  }

  return files;
}
