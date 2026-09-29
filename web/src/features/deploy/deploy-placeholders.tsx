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
      title="Publicação de sites"
      description="Escolha o repositório, confira as credenciais e publique o site no domínio do cliente."
      actions={
        <>
          <Button variant="outline" disabled={isLoadingRepos} onClick={onReload}>
            <RefreshCw className={isLoadingRepos ? "animate-spin" : undefined} />
            Atualizar
          </Button>
          {configurable && (
            <Button variant="outline" onClick={onOpenSettings}>
              <Settings />
              Configurar
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
    <Alert>
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
  onChoose,
}: {
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <EmptyState
      icon={<GitBranch />}
      title="Escolha um repositório para começar"
      description="As credenciais, os workflows e o histórico de publicações são próprios de cada repositório da organização."
      action={
        <Button disabled={disabled} onClick={onChoose}>
          <GitBranch />
          Selecionar repositório
        </Button>
      }
    />
  );
}
