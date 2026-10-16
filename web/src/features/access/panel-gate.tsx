import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { AccessGate } from "@/features/access/access-gate";
import { ApiError, onUnauthorized } from "@/lib/api/errors";
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
      <main className="grid min-h-svh place-items-center bg-background" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Abrindo o painel…</span>
      </main>
    );
  }

  if (gate.isError) {
    // Sem endereço fixo: o painel pode estar em outra porta, ou ser aberto
    // pela rede, e "localhost:3333" mandava conferir a máquina errada.
    const motivo = gate.error instanceof Error && gate.error.message ? gate.error.message : null;
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <EmptyState
          tone="danger"
          icon={<AlertCircle />}
          title="Não foi possível conectar ao painel"
          description={
            <>
              {motivo && <p>{motivo}</p>}
              <p>Confira se o painel está rodando e se este endereço é o dele.</p>
            </>
          }
          action={
            <Button onClick={() => void gate.refetch()} disabled={gate.isFetching}>
              {gate.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Tentar novamente
            </Button>
          }
          className="w-full max-w-sm"
        />
      </main>
    );
  }

  const aberto = !gate.data.authenticationRequired || gate.data.authenticated;
  if (!aberto) {
    return <AccessGate message={message || undefined} onSubmit={handleAccess} />;
  }

  return <>{children}</>;
}
