import type { ReactNode } from "react";
import { FolderKanban, LayoutDashboard, RefreshCw, Rocket, Search, Settings } from "lucide-react";
import joinvixLogo from "@/assets/joinvix-logo.png";
import joinvixMark from "@/assets/joinvix-mark.png";
import { AccountMenu } from "@/features/access/account-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SlidingIndicator, useSlidingIndicator } from "@/components/sliding-indicator";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PanelSection = "projects" | "dashboard" | "deploy" | "settings";

const SECTIONS: Array<{ id: PanelSection; label: string; short: string; icon: ReactNode }> = [
  { id: "projects", label: "Projetos", short: "Projetos", icon: <FolderKanban /> },
  { id: "dashboard", label: "Dashboard", short: "Dashboard", icon: <LayoutDashboard /> },
  { id: "deploy", label: "Deploy", short: "Deploy", icon: <Rocket /> },
  { id: "settings", label: "Configurações", short: "Ajustes", icon: <Settings /> },
];

type AppHeaderProps = {
  section: PanelSection;
  onSectionChange: (section: PanelSection) => void;
  /**
   * A tela de configuração grava senhas no .env: só aparece para quem tem a
   * permissão `configurar`.
   */
  canConfigure?: boolean;
  /** A busca de projetos — a mesma de qualquer seção. */
  query: string;
  onQueryChange: (value: string) => void;
  /** Enter na busca, fora da tela Projetos: leva para lá com o termo. */
  onSearch: () => void;
  /** Relê a lista de projetos; `null` nas seções em que ela não aparece. */
  onRefresh: (() => void) | null;
  refreshing: boolean;
  fetchedAt: string | null;
};

/**
 * O cabeçalho do painel: a marca, as seções (com ícone e o sublinhado na que
 * está aberta), a busca, o atualizar e a conta.
 *
 * No celular ele tem duas linhas: a marca, a busca e a conta em cima; as
 * seções embaixo, em ícones com rótulo.
 */
export function AppHeader({
  section,
  onSectionChange,
  canConfigure = false,
  query,
  onQueryChange,
  onSearch,
  onRefresh,
  refreshing,
  fetchedAt,
}: AppHeaderProps) {
  const sections = SECTIONS.filter((item) => item.id !== "settings" || canConfigure);
  // O sublinhado da seção atual é um só, e desliza até a seção escolhida.
  const { containerRef: navRef, box: sublinhado, animar } = useSlidingIndicator<HTMLElement>(section);

  return (
    <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur">
      {/* A mesma largura do conteúdo de todas as telas: as bordas batem. */}
      <div className="mx-auto flex h-14 max-w-wide items-center gap-3 px-4 md:gap-5 md:px-6">
        {/* O logotipo existe num único tom (o texto em azul-escuro): a placa
            branca o mantém legível no tema escuro, e no claro some no fundo. */}
        <span className="flex shrink-0 items-center gap-3">
          <span className="rounded-md bg-white px-1.5 py-1">
            <img src={joinvixMark} alt="Joinvix" width={213} height={218} className="h-5 w-auto sm:hidden" />
            <img src={joinvixLogo} alt="Joinvix" width={197} height={46} className="hidden h-5 w-auto sm:block" />
          </span>
          <span aria-hidden className="hidden h-6 w-px bg-border xl:block" />
          <span className="hidden text-ui font-semibold whitespace-nowrap xl:block">Painel Sites Express</span>
        </span>

        <nav ref={navRef} aria-label="Seções" className="relative hidden h-full items-stretch md:flex">
          {sections.map((item) => (
            <SectionLink key={item.id} item={item} active={section === item.id} onClick={() => onSectionChange(item.id)} />
          ))}
          <SlidingIndicator box={sublinhado} animar={animar} inset={8} className="-bottom-px h-0.5 rounded-full bg-primary" />
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <form
            role="search"
            className="relative min-w-0 flex-1 md:w-48 md:flex-none lg:w-60 xl:w-80"
            onSubmit={(event) => {
              event.preventDefault();
              onSearch();
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Buscar por domínio ou projeto…"
              aria-label="Buscar projeto por domínio ou nome"
              className="pl-8"
            />
          </form>
          {onRefresh && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={refreshing}
              onClick={onRefresh}
              aria-label="Atualizar a lista de projetos"
              title={fetchedAt ? `Atualizado às ${formatTime(fetchedAt)} · relê o Drive agora` : "Relê o Drive agora"}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
            </Button>
          )}
          <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <AccountMenu />
        </div>
      </div>

      {/* No celular, as seções descem para uma linha própria, com rótulo:
          só o ícone não dizia para onde levava. */}
      <nav aria-label="Seções" className="flex border-t md:hidden">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => onSectionChange(item.id)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 border-b-2 py-1.5 text-2xs font-medium transition-colors outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset [&_svg]:size-4",
              section === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
            )}
          >
            {item.icon}
            {item.short}
          </button>
        ))}
      </nav>
    </header>
  );
}

function SectionLink({
  item,
  active,
  onClick,
}: {
  item: (typeof SECTIONS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-indicator-active={active}
      className={cn(
        "relative inline-flex items-center gap-2 px-3 text-ui font-medium whitespace-nowrap transition-colors outline-none",
        "focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset [&_svg]:size-4 [&_svg]:transition-colors",
        active ? "text-foreground [&_svg]:text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {item.icon}
      {item.label}
    </button>
  );
}
