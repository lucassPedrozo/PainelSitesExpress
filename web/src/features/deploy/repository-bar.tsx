import { GitBranch, Lock, ShieldCheck, Unlock } from "lucide-react";
import type { RepoOption } from "@/lib/api/deploy";
import { relativeTime } from "@/lib/format";
import { RepositoryPicker } from "./repository-picker";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

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
}: RepositoryBarProps) {
  const Visibility = selectedRepo?.private ? Lock : Unlock;

  return (
    <Card className="flex-row flex-wrap items-center gap-x-5 gap-y-4 px-5 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted">
          <ShieldCheck className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Organização</p>
          <p className="truncate text-sm font-semibold">
            {organization || "não configurada"}
          </p>
        </div>
      </div>

      <Separator orientation="vertical" className="hidden h-9 sm:block" />

      <div className="min-w-56 flex-1 space-y-1.5 sm:max-w-md">
        <Label htmlFor="repository" className="text-xs text-muted-foreground">
          Repositório
        </Label>
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
        <p
          id="repository-message"
          aria-live="polite"
          className={
            error ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {error ??
            `${repos.length} repositório(s) na organização configurada.`}
        </p>
      </div>

      {selectedRepo && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 self-center text-xs text-muted-foreground">
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
