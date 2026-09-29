import { useQuery } from "@tanstack/react-query";
import type { AccessPermission } from "@shared/access-permissions.js";
import { fetchMe } from "@/lib/api";
import { queryKeys } from "@/lib/query";

/** Rótulos das permissões, usados na tela de chaves. */
export const PERMISSION_LABELS: Record<
  AccessPermission,
  { title: string; hint: string }
> = {
  organizar: { title: "Organizar", hint: "Aplicar tags e renomear projetos" },
  gerar: { title: "Gerar", hint: "Criar e alterar sites no Lovable" },
  publicar: { title: "Publicar", hint: "Publicar sites por FTP" },
  configurar: {
    title: "Configurar o painel",
    hint: "Editar credenciais e integrações do .env (GitHub, FTP, IA, rede)",
  },
  administrar: {
    title: "Administrar chaves",
    hint: "Criar, revogar e permissionar outras chaves",
  },
};

/**
 * O que a chave desta sessão pode fazer, lido de `/api/me`.
 *
 * Antes isto era um contexto alimentado por um `useEffect` no topo da árvore.
 * Virou uma query: o cache já é o "contexto" — todos os botões espalhados
 * pelos cards leem a mesma resposta, buscada uma vez só.
 *
 * `can` responde **true** enquanto a resposta não chegou, e também quando ela
 * falhou. Desabilitar por precaução faria a tela inteira piscar em cinza a cada
 * carregamento, e não protegeria nada: a recusa de verdade está no servidor,
 * que confere a permissão em toda rota que muda alguma coisa.
 */
export function usePermissions() {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchMe,
    // Permissão muda pela tela de chaves, que invalida esta consulta; fora
    // isso ela não muda sozinha no meio do uso.
    staleTime: 5 * 60_000,
  });

  const user = data?.user ?? null;
  const permissions = data?.permissions ?? [];

  return {
    user,
    permissions,
    canManageAccess: data?.canManageAccess ?? false,
    /** Ainda não se sabe o que esta chave pode. */
    loading: isPending,
    can: (permission: AccessPermission) =>
      isPending || !user || permissions.includes(permission),
  };
}
