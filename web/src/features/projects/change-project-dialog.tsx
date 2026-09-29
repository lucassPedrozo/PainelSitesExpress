import { useState, type FormEvent } from "react";
import { Loader2, Replace } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/lib/api";
import { changeLovableProject } from "@/lib/api/generations";
import { usePermissions } from "@/lib/permissions";
import { projectIdentity } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { isExternalSite, latestGeneration } from "./project-status";

/**
 * Troca o projeto do Lovable do site — o cliente pediu mudanças e o site foi
 * refeito num projeto novo. O link que o cliente já recebeu e a pasta de
 * aprovação continuam; o que era do projeto antigo é zerado.
 */
export function ChangeProjectDialog({
  project,
  approvalAreaReady,
  onOpenChange,
  onChanged,
}: {
  project: Project | null;
  approvalAreaReady: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<unknown> | void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {project && (
          <ChangeProjectForm
            key={project.id}
            project={project}
            approvalAreaReady={approvalAreaReady}
            onCancel={() => onOpenChange(false)}
            onDone={async () => {
              onOpenChange(false);
              await onChanged();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangeProjectForm({
  project,
  approvalAreaReady,
  onCancel,
  onDone,
}: {
  project: Project;
  approvalAreaReady: boolean;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const { can } = usePermissions();
  const podePublicar = can("publicar");
  const site = latestGeneration(project);
  const meta = projectIdentity(project);
  const externo = isExternalSite(site);

  const [lovable, setLovable] = useState("");
  const [previa, setPrevia] = useState(approvalAreaReady && podePublicar);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!site?.id) return null;

  const trocar = async (event: FormEvent) => {
    event.preventDefault();
    if (!lovable.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const { warning } = await changeLovableProject(project.id, site.id!, {
        lovable: lovable.trim(),
        publishApproval: approvalAreaReady && previa,
      });
      toast.success(`Projeto do Lovable trocado em ${meta.label}`, {
        description:
          approvalAreaReady && previa && !warning
            ? "A prévia do projeto novo está sendo publicada na mesma pasta."
            : "Confira o site novo e envie de novo ao cliente — o link dele não muda.",
      });
      if (warning) toast.warning("Atenção", { description: warning, duration: 12_000 });
      await onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível trocar o projeto.");
    } finally {
      setEnviando(false);
    }
  };

  const atual = site.lovableName ?? (externo ? "site de fora do Lovable" : site.id);

  return (
    <form onSubmit={trocar} className="contents">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Replace className="size-4" />
          {externo ? "Definir o projeto do Lovable" : "Trocar o projeto do Lovable"}
        </DialogTitle>
        <DialogDescription>
          Para quando o site de <b className="font-medium text-foreground">{meta.label}</b> foi refeito num projeto
          novo. Hoje: <span className="font-medium text-foreground">{atual}</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="trocar-lovable">Projeto novo no Lovable</Label>
          <Input
            id="trocar-lovable"
            value={lovable}
            onChange={(event) => setLovable(event.target.value)}
            placeholder="https://lovable.dev/projects/…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>

        <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <li>
            <b className="font-medium text-foreground">Continua:</b> o link que o cliente já recebeu e a pasta da
            prévia na área de aprovação.
          </li>
          <li>
            <b className="font-medium text-foreground">Recomeça:</b> o Share preview, o repositório e a marcação de
            enviado — o site novo precisa ser conferido e enviado de novo.
          </li>
          <li>
            O repositório antigo deixa de publicar na prévia. A publicação no domínio do cliente não muda: troque o
            repositório no Deploy quando o site novo for aprovado.
          </li>
        </ul>

        <div className="flex items-start gap-2 rounded-lg border p-3">
          <Checkbox
            id="trocar-previa"
            className="mt-0.5"
            checked={approvalAreaReady && previa}
            disabled={!approvalAreaReady || !podePublicar}
            onCheckedChange={(marcado) => setPrevia(marcado === true)}
          />
          <Label htmlFor="trocar-previa" className="flex-col items-start gap-0.5">
            <span className="text-sm font-medium">Publicar a prévia do projeto novo agora</span>
            <span className="text-xs leading-snug font-normal text-muted-foreground">
              {!approvalAreaReady
                ? "A área de aprovação não está configurada (Configurações → Área de aprovação)."
                : !podePublicar
                  ? "Esta chave de acesso não tem permissão para publicar."
                  : "Exige o projeto novo conectado ao GitHub da organização, no Lovable."}
            </span>
          </Label>
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!lovable.trim() || enviando}>
          {enviando ? <Loader2 className="animate-spin" /> : <Replace />}
          Trocar projeto
        </Button>
      </DialogFooter>
    </form>
  );
}
