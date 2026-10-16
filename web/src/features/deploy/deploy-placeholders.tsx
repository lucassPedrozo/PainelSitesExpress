import { AlertCircle, Loader2, RefreshCw, Settings } from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Reason } from "@/components/disabled-hint";
import { EmptyState, ErrorNotice, PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { errorMessage } from "./error-message";

/*
 * O que a tela de publicação mostra fora do fluxo principal: o cabeçalho, a
 * carga, a API fora do ar, a configuração pendente e a falta de repositório.
 */

const TITULO = "Deploy";
const DESCRICAO = "Escolha o repositório do site, confira o destino e publique no domínio do cliente.";

export function DeployHeader({
  isLoadingRepos,
  configurable,
  setupRequired,
  onReload,
  onOpenSettings,
}: {
  isLoadingRepos: boolean;
  configurable: boolean;
  /** Sem token e organização não há lista a reler, e o aviso já leva às Configurações. */
  setupRequired: boolean;
  onReload: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <PageHeader
      title={TITULO}
      description={DESCRICAO}
      actions={
        setupRequired ? undefined : (
          <>
            {/* "Atualizar" não dizia o quê: o botão só relê a lista do GitHub
                (um repositório recém-conectado no Lovable aparece assim). */}
            <Button
              variant="outline"
              disabled={isLoadingRepos}
              onClick={onReload}
              title="Um repositório recém-conectado no Lovable aparece depois de reler a lista do GitHub"
            >
              <RefreshCw className={isLoadingRepos ? "animate-spin" : undefined} />
              Reler repositórios
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
        )
      }
    />
  );
}

/** A API não respondeu: o título da tela fica, e a falha aparece no lugar do conteúdo, como em Projetos. */
export function DeployStatusError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-5">
      <PageHeader title={TITULO} description={DESCRICAO} />
      <Card className="py-0">
        <ErrorNotice title="Não foi possível conectar à API" error={error} onRetry={onRetry} className="py-14" />
      </Card>
    </div>
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
          // O espaço entre o texto e o botão é do contêiner, não do botão.
          <div className="flex flex-col items-start gap-2">
            <span>
              Informe o token do GitHub e a organização para o painel conseguir
              listar repositórios e gravar os workflows.
            </span>
            <Button size="sm" onClick={onOpenSettings}>
              <Settings />
              Configurar agora
            </Button>
          </div>
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
 *
 * Quando não dá para escolher, o motivo fica escrito: a lista ainda está
 * chegando, a leitura falhou (com "Tentar novamente") ou a organização não
 * tem repositório nenhum. Antes o botão só aparecia desabilitado, sem dizer
 * por quê.
 */
export function ChooseRepositoryCard({
  loading,
  error,
  repoCount,
  organization,
  hasPublications,
  onChoose,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  repoCount: number;
  organization: string;
  /** Há domínios já publicados: a lista abaixo é um atalho até o repositório. */
  hasPublications: boolean;
  onChoose: () => void;
  onRetry: () => void;
}) {
  if (error && repoCount === 0) {
    return (
      <EmptyState
        tone="danger"
        icon={<AlertCircle />}
        title="Não foi possível ler os repositórios do GitHub"
        description={errorMessage(error) ?? "Confira o token e a organização em Configurações e tente de novo."}
        action={
          <Button variant="outline" disabled={loading} onClick={onRetry}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            Tentar novamente
          </Button>
        }
      />
    );
  }

  const vazia = !loading && repoCount === 0;
  return (
    <EmptyState
      icon={<GitHubIcon />}
      title="Escolha o repositório do site para começar"
      description={
        hasPublications
          ? "Destino, workflows e execuções são de cada repositório. Para um site já publicado, clique no domínio na lista abaixo."
          : "Destino, workflows e execuções são de cada repositório da organização."
      }
      action={
        <div className="flex flex-col items-center gap-2">
          <Button disabled={loading || vazia} onClick={onChoose}>
            {loading ? <Loader2 className="animate-spin" /> : <GitHubIcon />}
            {loading ? "Lendo os repositórios…" : "Selecionar repositório"}
          </Button>
          {vazia && (
            <Reason>
              Nenhum repositório na organização {organization || "configurada"}. Conecte o
              projeto ao GitHub no Lovable e use “Reler repositórios”.
            </Reason>
          )}
        </div>
      }
    />
  );
}
