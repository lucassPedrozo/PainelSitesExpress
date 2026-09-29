import { useState } from "react";
import { Check, ChevronsUpDown, GitBranch, Lock, Unlock } from "lucide-react";
import type { RepoOption } from "@/lib/api/deploy";
import { relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type RepositoryPickerProps = {
  /** Casa com o `htmlFor` do rótulo: sem isso o campo fica sem nome acessível. */
  id: string;
  describedBy?: string;
  repos: RepoOption[];
  selected?: RepoOption;
  loading: boolean;
  invalid?: boolean;
  /** Repositórios já publicados por este navegador ganham um selo. */
  configured: Set<string>;
  /**
   * Domínio de cada repositório que o painel já publicou. Os nomes vêm do
   * Lovable ("green-ground-glow") e não dizem de quem é o site; o domínio diz,
   * e a busca também o encontra.
   */
  domains: Map<string, string>;
  /** Controlado quando a tela precisa abrir a lista por conta própria. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (repo: RepoOption) => void;
};

export function RepositoryPicker({
  id,
  describedBy,
  repos,
  selected,
  loading,
  invalid,
  configured,
  domains,
  open: openProp,
  onOpenChange,
  onSelect,
}: RepositoryPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="lg"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          disabled={loading}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selected
                ? selected.fullName
                : loading
                  ? "Carregando repositórios..."
                  : "Selecione um repositório"}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-80 p-0"
        align="start"
      >
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Buscar repositório..." />
          <CommandList>
            <CommandEmpty>Nenhum repositório encontrado.</CommandEmpty>
            <CommandGroup>
              {repos.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={`${repo.fullName} ${domains.get(repo.fullName) ?? ""}`}
                  onSelect={() => {
                    onSelect(repo);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      selected?.id === repo.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {repo.private ? (
                    <Lock className="size-3.5 text-muted-foreground" />
                  ) : (
                    <Unlock className="size-3.5 text-muted-foreground" />
                  )}
                  {/* O nome cresce para ocupar a sobra, então não resta espaço
                      livre para nenhum `ml-auto` distribuir — é isso que mantém
                      a coluna de datas alinhada. O selo fica dentro do grupo
                      para continuar colado ao nome. */}
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {domains.has(repo.fullName) ? (
                      // Duas linhas: lado a lado, nome e domínio disputavam a
                      // mesma largura e os dois saíam cortados.
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{repo.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {domains.get(repo.fullName)}
                        </span>
                      </span>
                    ) : (
                      <>
                        <span className="truncate">{repo.name}</span>
                        {configured.has(repo.fullName) && (
                          <Badge variant="secondary" className="shrink-0">
                            configurado
                          </Badge>
                        )}
                      </>
                    )}
                  </span>
                  {/* `CommandShortcut` em vez de um span solto: o próprio
                      CommandItem acrescenta um check final com `ml-auto`, e
                      dois `ml-auto` na mesma linha rachavam a sobra ao meio —
                      a data andava conforme o tamanho do nome. Este slot
                      esconde aquele check, que já era redundante com o da
                      esquerda. */}
                  <CommandShortcut className="tracking-normal">
                    {relativeTime(repo.updatedAt)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
