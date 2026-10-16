import type { Generation, Project } from "@/lib/api";
import { clientUrlOf, isClaudeSite, isExternalSite } from "./project-status";

/**
 * Com que ferramenta o site do projeto foi feito: o Lovable (gerado pelo
 * painel ou vinculado pelo endereço do editor), o motor Claude, ou fora dos
 * dois (vinculado só pelo repositório, ou enviado dos arquivos do projeto).
 *
 * Antes isso só se descobria abrindo o menu — "Abrir no Lovable" aparecia ou
 * não — e um projeto com um site do Lovable e outro do Claude escondia o do
 * Lovable atrás do mais recente.
 */
export type SiteEngine = "lovable" | "claude" | "externo";

export const engineOf = (site: Generation): SiteEngine =>
  isClaudeSite(site) ? "claude" : isExternalSite(site) ? "externo" : "lovable";

export const engineLabels: Record<SiteEngine, string> = {
  lovable: "Lovable",
  claude: "Claude",
  externo: "Externo",
};

/** O editor de um site do Lovable. */
export const lovableUrlOf = (site: Generation): string => site.url ?? `https://lovable.dev/projects/${site.id}`;

export type ProjectEngine = {
  engine: SiteEngine;
  /** O site está registrado em outra coleta do mesmo domínio (`Project.domainSite`). */
  elsewhere: boolean;
  /** Quantos sites do projeto vieram desta ferramenta. */
  count: number;
  /** O site mais recente desta ferramenta. */
  site: Generation;
  /** É a ferramenta do site que vale hoje (o mais recente do projeto). */
  current: boolean;
};

/**
 * As ferramentas dos sites do projeto, uma vez cada, a do site atual primeiro
 * e as outras do mais recente para o mais antigo.
 */
export function projectEngines(project: Pick<Project, "generations" | "domainSite">): ProjectEngine[] {
  // Sem site nesta coleta, vale o do domínio, que mora em outra.
  if (project.generations.length === 0 && project.domainSite) {
    const { site } = project.domainSite;
    return [{ engine: engineOf(site), count: 1, site, current: true, elsewhere: true }];
  }
  const porMotor = new Map<SiteEngine, ProjectEngine>();
  const sites = project.generations;
  for (let i = sites.length - 1; i >= 0; i--) {
    const site = sites[i];
    const engine = engineOf(site);
    const visto = porMotor.get(engine);
    if (visto) visto.count += 1;
    else porMotor.set(engine, { engine, count: 1, site, current: i === sites.length - 1, elsewhere: false });
  }
  return [...porMotor.values()];
}

/**
 * O site do Lovable mais recente do projeto, mesmo que depois dele tenha vindo
 * um do Claude: o projeto continua existindo lá. Sem site nesta coleta, o do
 * domínio registrado em outra.
 */
export const latestLovableSite = (project: Pick<Project, "generations" | "domainSite">): Generation | undefined =>
  projectEngines(project).find((item) => item.engine === "lovable")?.site;

/**
 * O site que vale para o projeto: o mais recente dele ou, numa coleta sem
 * site, o do domínio registrado em outra coleta.
 */
const currentSiteOf = (project: Pick<Project, "generations" | "domainSite">): Generation | undefined =>
  project.generations.at(-1) ?? project.domainSite?.site;

/** O domínio principal do site, com o protocolo; `null` sem domínio. */
export const siteUrlOf = (project: Pick<Project, "domain" | "publication">): string | null => {
  const domain = project.publication?.domain ?? project.domain;
  return domain ? `https://${domain.replace(/^https?:\/\//, "")}` : null;
};

/**
 * O repositório do site no GitHub: o do site que vale hoje (o da área de
 * aprovação ou o confirmado na primeira publicação) ou, sem ele, o da
 * publicação no domínio. `null` enquanto o site não foi ao GitHub.
 */
export const repoOf = (project: Pick<Project, "generations" | "domainSite" | "publication">): string | null => {
  const site = currentSiteOf(project);
  return site?.devArea?.repoFullName ?? site?.repoFullName ?? project.publication?.repoFullName ?? null;
};

/** O endereço do repositório no GitHub; `null` sem repositório. */
export const repoUrlOf = (project: Pick<Project, "generations" | "domainSite" | "publication">): string | null => {
  const repo = repoOf(project);
  return repo ? `https://github.com/${repo}` : null;
};

/**
 * O link de aprovação — o que o cliente recebe: a pasta na área de aprovação,
 * depois de publicada, ou o link curto dos sites de antes dela. `null` quando
 * o projeto ainda não tem um.
 */
export const approvalUrlOf = (project: Pick<Project, "generations" | "domainSite">): string | null =>
  clientUrlOf(currentSiteOf(project));

/**
 * O repositório que a aba "Ajustes" edita pelo Claude: o do site mais recente
 * do projeto, quando ele mora num repositório do GitHub e não é do motor
 * Claude (esse tem os ajustes dele, na aba Claude). `null` quando a aba não
 * se aplica. É a mesma regra do servidor.
 */
export const repoEditableOf = (project: Pick<Project, "generations">): string | null => {
  const site = project.generations.at(-1);
  if (!site || site.engine === "claude") return null;
  return site.devArea?.repoFullName ?? site.repoFullName ?? null;
};
