import { GitBranch, Lock, Unlock } from "lucide-react";
import type { RepoOption } from "@/lib/api/deploy";
import { pluralize, relativeTime } from "@/lib/format";
import type { PublishTarget, RepositorySuggestion } from "./publish-target";
import { RepositoryPicker } from "./repository-picker";
import { SuggestionNote } from "./suggestion-note";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type RepositoryBarProps = {
  organization: string;
  repos: RepoOption[];
  selectedRepo?: RepoOption;
  configuredRepos: Set<string>;
  repoDomains: Map<string, string>;
  loading: boolean;
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
  error,
  pickerOpen,
  onPickerOpenChange,
  onSelect,
  target,
  suggestion,
  overridden = false,
}: RepositoryBarProps) {
  const Visibility = selectedRepo?.private ? Lock : Unlock;

  // O que fica embaixo do seletor, nesta ordem: o erro de validação, o motivo
  // da sugestão (ou a falta dela) quando a tela veio de um projeto, e a
  // contagem como padrão.
  const nota = error ? (
    <p className="text-xs text-destructive">{error}</p>
  ) : target && suggestion && !overridden ? (
    <SuggestionNote suggestion={suggestion} lovableName={null} />
  ) : target && !suggestion && !loading && repos.length > 0 && !selectedRepo ? (
    <p className="text-xs text-warning">
      Nenhum repositório da organização casou com “{target.projectLabel}” — escolha na lista.
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">
      {loading
        ? "Lendo os repositórios do GitHub…"
        : `${pluralize(repos.length, "repositório")} na organização ${organization || "configurada"}.`}
    </p>
  );

  return (
    <Card className="flex-row flex-wrap items-start gap-x-5 gap-y-3 px-5 py-4">
      <div className="min-w-56 flex-1 space-y-1.5 sm:max-w-xl">
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
        <div id="repository-message" aria-live="polite">
          {nota}
        </div>
      </div>

      {selectedRepo && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-7 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <GitBranch className="size-3.5" />
            {selectedRepo.defaultBranch}
          </span>
          <span className="flex items-center gap-1.5">
            <Visibility className="size-3.5" />
            {selectedRepo.private ? "privado" : "público"}
          </span>
          <span>atualizado {relativeTime(selectedRepo.updatedAt)}</span>
        </div>
      )}
    </Card>
  );
}
