import { Link2 } from "lucide-react";
import { ClaudeIcon, GitHubIcon, LovableIcon, type IconComponent } from "@/components/brand-icons";
import type { Project } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { engineLabels, projectEngines, type ProjectEngine } from "./site-engine";

/** A marca de cada ferramenta. O site de fora leva a do GitHub quando é de lá que ele vem. */
const iconOf = ({ engine, site }: ProjectEngine): IconComponent =>
  engine === "lovable" ? LovableIcon : engine === "claude" ? ClaudeIcon : site.repoFullName ? GitHubIcon : Link2;

const titleOf = ({ engine, count, current, elsewhere }: ProjectEngine) => {
  const quantos = count > 1 ? ` (${pluralize(count, "site")})` : "";
  const antigo = elsewhere
    ? " — registrado na outra coleta deste domínio"
    : current
      ? ""
      : " — o site atual é de outra ferramenta";
  switch (engine) {
    case "lovable":
      return `Feito no Lovable${quantos}${antigo}. O editor abre pelo menu "⋯" → Abrir no Lovable.`;
    case "claude":
      return `Gerado pelo motor Claude do painel${quantos}${antigo}.`;
    case "externo":
      return `Feito fora do Lovable e do motor Claude — vinculado pelo repositório ou enviado dos arquivos${quantos}${antigo}.`;
  }
};

/**
 * Com que ferramenta o site do projeto foi feito — Lovable, Claude ou fora dos
 * dois. É identificação, não ação: o editor do Lovable abre pelo menu "⋯",
 * e um selo que também era link duplicava esse caminho. Sem site, nada.
 */
export function SiteEngineBadges({
  project,
  className,
}: {
  project: Pick<Project, "generations" | "domainSite">;
  className?: string;
}) {
  const engines = projectEngines(project);
  if (engines.length === 0) return null;
  return (
    <span className={cn("inline-flex min-w-0 shrink-0 items-center gap-1", className)}>
      {engines.map((item) => {
        const Icon = iconOf(item);
        const pill = cn(
          "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm border bg-card px-1.5 text-2xs font-medium",
          item.current ? "text-foreground/80" : "text-muted-foreground",
        );
        const conteudo = (
          <>
            <Icon className="size-3" />
            <span className="sr-only">Site: </span>
            {engineLabels[item.engine]}
          </>
        );
        return (
          <span key={item.engine} className={pill} title={titleOf(item)}>
            {conteudo}
          </span>
        );
      })}
    </span>
  );
}
