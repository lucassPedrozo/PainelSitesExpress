import type { ReactNode } from "react";
import { ChartNoAxesGantt, FolderTree, Rocket, Settings } from "lucide-react";
import joinvixLogo from "@/assets/joinvix-logo.png";
import joinvixMark from "@/assets/joinvix-mark.png";
import { PanelIdentity } from "@/features/access/panel-identity";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type PanelSection = "projects" | "dashboard" | "deploy" | "settings";

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
      {/* Abaixo de `md` o cabeçalho tem duas linhas: marca, navegação e
          identidade em cima; os controles da seção (busca, atualizar) embaixo.
          Numa linha só eles não cabiam, e a identidade, o "Sair" e o tema
          ficavam fora da tela, levando a página inteira a rolar para o lado. */}
      <div className="mx-auto flex min-h-16 max-w-[1400px] flex-wrap items-center gap-x-2 gap-y-2 px-6 py-2 sm:gap-x-3 md:h-16 md:flex-nowrap md:py-0">
        {/* O logotipo existe num único tom — a marca em azul e o texto em
            azul-escuro. A placa branca o mantém legível no tema escuro; no
            tema claro ela se confunde com o fundo e some. */}
        <span className="shrink-0 rounded-md bg-white px-2 py-1.5">
          {/* No celular fica só o símbolo: o logotipo inteiro tomava a
              largura de que a navegação precisa. */}
          <img
            src={joinvixMark}
            alt="Joinvix"
            width={213}
            height={218}
            className="h-5 w-auto sm:hidden"
          />
          <img
            src={joinvixLogo}
            alt="Joinvix"
            width={197}
            height={46}
            className="hidden h-5 w-auto sm:block"
          />
        </span>

        {/* Some primeiro na janela estreita: a navegação e a busca valem
            mais que a assinatura do painel. */}
        <div className="mr-2 hidden shrink-0 items-center gap-3 xl:flex">
          <Separator orientation="vertical" className="h-8" />
          <div className="min-w-0">
            <h1 className="text-sm leading-tight font-semibold">
              Painel Sites Express
            </h1>
            <p className="text-xs text-muted-foreground">Joinvix</p>
          </div>
        </div>

        {/* Abaixo de `xl` o título visível some; o da página continua existindo
            para quem navega por títulos. */}
        <h1 className="sr-only xl:hidden">Painel Sites Express</h1>

        <nav className="flex h-8 shrink-0 pointer-coarse:h-11 items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-xs" aria-label="Seções">
          <SectionButton
            active={section === "projects"}
            onClick={() => onSectionChange("projects")}
            icon={<FolderTree />}
            label="Projetos"
          />
          <SectionButton
            active={section === "dashboard"}
            onClick={() => onSectionChange("dashboard")}
            icon={<ChartNoAxesGantt />}
            label="Dashboard"
            compactUntil="md"
          />
          <SectionButton
            active={section === "deploy"}
            onClick={() => onSectionChange("deploy")}
            icon={<Rocket />}
            label="Deploy"
          />
          {canConfigure && (
            <SectionButton
              active={section === "settings"}
              onClick={() => onSectionChange("settings")}
              icon={<Settings />}
              label="Configurações"
              compactUntil="lg"
            />
          )}
        </nav>

        {children && (
          <div className="order-last flex min-w-0 basis-full items-center gap-3 md:order-none md:flex-1 md:basis-0 md:justify-end">
            {children}
          </div>
        )}

        {/* Sem controles da seção ao lado (ou com eles na linha de baixo), a
            identidade é que empurra para a direita. */}
        <div className={cn("ml-auto flex shrink-0 items-center gap-1 max-sm:[&_[data-slot=button]]:min-w-8", children && "md:ml-0")}>
          <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
          <PanelIdentity />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

const COMPACT = {
  sm: "hidden sm:inline",
  md: "hidden md:inline",
  lg: "hidden lg:inline",
} as const;

function SectionButton({
  active,
  onClick,
  icon,
  label,
  compactUntil = "sm",
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  /** Até esta largura, a seção que não está aberta mostra só o ícone. */
  compactUntil?: "sm" | "md" | "lg";
}) {
  return (
    // O mesmo desenho do controle segmentado (components/segmented.tsx).
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-4",
        active
          ? "bg-secondary text-secondary-foreground shadow-xs"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {icon}
      <span className={cn(!active && COMPACT[compactUntil])}>
        {label}
      </span>
    </button>
  );
}
