import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  completeLovableFromUrl,
  connectLovable,
  disconnectLovable,
  fetchBuildPackage,
  fetchLovableStatus,
  fetchLovableWorkspaces,
} from "@/lib/api";
import { queryKeys } from "@/lib/query";

/** Onde a escolha do workspace fica lembrada entre gerações. */
const WORKSPACE_KEY = "lovable:workspace";

const rememberWorkspace = (id: string) => {
  try {
    localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    // Armazenamento bloqueado: a escolha vale só nesta aba.
  }
};

const rememberedWorkspace = () => {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * Conexão do painel com a conta do Lovable, e os workspaces dela.
 *
 * As duas respostas ficam no cache: abrir o diálogo de novo não refaz as
 * chamadas, e o status continua o mesmo para quem quer que pergunte.
 */
export function useLovableConnection() {
  const queryClient = useQueryClient();

  // Depois de abrir a autorização, a janela "Concluir a conexão" fica à
  // espera do retorno — e o status é conferido sozinho enquanto isso.
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const status = useQuery({
    queryKey: queryKeys.lovableStatus,
    queryFn: fetchLovableStatus,
    refetchInterval: awaitingReturn ? 3000 : false,
  });

  const connected = status.data?.connected ?? false;

  // Retorno concluído (sozinho, na máquina do painel, ou pelo endereço colado
  // em "Concluir a conexão"): fecha a espera aqui, na renderização, e o aviso
  // sai no efeito — que não mexe em estado.
  const [conclusoes, setConclusoes] = useState(0);
  if (awaitingReturn && connected && (status.data?.missingScopes.length ?? 0) === 0) {
    setAwaitingReturn(false);
    setConclusoes((n) => n + 1);
  }
  useEffect(() => {
    if (conclusoes > 0) toast.success("Painel conectado ao Lovable");
  }, [conclusoes]);

  const workspaces = useQuery({
    queryKey: queryKeys.lovableWorkspaces,
    queryFn: async () => (await fetchLovableWorkspaces()).workspaces,
    // Sem conexão não há o que listar; o banner da tela explica o que fazer.
    enabled: connected,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["lovable"] });
  }, [queryClient]);

  const connect = useCallback(async () => {
    try {
      const { authorizeUrl } = await connectLovable();
      window.open(authorizeUrl, "_blank", "noopener,noreferrer");
      setAwaitingReturn(true);
    } catch (err) {
      toast.error("Não foi possível iniciar a conexão", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectLovable();
      await refresh();
      toast.success("Painel desconectado do Lovable");
    } catch (err) {
      toast.error("Não foi possível desconectar", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [refresh]);

  const completeFromUrl = useCallback(
    async (url: string) => {
      await completeLovableFromUrl(url);
      await refresh();
    },
    [refresh],
  );

  return {
    status: status.data ?? null,
    connected,
    awaitingReturn,
    setAwaitingReturn,
    completeFromUrl,
    workspaces: workspaces.data ?? [],
    connect,
    disconnect,
    refresh,
  };
}

/**
 * Qual workspace recebe o site. A conta pode ter vários (inclusive de outras
 * pessoas, como colaborador): o padrão é aquele de que se é dono, e a escolha
 * fica lembrada para as próximas gerações.
 */
export function useWorkspaceChoice(
  workspaces: { id: string; role: string | null }[],
) {
  const [escolhido, setEscolhido] = useState("");

  const disponivel = workspaces.some((item) => item.id === escolhido);
  const lembrado = rememberedWorkspace();
  const workspaceId = disponivel
    ? escolhido
    : (workspaces.find((item) => item.id === lembrado)?.id ??
      workspaces.find((item) => item.role === "owner")?.id ??
      workspaces[0]?.id ??
      "");

  const choose = (id: string) => {
    setEscolhido(id);
    rememberWorkspace(id);
  };

  return { workspaceId, choose };
}

/** O prompt do briefing e os arquivos do projeto, já classificados. */
export function useBuildPackage(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.buildPackage(projectId),
    queryFn: () => fetchBuildPackage(projectId),
    // A varredura do Drive é cara e o material não muda no meio do envio.
    staleTime: 5 * 60_000,
  });

  const reload = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.buildPackage(projectId),
        queryFn: () => fetchBuildPackage(projectId, true),
        staleTime: 0,
      }),
    [projectId, queryClient],
  );

  return { ...query, reload };
}
