import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/lib/api";
import { deployApi, type RepoOption } from "@/lib/api/deploy";
import { linkExistingSite, type LinkState } from "@/lib/api/generations";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { projectIdentity } from "@/lib/format";
import { RepositoryPicker } from "@/features/deploy/repository-picker";
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
import { cn } from "@/lib/utils";

const ESTADOS: Array<{ value: LinkState; title: string; hint: string }> = [
  {
    value: "ready",
    title: "Pronto para aprovação",
    hint: "O cliente ainda não viu. O próximo passo é publicar a prévia e enviar o link.",
  },
  {
    value: "delivered",
    title: "Já enviado ao cliente",
    hint: "O cliente já recebeu um link por fora. O próximo passo é publicar no domínio.",
  },
  {
    value: "live",
    title: "Já está no ar",
    hint: "Publicado no domínio do cliente. Exige o repositório que publica o site.",
  },
];

const semRepositorios = new Set<string>();
const semDominios = new Map<string, string>();

/**
 * Liga a um projeto do Drive um site feito fora do painel — no Lovable sem o
 * "Gerar", ou em qualquer repositório da organização. Daí em diante ele segue
 * o mesmo caminho dos gerados: prévia na área de aprovação, envio ao cliente
 * e publicação no domínio.
 */
export function LinkSiteDialog({
  project,
  approvalAreaReady,
  onOpenChange,
  onLinked,
}: {
  project: Project | null;
  approvalAreaReady: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => Promise<unknown> | void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {project && (
          <LinkSiteForm
            key={project.id}
            project={project}
            approvalAreaReady={approvalAreaReady}
            onCancel={() => onOpenChange(false)}
            onDone={async () => {
              onOpenChange(false);
              await onLinked();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkSiteForm({
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
  const meta = projectIdentity(project);

  const [lovable, setLovable] = useState("");
  const [repo, setRepo] = useState<RepoOption | undefined>();
  const [estado, setEstado] = useState<LinkState>("ready");
  const [dominio, setDominio] = useState(project.domain ?? "");
  const [previa, setPrevia] = useState(approvalAreaReady && podePublicar);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const repos = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: () => deployApi.listRepos(),
    staleTime: 60_000,
  });

  const temOrigem = Boolean(lovable.trim() || repo);
  // Prévia só faz sentido antes de o cliente ver o site.
  const oferecePrevia = estado === "ready";
  const faltaRepoNoAr = estado === "live" && !repo;
  const podeVincular = temOrigem && !faltaRepoNoAr && (estado !== "live" || dominio.trim()) && !enviando;

  const vincular = async (event: FormEvent) => {
    event.preventDefault();
    if (!podeVincular) return;
    setEnviando(true);
    setErro(null);
    try {
      const { warning } = await linkExistingSite(project.id, {
        lovable: lovable.trim() || undefined,
        repoFullName: repo?.fullName,
        state: estado,
        domain: estado === "live" ? dominio.trim() : undefined,
        publishApproval: oferecePrevia && previa,
      });
      toast.success(`Site vinculado a ${meta.label}`, {
        description:
          oferecePrevia && previa && !warning
            ? "A prévia está sendo publicada na área de aprovação — o andamento aparece no card."
            : undefined,
      });
      if (warning) toast.warning("A prévia não foi publicada", { description: warning, duration: 12_000 });
      await onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível vincular o site.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={vincular} className="contents">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="size-4" />
          Vincular site existente
        </DialogTitle>
        <DialogDescription>
          Para um site de <b className="font-medium text-foreground">{meta.label}</b> feito fora do painel. Informe o
          projeto no Lovable, o repositório no GitHub, ou os dois.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="vincular-lovable">Projeto no Lovable</Label>
          <Input
            id="vincular-lovable"
            value={lovable}
            onChange={(event) => setLovable(event.target.value)}
            placeholder="https://lovable.dev/projects/…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Opcional. O link do editor do projeto. Sem ele, o site é tratado como de fora do Lovable.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vincular-repo">Repositório no GitHub</Label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <RepositoryPicker
                id="vincular-repo"
                repos={repos.data ?? []}
                selected={repo}
                loading={repos.isPending}
                configured={semRepositorios}
                domains={semDominios}
                onSelect={setRepo}
              />
            </div>
            {repo && (
              <Button type="button" variant="ghost" size="icon" onClick={() => setRepo(undefined)} aria-label="Tirar o repositório">
                <X />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {repos.error
              ? "Não foi possível listar os repositórios — confira o GitHub em Configurações."
              : "Da organização configurada. Site de Lovable conectado ao GitHub pode ficar sem: o painel o acha pelo nome. Site HTML sem build também funciona."}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Em que etapa o site está</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ESTADOS.map((opcao) => (
              <button
                key={opcao.value}
                type="button"
                aria-pressed={estado === opcao.value}
                onClick={() => setEstado(opcao.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  estado === opcao.value
                    ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                    : "hover:bg-accent",
                )}
              >
                <span className="block text-sm font-medium">{opcao.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{opcao.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {estado === "live" && (
          <div className="space-y-1.5">
            <Label htmlFor="vincular-dominio">Domínio em que o site está no ar</Label>
            <Input
              id="vincular-dominio"
              value={dominio}
              onChange={(event) => setDominio(event.target.value)}
              placeholder="cliente.com.br"
              autoComplete="off"
              spellCheck={false}
            />
            {faltaRepoNoAr && (
              <p className="text-xs text-warning">Escolha o repositório que publica neste domínio.</p>
            )}
          </div>
        )}

        {oferecePrevia && (
          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox
              id="vincular-previa"
              className="mt-0.5"
              checked={previa}
              disabled={!approvalAreaReady || !podePublicar}
              onCheckedChange={(marcado) => setPrevia(marcado === true)}
            />
            <Label htmlFor="vincular-previa" className="flex-col items-start gap-0.5">
              <span className="text-sm font-medium">Publicar a prévia agora na área de aprovação</span>
              <span className="text-xs leading-snug font-normal text-muted-foreground">
                {!approvalAreaReady
                  ? "A área de aprovação não está configurada (Configurações → Área de aprovação)."
                  : !podePublicar
                    ? "Esta chave de acesso não tem permissão para publicar."
                    : "O painel grava o workflow no repositório e publica numa pasta do link de aprovação."}
              </span>
            </Label>
          </div>
        )}

        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!podeVincular}>
          {enviando ? <Loader2 className="animate-spin" /> : <Link2 />}
          Vincular site
        </Button>
      </DialogFooter>
    </form>
  );
}
