import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { Project } from "@/lib/api";
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

type RenameProjectDialogProps = {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (project: Project, name: string) => Promise<void>;
};

/**
 * O apelido vale só dentro do painel: a pasta no Drive continua com o nome que
 * tem, porque o acesso é somente leitura. Serve para as coletas em que o
 * cliente não informou o domínio no formulário e a pasta nasceu sem nome útil.
 */
export function RenameProjectDialog({
  project,
  onOpenChange,
  onSubmit,
}: RenameProjectDialogProps) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {project && (
          /**
           * A chave reinicia o formulário a cada projeto. Antes um `useEffect`
           * copiava o apelido para o estado depois da renderização — um render
           * a mais, e o campo aparecia vazio por um instante.
           */
          <RenameForm
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  project,
  onOpenChange,
  onSubmit,
}: {
  project: Project;
  onOpenChange: (open: boolean) => void;
  onSubmit: (project: Project, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(project.alias ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(project, name.trim());
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const trimmed = name.trim();
  const unchanged = trimmed === (project.alias ?? "");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Renomear projeto</DialogTitle>
        <DialogDescription>
          O nome vale apenas no painel. A pasta no Drive continua se chamando{" "}
          <b className="break-all">{project.name}</b> — o painel só tem
          permissão de leitura lá.
        </DialogDescription>
      </DialogHeader>

      <form
        id="rename-project-form"
        onSubmit={handleSubmit}
        className="space-y-1.5"
      >
        <Label htmlFor="project-name">Nome no painel</Label>
        <Input
          id="project-name"
          value={name}
          autoFocus
          maxLength={120}
          placeholder="www.cliente.com.br"
          onChange={(event) => setName(event.target.value)}
          aria-describedby="project-name-hint"
        />
        <p id="project-name-hint" className="text-xs text-muted-foreground">
          {trimmed
            ? "Um nome que pareça um domínio também é aproveitado no atalho de publicação."
            : "Deixe em branco para voltar ao nome da pasta do Drive."}
        </p>
      </form>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          form="rename-project-form"
          size="lg"
          disabled={saving || unchanged}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {trimmed ? "Salvar nome" : "Usar o nome da pasta"}
        </Button>
      </DialogFooter>
    </>
  );
}
