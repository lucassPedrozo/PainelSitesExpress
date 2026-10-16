import type { RepoOption } from "@/lib/api/deploy";
import { pluralize } from "@/lib/format";
import { When } from "@/components/when";
import { errorMessage } from "./error-message";
import type { PublishTarget, RepositorySuggestion } from "./publish-target";
import { RepositoryPicker } from "./repository-picker";
import { SuggestionNote } from "./suggestion-note";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type RepositoryBarProps = {
  organization: string;
  repos: RepoOption[];
  selectedRepo?: RepoOption;
  /** Repositórios que o painel configurou, segundo o servidor. */
  configuredRepos: Set<string>;
  repoDomains: Map<string, string>;
  loading: boolean;
  /** A leitura da lista falhou: a nota diz isso, em vez de "0 repositórios". */
  loadError?: unknown;
  onRetry: () => void;
  error?: string;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onSelect: (repo: RepoOption) => void;
  /** A coleta que abriu a tela e o repositório que ela sugere, se houver. */
  target?: PublishTarget | null;
  suggestion?: RepositorySuggestion | null;
  /** A pessoa escolheu outro repositório: a sugestão deixa de valer. */
  overridden?: boolean;
};

/**
 * O repositório é o contexto de tudo nesta tela, não mais um campo entre os
 * outros: enquanto ele não é escolhido nada abaixo tem o que mostrar. Trazê-lo
 * para o topo também acabou com a duplicidade — antes o mesmo dado aparecia no
 * cartão "Repositório ativo" e dentro do formulário.
 */
export function RepositoryBar({
  organization,
  repos,
  selectedRepo,
  configuredRepos,
  repoDomains,
  loading,
  loadError,
  onRetry,
  error,
  pickerOpen,
  onPickerOpenChange,
  onSelect,
  target,
  suggestion,
  overridden = false,
}: RepositoryBarProps) {
  // O que fica embaixo do seletor, nesta ordem: o erro de validação, a falha
  // ao ler a lista, o motivo da sugestão (ou a falta dela) quando a tela veio
  // de um projeto, e a contagem como padrão.
  const falhaNaLista = loadError ? (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-destructive">
      <span className="min-w-0 truncate" title={errorMessage(loadError) ?? undefined}>
        Não foi possível ler os repositórios do GitHub
        {errorMessage(loadError) ? `: ${errorMessage(loadError)}` : "."}
      </span>
      <Button type="button" variant="link" size="xs" className="px-0" disabled={loading} onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  ) : null;

  const nota = error ? (
    <p className="text-xs text-destructive">{error}</p>
  ) : falhaNaLista ? (
    falhaNaLista
  ) : target && suggestion && !overridden ? (
    <SuggestionNote suggestion={suggestion} lovableName={null} />
  ) : target && !suggestion && !loading && repos.length > 0 && !selectedRepo ? (
    <p className="text-xs text-warning">
      Nenhum repositório da organização casou com “{target.projectLabel}” — escolha na lista.
    </p>
  ) : selectedRepo ? null : (
    <p className="text-xs text-muted-foreground">
      {loading
        ? "Lendo os repositórios do GitHub…"
        : `${pluralize(repos.length, "repositório")} na organização ${organization || "configurada"}.`}
    </p>
  );

  return (
    <Card className="px-5 py-4">
      <div className="max-w-xl space-y-1.5">
        <Label htmlFor="repository">Repositório do site</Label>
        <RepositoryPicker
          id="repository"
          describedBy="repository-message"
          repos={repos}
          selected={selectedRepo}
          loading={loading}
          invalid={Boolean(error)}
          configured={configuredRepos}
          domains={repoDomains}
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          onSelect={onSelect}
        />
        <div id="repository-message" aria-live="polite" className="space-y-0.5">
          {nota}
          {/* Branch, visibilidade e data do repositório: conferência, não
              decisão — uma linha discreta, no lugar de três selos ao lado. */}
          {selectedRepo && (
            <p className="truncate text-xs text-muted-foreground">
              Branch {selectedRepo.defaultBranch} · {selectedRepo.private ? "privado" : "público"} ·{" "}
              <When at={selectedRepo.updatedAt} prefix="atualizado" />
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
