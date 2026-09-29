import { ExternalLink, Globe, Link2 } from "lucide-react";
import type { Project } from "@/lib/api";
import {
  clientUrlOf,
  isLive,
  latestGeneration,
} from "@/features/projects/project-status";
import { cn } from "@/lib/utils";

/**
 * O endereço do projeto: o domínio, quando está no ar; senão, o link do
 * cliente, quando existe.
 *
 * A caixa "pronto" que morava aqui saiu. Ela liberava o envio depois de
 * esconder o badge — que só existe em site publicado, não no Share preview —
 * e repetia o que a sonda do link já responde sozinha.
 */
export function ProjectSite({
  project,
  className,
  inline = false,
}: {
  project: Project;
  className?: string;
  /** Sem a caixa: o link numa linha de campo, como no card. */
  inline?: boolean;
}) {
  const caixa = inline
    ? "inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs transition hover:underline underline-offset-2"
    : "inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition hover:bg-muted";
  // No ar, o endereço que importa é o domínio; a conferência do preview já
  // ficou para trás.
  if (isLive(project)) {
    const { domain } = project.publication!;
    return (
      <div
        className={cn("flex items-center gap-2", className)}
        onClick={(event) => event.stopPropagation()}
      >
        <a
          href={`https://${domain}`}
          target="_blank"
          rel="noreferrer"
          className={caixa}
          title={`Site publicado em ${domain}`}
        >
          <Globe className="size-3 shrink-0" />
          <span className="truncate">{domain}</span>
          <ExternalLink className="ml-auto size-3 shrink-0 opacity-50" />
        </a>
      </div>
    );
  }

  const site = latestGeneration(project);
  if (!site) return null;

  // Sem link do cliente não há o que mostrar: o botão "Criar link" do card
  // já leva ao editor, e o menu tem "Abrir no Lovable". A faixa tracejada que
  // ficava aqui repetia os dois, com um ícone de alerta que parecia erro.
  const clienteUrl = clientUrlOf(site);
  if (!clienteUrl) return null;
  const rotulo = clienteUrl.replace(/^https?:\/\//, "");

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      onClick={(event) => event.stopPropagation()}
    >
      <a
        href={clienteUrl}
        target="_blank"
        rel="noreferrer"
        className={caixa}
        title={`Link do cliente: ${clienteUrl}`}
      >
        <Link2 className="size-3 shrink-0" />
        <span className="truncate">{rotulo}</span>
        <ExternalLink className="ml-auto size-3 shrink-0 opacity-50" />
      </a>
    </div>
  );
}
