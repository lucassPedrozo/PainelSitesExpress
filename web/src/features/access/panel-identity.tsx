import { useState } from "react";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { logoutPanel } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { AccessKeysDialog } from "@/features/access/access-keys-dialog";
import { Button } from "@/components/ui/button";

/**
 * Quem está usando o painel, no cabeçalho.
 *
 * Com uma chave por pessoa, saber de quem é a sessão deixou de ser detalhe:
 * é o que permite conferir se a chave certa foi distribuída e sair sem fechar
 * o navegador. O botão de chaves só aparece para quem tem a permissão
 * `administrar` — sem ela a rota responde 403 de qualquer forma, e oferecer um
 * botão que falha é pior que não oferecer.
 */
export function PanelIdentity() {
  // Quem está na sessão vem do contexto de permissões, que já leu `/api/me`.
  // Buscar de novo aqui era uma segunda chamada para a mesma resposta.
  const { user, canManageAccess: canManage } = usePermissions();
  const [keysOpen, setKeysOpen] = useState(false);

  const sair = async () => {
    try {
      await logoutPanel();
    } catch {
      // Mesmo se a chamada falhar, recarregar leva de volta à tela de entrada
      // quando o cookie já não vale.
    }
    window.location.reload();
  };

  if (!user) return null;

  return (
    <>
      <div className="flex items-center gap-1">
        <span
          className="mr-1 hidden items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex"
          title={
            user.kind === "admin"
              ? "Autenticado com a chave do .env"
              : "Autenticado com chave própria"
          }
        >
          <UserRound className="size-3.5" />
          {user.name}
        </span>

        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setKeysOpen(true)}
            aria-label="Chaves de acesso"
            title="Chaves de acesso"
          >
            <KeyRound className="size-4" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => void sair()}
          aria-label="Sair do painel"
          title="Sair do painel"
        >
          <LogOut className="size-4" />
        </Button>
      </div>

      <AccessKeysDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </>
  );
}
