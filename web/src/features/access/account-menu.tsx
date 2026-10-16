import { useState } from "react";
import { ChevronDown, KeyRound, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { logoutPanel } from "@/lib/api";
import { PERMISSION_LABELS, usePermissions } from "@/lib/permissions";
import { AccessKeysDialog } from "@/features/access/access-keys-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** As iniciais do nome, para o círculo: "Ana Souza" → "AS", "Administrador" → "AD". */
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase();
};

/**
 * Quem está usando o painel, no cabeçalho, e o menu da conta.
 *
 * Embaixo do nome vai só o que a chave informa: o tipo (a do administrador,
 * no .env) ou o que ela pode fazer. O painel não sabe cargo. Antes o nome
 * sumia abaixo de 1280px e o resto morava num `title`.
 */
export function AccountMenu() {
  const { user, permissions, canManageAccess } = usePermissions();
  const { resolvedTheme, setTheme } = useTheme();
  const [keysOpen, setKeysOpen] = useState(false);
  const escuro = resolvedTheme === "dark";

  const sair = async () => {
    try {
      await logoutPanel();
    } catch {
      // Mesmo se a chamada falhar, recarregar leva de volta à tela de entrada
      // quando o cookie já não vale.
    }
    window.location.reload();
  };

  // Sem chave configurada não há sessão a mostrar: fica só o tema.
  if (!user) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={escuro ? "Usar o tema claro" : "Usar o tema escuro"}
        onClick={() => setTheme(escuro ? "light" : "dark")}
      >
        {escuro ? <Sun /> : <Moon />}
      </Button>
    );
  }

  const podeTudo = permissions.length === Object.keys(PERMISSION_LABELS).length;
  const legenda =
    user.kind === "admin"
      ? "Chave do administrador"
      : podeTudo
        ? "Acesso completo"
        : permissions.length === 0
          ? "Só leitura"
          : permissions.map((permission) => PERMISSION_LABELS[permission].title.split(" ")[0]).join(" · ");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label={`Conta: ${user.name}`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-stage-geracao-soft text-xs font-semibold text-stage-geracao">
              {initials(user.name)}
            </span>
            <span className="hidden min-w-0 xl:block">
              <span className="block max-w-40 truncate text-ui font-semibold">{user.name}</span>
              <span className="block max-w-40 truncate text-2xs text-muted-foreground">{legenda}</span>
            </span>
            <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground xl:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block text-sm font-semibold text-foreground">{user.name}</span>
            <span className="block text-xs font-normal">
              {user.kind === "admin" ? "Entrou com a chave do administrador (.env)." : "Entrou com uma chave própria."}
            </span>
          </DropdownMenuLabel>
          <div className="px-2 pb-2">
            <p className="text-xs text-muted-foreground">Esta chave pode:</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {permissions.length === 0 ? (
                <li className="text-xs">só ver projetos, arquivos e briefings</li>
              ) : (
                permissions.map((permission) => (
                  <li
                    key={permission}
                    className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium"
                    title={PERMISSION_LABELS[permission].hint}
                  >
                    {PERMISSION_LABELS[permission].title}
                  </li>
                ))
              )}
            </ul>
          </div>
          <DropdownMenuSeparator />
          {canManageAccess && (
            <DropdownMenuItem onSelect={() => setKeysOpen(true)}>
              <KeyRound />
              Chaves de acesso
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setTheme(escuro ? "light" : "dark")}>
            {escuro ? <Sun /> : <Moon />}
            {escuro ? "Usar o tema claro" : "Usar o tema escuro"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void sair()}>
            <LogOut />
            Sair do painel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccessKeysDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </>
  );
}
