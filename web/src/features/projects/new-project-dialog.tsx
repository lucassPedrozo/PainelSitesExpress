import { useState, type FormEvent } from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createProject } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Kind = "site" | "files";

const KINDS: Array<{ value: Kind; title: string; hint: string }> = [
  {
    value: "site",
    title: "Site para publicar",
    hint: "Um site já desenvolvido — com o Claude, por exemplo. O painel cria o repositório no GitHub e publica.",
  },
  {
    value: "files",
    title: "Só arquivos",
    hint: "Um lugar para guardar material. Não entra na fila “Fazer agora”.",
  },
];

/**
 * Cria um projeto no painel, sem pasta no Drive: para o site que não nasceu de
 * uma coleta (feito inteiro com o Claude, sem repositório ainda) e para o
 * material que chega por fora do formulário.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe o id do projeto criado — quem chama relê a lista e o abre. */
  onCreated: (projectId: string, kind: Kind) => Promise<unknown> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <NewProjectForm onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function NewProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (projectId: string, kind: Kind) => Promise<unknown> | void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("site");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { project } = await createProject({ name: trimmed, kind });
      toast.success(`Projeto ${project.name} criado`);
      await onCreated(project.id, kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o projeto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FolderPlus className="size-4" />
          Novo projeto
        </DialogTitle>
        <DialogDescription>
          Criado aqui no painel, sem pasta no Drive. Os arquivos ficam guardados no próprio painel.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="novo-projeto-nome">Nome do projeto</Label>
          <Input
            id="novo-projeto-nome"
            value={name}
            autoFocus
            maxLength={120}
            placeholder="cliente.com.br"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            aria-describedby="novo-projeto-nome-dica"
          />
          <p id="novo-projeto-nome-dica" className="text-xs text-muted-foreground">
            De preferência o domínio do site: ele já preenche a publicação e o nome do repositório.
          </p>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Para que serve</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                onClick={() => setKind(option.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  kind === option.value
                    ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                    : "hover:bg-accent",
                )}
              >
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!trimmed || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <FolderPlus />}
          Criar projeto
        </Button>
      </DialogFooter>
    </form>
  );
}
