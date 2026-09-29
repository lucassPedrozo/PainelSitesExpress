import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AccessGate } from "@/features/access/access-gate";
import { ApiError, onUnauthorized } from "@/lib/access-token";
import { queryKeys } from "@/lib/query";
import { fetchGate, openSession } from "@/lib/api";

/**
 * Enquanto o servidor não pede chave o painel abre direto — é o caso de quem
 * roda tudo em 127.0.0.1. Quando pede, a tela pergunta ao `/api/gate` se este
 * navegador já tem sessão; só se não tiver, pede a chave, que é trocada por um
 * cookie de sessão e não fica guardada em lugar nenhum da página.
 *
 * O estado da tela é **derivado** da resposta do porteiro, em vez de copiado
 * para dentro de um `useState` por um efeito: um caminho a menos para os dois
 * discordarem.
 */
export function PanelGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const gate = useQuery({
    queryKey: queryKeys.gate,
    queryFn: fetchGate,
    // A resposta vale para a sessão inteira; quem a muda é entrar ou sair.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const parar = onUnauthorized((reason) => {
      // A sessão caiu: o que estava em cache é de quem saiu, e a chave que
      // entrar em seguida pode ser de outra pessoa, com outras permissões.
      // Limpar derruba também a resposta do porteiro, que é buscada de novo.
      queryClient.clear();
      setMessage(reason);
    });
    return () => {
      parar();
    };
  }, [queryClient]);

  const handleAccess = async (token: string) => {
    setMessage("");
    try {
      await openSession(token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.gate });
    } catch (error) {
      // 429 traz o tempo de espera; os demais casos são a chave recusada.
      setMessage(
        error instanceof ApiError && error.status === 429
          ? error.message
          : "Não foi possível entrar com esta chave.",
      );
    }
  };

  if (gate.isPending) {
    return (
      <main className="grid min-h-svh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (gate.isError) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="font-medium">Não foi possível conectar à API</p>
          <p className="text-sm text-muted-foreground">
            {(gate.error as Error).message}
          </p>
          <p className="text-xs text-muted-foreground">
            Confirme se o servidor está rodando em http://localhost:3333
          </p>
        </div>
      </main>
    );
  }

  const aberto = !gate.data.authenticationRequired || gate.data.authenticated;
  if (!aberto) {
    return <AccessGate message={message || undefined} onSubmit={handleAccess} />;
  }

  return <>{children}</>;
}
