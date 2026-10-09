import { AlertCircle, GitBranch, RefreshCw, Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/*
 * O que a tela de publicação mostra fora do fluxo principal: o cabeçalho, a
 * carga, a API fora do ar, a configuração pendente e a falta de repositório.
 */

export function DeployHeader({
  isLoadingRepos,
  configurable,
  onReload,
  onOpenSettings,
}: {
  isLoadingRepos: boolean;
  configurable: boolean;
  onReload: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <PageHeader
      title="Deploy"
      description="Escolha o repositório do site, confira o destino e publique no domínio do cliente."
      actions={
        <>
          <Button
            variant="outline"
            disabled={isLoadingRepos}
            onClick={onReload}
            title="Reler a lista de repositórios do GitHub"
          >
            <RefreshCw className={isLoadingRepos ? "animate-spin" : undefined} />
            Atualizar
          </Button>
          {configurable && (
            // "Configurar" confundia com o passo "Configurar publicação": este
            // botão abre as Configurações do painel, na seção do GitHub.
            <Button variant="outline" onClick={onOpenSettings} title="Token e organização do GitHub, em Configurações">
              <Settings />
              GitHub e token
            </Button>
          )}
        </>
      }
    />
  );
}

export function DeployLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

export function DeployStatusError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      tone="danger"
      icon={<AlertCircle />}
      title="Não foi possível conectar à API"
      description={message}
      action={<Button onClick={onRetry}>Tentar novamente</Button>}
    />
  );
}

export function SetupRequiredAlert({
  configurable,
  onOpenSettings,
}: {
  configurable: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <Alert variant="warning">
      <AlertCircle />
      <AlertTitle>Publicação ainda não configurada</AlertTitle>
      <AlertDescription>
        {configurable ? (
          <>
            <p>
              Informe o token do GitHub e a organização para o painel conseguir
              listar repositórios e gravar os workflows.
            </p>
            <Button size="sm" className="mt-2" onClick={onOpenSettings}>
              <Settings className="size-4" />
              Configurar agora
            </Button>
          </>
        ) : (
          <p>
            O token do GitHub e a organização precisam ser definidos por alguém
            com a permissão “Configurar o painel”.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Um convite só, no lugar de três cartões vazios repetindo "escolha um
 * repositório": nada abaixo tem conteúdo antes dessa escolha.
 */
export function ChooseRepositoryCard({
  disabled,
  hasPublications,
  onChoose,
}: {
  disabled: boolean;
  /** Há domínios já publicados: a lista abaixo é um atalho até o repositório. */
  hasPublications: boolean;
  onChoose: () => void;
}) {
  return (
    <EmptyState
      icon={<GitBranch />}
      title="Escolha o repositório do site para começar"
      description={
        hasPublications
          ? "Destino, workflows e execuções são de cada repositório. Para um site já publicado, clique no domínio na lista abaixo."
          : "Destino, workflows e execuções são de cada repositório da organização."
      }
      action={
        <Button disabled={disabled} onClick={onChoose}>
          <GitBranch />
          Selecionar repositório
        </Button>
      }
    />
  );
}
