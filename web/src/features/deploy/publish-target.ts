import type { Project } from "@/lib/api";
import type { Publication, RepoOption } from "@/lib/api/deploy";
import { projectIdentity } from "@/lib/format";
import { normalizeDomain } from "@shared/domain.js";
import { repoNameOf } from "@shared/lovable-repo.js";

/**
 * O que a coleta do Drive já sabe dizer sobre a publicação: o domínio vem do
 * nome da pasta e os candidatos a repositório vêm do site gerado no Lovable.
 */
export type PublishTarget = {
  projectId: string;
  projectLabel: string;
  domain: string;
  repoHints: string[];
  /** Repositório já confirmado para este site — aí não há o que adivinhar. */
  boundRepo: string | null;
  /**
   * Nomes que o "Connect GitHub" do Lovable daria ao repositório, a partir do
   * nome de cada projeto gerado — o mais recente primeiro.
   */
  lovableRepoNames: string[];
};

/** O nome do repositório que o Lovable cria — a regra mora em `shared/`. */
export { repoNameOf };

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `https://preview--meu-site.lovable.app` → `meu-site`. */
const slugFromLovableUrl = (url: string | null) => {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const [subdomain] = host.split(".");
    return subdomain.replace(/^preview--/, "") || null;
  } catch {
    return null;
  }
};

export function publishTargetOf(project: Project): PublishTarget {
  const { label, domain } = projectIdentity(project);
  const cleanDomain = (domain ?? "").replace(/^www\./, "");

  const hints = new Set<string>();
  if (cleanDomain) hints.add(slugify(cleanDomain.split(".")[0]));
  for (const generation of project.generations) {
    const fromUrl =
      slugFromLovableUrl(generation.previewUrl) ??
      slugFromLovableUrl(generation.url);
    if (fromUrl) hints.add(fromUrl);
    if (generation.displayName) hints.add(slugify(generation.displayName));
  }

  const recentes = [...project.generations].reverse();
  return {
    projectId: project.id,
    projectLabel: label,
    domain: cleanDomain,
    repoHints: [...hints].filter(Boolean),
    boundRepo: recentes.find((generation) => generation.repoFullName)?.repoFullName ?? null,
    lovableRepoNames: recentes
      .map((generation) => (generation.lovableName ? repoNameOf(generation.lovableName) : ""))
      .filter(Boolean),
  };
}

/**
 * Melhor esforço: o Lovable nomeia o projeto sozinho, então o repositório nem
 * sempre casa com a coleta. Quando não casa, o painel só deixa a lista aberta
 * em vez de escolher errado.
 */
export function matchRepository(
  repos: RepoOption[],
  target: PublishTarget,
): RepoOption | undefined {
  const hints = target.repoHints;
  if (hints.length === 0) return undefined;

  const bySlug = new Map(repos.map((repo) => [slugify(repo.name), repo]));

  for (const hint of hints) {
    const exact = bySlug.get(hint);
    if (exact) return exact;
  }

  return repos.find((repo) => {
    const slug = slugify(repo.name);
    return hints.some(
      (hint) => hint.length >= 4 && (slug.includes(hint) || hint.includes(slug)),
    );
  });
}

export type RepositorySuggestion = {
  repo: RepoOption;
  /**
   * De onde veio: confirmado antes, publicou o domínio, mesmo nome do projeto
   * no Lovable, ou palpite pelo nome da coleta — só este pede conferência.
   */
  reason: "bound" | "published" | "lovable-name" | "guess";
};

/** O repositório de um nome, aceitando o sufixo que o GitHub põe em nome repetido. */
const byRepoName = (repos: RepoOption[], name: string) =>
  repos.find((repo) => repo.name.toLowerCase() === name) ??
  repos.find((repo) => new RegExp(`^${name}-\\d+$`).test(repo.name.toLowerCase()));

/**
 * O repositório da coleta, do mais certo para o menos: o confirmado para
 * este site, o que já publicou o domínio, o que tem o nome do projeto no
 * Lovable e, por último, o palpite pelo nome da coleta.
 */
export function suggestRepository(
  repos: RepoOption[],
  publishedByDomain: Map<string, Publication>,
  target: PublishTarget,
): RepositorySuggestion | null {
  if (!repos.length) return null;

  const ligado = target.boundRepo
    ? repos.find((repo) => repo.fullName === target.boundRepo)
    : undefined;
  if (ligado) return { repo: ligado, reason: "bound" };

  const publicado = publishedByDomain.get(normalizeDomain(target.domain) ?? "");
  const doDominio = publicado
    ? repos.find((repo) => repo.fullName === publicado.repoFullName)
    : undefined;
  if (doDominio) return { repo: doDominio, reason: "published" };

  for (const name of target.lovableRepoNames) {
    const doLovable = byRepoName(repos, name);
    if (doLovable) return { repo: doLovable, reason: "lovable-name" };
  }

  const palpite = matchRepository(repos, target);
  return palpite ? { repo: palpite, reason: "guess" } : null;
}

/**
 * Publicar sem formulário: o workflow de deploy está no repositório e o
 * painel já configurou este mesmo domínio nele. Os secrets (inclusive a senha
 * FTP) estão lá; falta só disparar. Workflow de versão antiga não impede —
 * ele publica, e a atualização é feita aos poucos, repositório a repositório.
 */
export function readyToPublish({
  canDeploy,
  publication,
  domain,
}: {
  canDeploy: boolean;
  publication: Publication | undefined;
  domain: string;
}): boolean {
  if (!canDeploy || !publication?.configuredAt) return false;
  return normalizeDomain(publication.domain) === normalizeDomain(domain);
}
