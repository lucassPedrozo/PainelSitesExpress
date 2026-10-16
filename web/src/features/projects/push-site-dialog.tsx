import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileArchive, FolderUp, Loader2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  deleteProjectFile,
  fetchSiteSources,
  pushSiteToGitHub,
  type Project,
  type SiteSource,
} from "@/lib/api";
import { formatBytes, pluralize, projectIdentity } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { itemsFromInput, uploadItems } from "@/features/project-files/upload";
import { Reason } from "@/components/disabled-hint";
import { noPermission } from "./project-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A pasta do projeto que recebe o site enviado por este diálogo. */
const SITE_FOLDER = "site";

const sourceLabel = (source: SiteSource) =>
  source.type === "zip"
    ? source.path
    : source.path
      ? `Pasta ${source.path}`
      : "Todos os arquivos do projeto";

/**
 * Manda ao GitHub o site de um projeto criado no painel: o código sobe para os
 * arquivos do projeto (uma pasta ou um .zip), o painel cria o repositório na
 * organização e grava tudo num commit. Daí em diante vale o caminho de sempre —
 * prévia na área de aprovação, envio ao cliente e publicação no domínio.
 */
export function PushSiteDialog({
  project,
  approvalAreaReady,
  onOpenChange,
  onPushed,
}: {
  project: Project | null;
  approvalAreaReady: boolean;
  onOpenChange: (open: boolean) => void;
  onPushed: () => Promise<unknown> | void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="sm:max-w-xl">
        {project && (
          <PushSiteForm
            key={project.id}
            project={project}
            approvalAreaReady={approvalAreaReady}
            onCancel={() => onOpenChange(false)}
            onDone={async () => {
              onOpenChange(false);
              await onPushed();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PushSiteForm({
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
  const queryClient = useQueryClient();
  const meta = projectIdentity(project);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const info = useQuery({
    queryKey: queryKeys.siteSources(project.id),
    queryFn: () => fetchSiteSources(project.id),
    staleTime: 0,
  });

  const [chosen, setChosen] = useState<string | null>(null);
  const [repoName, setRepoName] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(true);
  const [preview, setPreview] = useState(approvalAreaReady);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = info.data?.sources ?? [];
  const known = info.data?.repoFullName ?? null;
  // Sem escolha feita, vale a primeira origem — quase sempre a única.
  const source = sources.find((item) => item.path === chosen) ?? sources[0] ?? null;
  const name = repoName ?? info.data?.suggestedRepoName ?? "";
  const site = project.generations.at(-1);
  const inApprovalArea = Boolean(site?.devArea?.repoFullName && site.devArea.state !== "retired");
  const canOrganize = can("organizar");
  const busy = sending || Boolean(upload);
  const nameValid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name.trim());
  /** Site do motor Claude: enviado como está, não constrói no GitHub. */
  const engineSite = info.data?.engineSite === true;
  // O servidor exige `publicar` para criar ou atualizar o repositório: a
  // tela confere antes, em vez de deixar a pessoa preencher e levar um 403.
  const canPublish = can("publicar");
  const ready = Boolean(source) && (known || nameValid) && !busy && !engineSite && canPublish;
  const falta = !canPublish
    ? noPermission.publicar
    : !source && !info.isPending
      ? "Envie a pasta ou o .zip do site para escolher de onde ele vem."
      : !known && !nameValid
        ? "O nome do repositório tem só letras, números, ponto, hífen e sublinhado."
        : null;

  /** Sobe o código e relê as origens; a recém-enviada fica escolhida. */
  const receive = async (files: FileList | null, kind: "folder" | "zip") => {
    if (!files?.length) return;
    setError(null);
    try {
      if (kind === "zip") {
        const zip = files[0];
        await uploadItems(project.id, "", [{ path: zip.name, file: zip }], (done, total) =>
          setUpload({ done, total }),
        );
        setChosen(zip.name);
      } else {
        const items = itemsFromInput(files, { dropTopFolder: true });
        if (!items.length) throw new Error("A pasta escolhida não tem arquivos para enviar.");
        // Uma versão nova do site substitui a anterior: sem apagar antes, um
        // arquivo removido do projeto continuaria indo ao repositório.
        await deleteProjectFile(project.id, SITE_FOLDER);
        await uploadItems(project.id, SITE_FOLDER, items, (done, total) => setUpload({ done, total }));
        setChosen(SITE_FOLDER);
      }
      await info.refetch();
      void queryClient.invalidateQueries({ queryKey: ["folder-files"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar os arquivos.");
    } finally {
      setUpload(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !source) return;
    setSending(true);
    setError(null);
    try {
      const result = await pushSiteToGitHub(project.id, {
        sourcePath: source.path,
        repoName: known ? undefined : name.trim(),
        private: isPrivate,
        publishPreview: preview && approvalAreaReady && !inApprovalArea,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.repositories });

      const { repository, commit, warning } = result;
      toast.success(
        repository.created
          ? `Repositório ${repository.fullName} criado`
          : commit.changed
            ? `${repository.fullName} atualizado`
            : `${repository.fullName} já estava com esta versão`,
        {
          description: !commit.changed
            ? "Nenhum arquivo mudou; nada foi gravado."
            : result.generation?.devArea?.state === "publishing"
              ? `${pluralize(commit.files, "arquivo")} no repositório. A prévia está sendo publicada — o andamento aparece no card.`
              : `${pluralize(commit.files, "arquivo")} no repositório.`,
        },
      );
      if (warning) toast.warning("A prévia não foi publicada", { description: warning, duration: 12_000 });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o site ao GitHub.");
      // O repositório pode ter sido criado antes da falha: a lista diz.
      void info.refetch();
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Upload className="size-4" />
          {known ? "Atualizar o site no GitHub" : "Enviar site ao GitHub"}
        </DialogTitle>
        <DialogDescription>
          O código de <b className="font-medium text-foreground">{meta.label}</b> vai para um repositório da
          organização, num commit só. Depois é publicar a prévia e o domínio, como qualquer site do painel.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">1 · Código do site</legend>

          {info.isPending ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : info.error ? (
            <p className="text-sm text-destructive">{(info.error as Error).message}</p>
          ) : sources.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              O projeto ainda não tem o código de um site. Envie a pasta do projeto (a que tem o{" "}
              <code className="text-xs">package.json</code> ou o <code className="text-xs">index.html</code>) ou um
              .zip com ela.
            </p>
          ) : (
            <div className="space-y-2">
              {sources.map((item) => {
                const on = item.path === source?.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => setChosen(item.path)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      on ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-accent",
                    )}
                  >
                    {item.type === "zip" ? (
                      <FileArchive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{sourceLabel(item)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {pluralize(item.fileCount, "arquivo")} · {formatBytes(item.totalBytes)} ·{" "}
                        {item.kind === "build" ? "com build (package.json)" : "HTML pronto, sem build"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {source && (source.skipped.length > 0 || source.warnings.length > 0) && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {source.skipped.length > 0 && (
                <p>
                  Ficam de fora:{" "}
                  {source.skipped.map((item) => `${item.reason} (${item.count})`).join("; ")}.
                </p>
              )}
              {source.warnings.map((warning) => (
                <p key={warning} className="flex items-start gap-1.5 text-warning">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  {warning}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !canOrganize}
              onClick={() => folderInput.current?.click()}
              title="Escolha a pasta do projeto no computador. Ela substitui a pasta “site” deste projeto; node_modules e .git não são enviados."
            >
              <FolderUp />
              Enviar a pasta do site
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !canOrganize}
              onClick={() => zipInput.current?.click()}
            >
              <FileArchive />
              Enviar um .zip
            </Button>
            {!canOrganize && <Reason className="basis-full">{noPermission.organizar} Enviar arquivos ao projeto fica desligado.</Reason>}
            {upload && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Loader2 className="size-3 animate-spin" />
                Guardando {upload.done} de {pluralize(upload.total, "arquivo")}…
              </span>
            )}
          </div>
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            // Atributo fora do padrão, mas é o que todo navegador usa para escolher pasta.
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(event) => {
              const { files } = event.target;
              void receive(files, "folder").finally(() => {
                event.target.value = "";
              });
            }}
          />
          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const { files } = event.target;
              void receive(files, "zip").finally(() => {
                event.target.value = "";
              });
            }}
          />
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="enviar-site-repo" className="text-sm font-medium">
            2 · Repositório
          </Label>
          {known ? (
            <p className="text-sm text-muted-foreground">
              O site deste projeto já está em <b className="font-medium text-foreground">{known}</b>. O envio grava uma
              versão nova nele — só o que mudou —, e o que já publica (prévia ou domínio) publica de novo sozinho.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">
                  {info.data?.organization ?? "organização"} /
                </span>
                <Input
                  id="enviar-site-repo"
                  value={name}
                  onChange={(event) => setRepoName(event.target.value)}
                  placeholder="nome-do-repositorio"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={name.trim() !== "" && !nameValid}
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="enviar-site-privado"
                  checked={isPrivate}
                  onCheckedChange={(checked) => setIsPrivate(checked === true)}
                />
                <Label htmlFor="enviar-site-privado" className="text-sm font-normal">
                  Repositório privado
                </Label>
              </div>
            </>
          )}
        </div>

        {!inApprovalArea && (
          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox
              id="enviar-site-previa"
              className="mt-0.5"
              checked={preview && approvalAreaReady}
              disabled={!approvalAreaReady}
              onCheckedChange={(checked) => setPreview(checked === true)}
            />
            <Label htmlFor="enviar-site-previa" className="flex-col items-start gap-0.5">
              <span className="text-sm font-medium">Publicar a prévia na área de aprovação</span>
              <span className="text-xs leading-snug font-normal text-muted-foreground">
                {approvalAreaReady
                  ? "Logo depois do envio, o painel publica o site numa pasta do link de aprovação — é o link que vai ao cliente."
                  : "A área de aprovação não está configurada (Configurações → Área de aprovação)."}
              </span>
            </Label>
          </div>
        )}

        {engineSite && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              Esta pasta é de um site feito com o Joinvixable. Enviada como está, ela não constrói no GitHub: o
              site não declara as dependências dele. Feche esta janela, abra o projeto na aba <b>Claude</b> e
              use <b>Trazer para o motor Claude</b>; o envio de lá leva a configuração certa.
            </span>
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogBody>

      <DialogFooter>
        {falta && !engineSite && <Reason className="sm:mr-auto">{falta}</Reason>}
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!ready}>
          {sending ? <Loader2 className="animate-spin" /> : <Upload />}
          {sending ? "Enviando ao GitHub…" : known ? "Atualizar repositório" : "Criar repositório e enviar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
