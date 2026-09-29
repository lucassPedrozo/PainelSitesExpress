import type { ReactNode } from "react";
import { FolderTree, Rocket, Settings } from "lucide-react";
import joinvixLogo from "@/assets/joinvix-logo.png";
import { PanelIdentity } from "@/features/access/panel-identity";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type PanelSection = "projects" | "deploy" | "settings";

type AppHeaderProps = {
  section: PanelSection;
  onSectionChange: (section: PanelSection) => void;
  /**
   * A tela de configuração grava senhas no .env: só aparece para quem tem a
   * permissão `configurar`.
   */
  canConfigure?: boolean;
  /** Controles da seção aberta, entre a navegação e a identidade. */
  children?: ReactNode;
};

/** Marca, navegação entre as seções, controles da seção, identidade e tema. */
export function AppHeader({ section, onSectionChange, canConfigure = false, children }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-6">
        {/* O logotipo existe num único tom — a marca em azul e o texto em
            azul-escuro. A placa branca o mantém legível no tema escuro; no
            tema claro ela se confunde com o fundo e some. */}
        <span className="shrink-0 rounded-md bg-white px-2 py-1.5">
          <img
            src={joinvixLogo}
            alt="Joinvix"
            width={197}
            height={46}
            className="h-5 w-auto"
          />
        </span>

        {/* Some primeiro na janela estreita: a navegação e a busca valem
            mais que a assinatura do painel. */}
        <div className="mr-2 hidden shrink-0 items-center gap-3 lg:flex">
          <Separator orientation="vertical" className="h-8" />
          <div className="min-w-0">
            <h1 className="text-sm leading-tight font-semibold">
              Painel Gerenciador
            </h1>
            <p className="text-xs text-muted-foreground">Sites Express</p>
          </div>
        </div>

        <nav className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-xs" aria-label="Seções">
          <SectionButton
            active={section === "projects"}
            onClick={() => onSectionChange("projects")}
          >
            <FolderTree className="size-4" />
            Projetos
          </SectionButton>
          <SectionButton
            active={section === "deploy"}
            onClick={() => onSectionChange("deploy")}
          >
            <Rocket className="size-4" />
            Deploy
          </SectionButton>
          {canConfigure && (
            <SectionButton
              active={section === "settings"}
              onClick={() => onSectionChange("settings")}
            >
              <Settings className="size-4" />
              <span className="hidden md:inline">Configurações</span>
            </SectionButton>
          )}
        </nav>

        {children}

        {/* Sem controles da seção, a identidade é que empurra para a direita. */}
        <div className={cn("flex items-center gap-1", !children && "ml-auto")}>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <PanelIdentity />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function SectionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    // O mesmo desenho do controle segmentado (components/segmented.tsx).
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4",
        active
          ? "bg-secondary text-secondary-foreground shadow-xs"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
