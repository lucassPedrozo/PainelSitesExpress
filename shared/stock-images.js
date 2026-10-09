/**
 * Imagens de banco (Pixabay) que vão junto com a geração do site.
 *
 * API e interface leem daqui: a interface escreve no prompt o nome de cada
 * foto e a API sobe a foto ao Lovable com esse mesmo nome. Se as duas pontas
 * calculassem o nome cada uma do seu jeito, o prompt citaria arquivos que o
 * Lovable não recebeu.
 */

/** "Escritório Moderno!" → "escritorio-moderno". */
export function stockSlug(text) {
  const slug = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "imagem";
}

/**
 * O grupo de uma foto: a seção do site, quando informada, ou o termo buscado.
 * É o equivalente da subpasta por termo do script de busca.
 *
 * @param {{ term: string, section?: string | null }} image
 */
export const stockGroupOf = (image) => (image.section ?? "").trim() || image.term.trim();

/** O anexo único que leva todas as fotos de banco ao Lovable. */
export const STOCK_ZIP_NAME = "imagens-pixabay.zip";

/**
 * Nome da foto: `pixabay-<grupo>-<id>.jpg`.
 *
 * @param {{ id: number, term: string, section?: string | null }} image
 */
export const stockImageName = (image) =>
  `pixabay-${stockSlug(stockGroupOf(image))}-${image.id}.jpg`;

/**
 * Onde a foto fica dentro do zip: uma pasta por grupo, como as subpastas por
 * termo do script de busca (`hero/pixabay-hero-123.jpg`).
 *
 * @param {{ id: number, term: string, section?: string | null }} image
 */
export const stockZipPath = (image) =>
  `${stockSlug(stockGroupOf(image))}/${stockImageName(image)}`;

/**
 * O bloco do prompt que diz ao Lovable o que há no zip e onde usar cada foto.
 * Vazio quando não há foto de banco no envio.
 *
 * @param {Array<{ id: number, term: string, section?: string | null }>} images
 */
export function stockImagesBlock(images) {
  if (!images?.length) return "";

  /** @type {Map<string, { term: string, section: string, paths: string[] }>} */
  const grupos = new Map();
  for (const image of images) {
    const section = (image.section ?? "").trim();
    const chave = `${section}\u0000${image.term.trim()}`;
    const grupo = grupos.get(chave) ?? { term: image.term.trim(), section, paths: [] };
    grupo.paths.push(stockZipPath(image));
    grupos.set(chave, grupo);
  }

  const linhas = [...grupos.values()].map(({ term, section, paths }) =>
    section
      ? `- Seção “${section}” (busca: “${term}”): ${paths.join(", ")}`
      : `- Fotos de “${term}”: ${paths.join(", ")}`,
  );

  return [
    "## Imagens de banco (Pixabay)",
    `O anexo “${STOCK_ZIP_NAME}” traz ${images.length} ${images.length === 1 ? "foto" : "fotos"} de banco ` +
      "de imagens (licença Pixabay: uso comercial livre, sem atribuição), numa pasta por " +
      "seção do site. Extraia o zip e copie as fotos para os assets do projeto. Elas " +
      "completam o material do cliente: quando houver foto do próprio cliente para o " +
      "mesmo lugar, prefira a do cliente. Use cada grupo na seção indicada.",
    ...linhas,
  ].join("\n");
}
