/**
 * O site do domínio que está em outra coleta. O cliente às vezes preenche o
 * formulário de novo, e cada envio vira uma pasta: o site fica registrado na
 * pasta em que foi gerado, e a outra continuava pedindo "Gerar" — como se o
 * domínio não tivesse site. Para cada pasta **sem** site, devolve o mais
 * recente das outras pastas do mesmo domínio (`null` quando não há).
 *
 * @param {{ id: string, name: string }[]} folders
 * @param {(string | null)[]} domains o domínio de cada pasta, na mesma ordem
 * @param {Record<string, any[]>} generations
 */
export function siteOfOtherCollections(folders, domains, generations) {
  /** @type {Map<string, { projectId: string, projectName: string, site: any }>} */
  const maisRecente = new Map();
  for (const [index, folder] of folders.entries()) {
    const domain = domains[index];
    const site = (generations[folder.id] ?? []).at(-1);
    if (!domain || !site) continue;
    const atual = maisRecente.get(domain);
    if (!atual || String(site.createdAt ?? "") > String(atual.site.createdAt ?? "")) {
      maisRecente.set(domain, { projectId: folder.id, projectName: folder.name, site });
    }
  }
  return folders.map((folder, index) => {
    const domain = domains[index];
    if (!domain || (generations[folder.id] ?? []).length) return null;
    return maisRecente.get(domain) ?? null;
  });
}
