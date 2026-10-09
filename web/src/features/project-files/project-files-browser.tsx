import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/components/segmented";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDownAZ,
  ArrowUpAZ,
  Bot,
  Download,
  FolderOpen,
  FolderUp,
  History,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import type { DriveFile, Generation, Project } from "@/lib/api";
import { deleteProjectFile, fetchArchive, fetchFolderFiles, isPanelProject, rawUrl } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { formatBytes, pluralize, projectIdentity } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import type { TagsController } from "@/features/tags/use-tags";
import type { ProjectActionHandlers } from "@/features/projects/project-actions";
import { ProjectTimeline } from "@/features/projects/project-timeline-view";
import { ClaudePanel } from "@/features/claude/claude-panel";
import { ClientLink } from "@/features/project-files/client-link";
import { FilePreviewDialog } from "@/features/project-files/file-preview-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyNotice } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { archiveChildren, archivePath, isZipFile } from "./archive-entries";
import { FileCard, FileTable } from "./file-list";
import {
  fileSortLabels,
  sortFiles,
  totalBytes,
  type FileSort,
} from "./file-sorting";
import { ProjectFilesHeader, type Crumb } from "./project-files-header";
import { itemsFromInput, uploadItems } from "./upload";

/**
 * As faces do modal do projeto: o material, o histórico e o que o motor
 * Claude tem dele (briefing, execução em andamento, site).
 */
export type ProjectTab = "files" | "timeline" | "claude";

/**
 * Navegação pelos arquivos de um projeto, e a linha do tempo dele.
 *
 * Montado com `key={project.id}`: trocar de projeto monta outro navegador, com
 * a trilha já começando na pasta certa. Antes um `useEffect` reiniciava a
 * trilha depois da renderização, e a lista do projeto anterior aparecia por um
 * instante dentro do novo.
 *
 * Um `.zip` abre como pasta: a trilha entra nele, e os itens de dentro usam a
 * mesma grade, a mesma ordenação e a mesma pré-visualização dos arquivos
 * soltos do Drive.
 */
export function ProjectFilesBrowser({
  project,
  tags,
  tab,
  onTabChange,
  focusShareInput,
  actions,
  onTagsChange,
  onGenerationChange,
}: {
  project: Project;
  tags: TagsController;
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  focusShareInput: boolean;
  actions: ProjectActionHandlers;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  onGenerationChange: (project: Project, generation: Generation) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  /** Criado no painel: os arquivos moram aqui, e dá para enviar e apagar. */
  const fromPanel = isPanelProject(project);
  const [trail, setTrail] = useState<Crumb[]>(() => [
    {
      id: project.id,
      name: projectIdentity(project).label,
      localPath: fromPanel ? "" : undefined,
    },
  ]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FileSort>("name");
  const [asc, setAsc] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<DriveFile | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const current: Crumb = trail.at(-1) ?? { id: project.id, name: "" };
  /** Dentro de um `.zip`: qual arquivo do Drive e qual pasta dele. */
  const zip = current.archive;
  const zipName = zip
    ? trail.find((crumb) => crumb.archive?.fileId === zip.fileId)?.name
    : undefined;
  /** A geração mais recente é a que vai ao cliente; as antigas ficam na lista. */
  const site = project.generations.at(-1);

  const folder = useQuery({
    queryKey: queryKeys.folderFiles(current.id),
    queryFn: async () => (await fetchFolderFiles(current.id)).files,
    enabled: !zip,
  });
  // Uma leitura por zip: as subpastas dele saem da mesma lista.
  const archive = useQuery({
    queryKey: queryKeys.archive(zip?.fileId ?? ""),
    queryFn: () => fetchArchive(zip?.fileId ?? ""),
    enabled: Boolean(zip),
  });
  const { isPending, isFetching, error } = zip ? archive : folder;

  const files = useMemo(
    () =>
      zip
        ? archiveChildren(zip.fileId, archive.data?.entries ?? [], zip.prefix)
        : (folder.data ?? []),
    [zip, archive.data, folder.data],
  );

  /** Recarregar manda a API reler o Drive, e não só o cache do painel. */
  const reload = () =>
    zip
      ? queryClient.fetchQuery({
          queryKey: queryKeys.archive(zip.fileId),
          queryFn: () => fetchArchive(zip.fileId, true),
          staleTime: 0,
        })
      : queryClient.fetchQuery({
          queryKey: queryKeys.folderFiles(current.id),
          queryFn: async () => (await fetchFolderFiles(current.id, true)).files,
          staleTime: 0,
        });

  /** Enviar e apagar: só em pasta de projeto do painel, fora de um zip. */
  const editable = fromPanel && !zip && current.localPath !== undefined && can("organizar");

  /** Depois de gravar: a pasta aberta, as contagens do card e as origens do site. */
  const refreshAfterChange = async () => {
    await reload();
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    void queryClient.invalidateQueries({ queryKey: queryKeys.siteSources(project.id) });
  };

  const receive = async (picked: FileList | null) => {
    const items = picked ? itemsFromInput(picked) : [];
    if (!items.length || current.localPath === undefined) return;
    try {
      await uploadItems(project.id, current.localPath, items, (done, total) =>
        setUploading({ done, total }),
      );
      toast.success(`${pluralize(items.length, "arquivo enviado", "arquivos enviados")}`);
    } catch (err) {
      toast.error("O envio parou no meio", {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setUploading(null);
      await refreshAfterChange();
    }
  };

  const remove = async (file: DriveFile) => {
    setRemoving(null);
    if (!file.localPath) return;
    try {
      await deleteProjectFile(project.id, file.localPath);
    } catch (err) {
      toast.error(`Não foi possível apagar ${file.name}`, {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    }
    await refreshAfterChange();
  };

  const visible = useMemo(
    () => sortFiles(files, { query, sort, asc }),
    [files, query, sort, asc],
  );

  // O zip abre como pasta, então também fica fora da passagem por setas.
  const previewable = useMemo(
    () => visible.filter((file) => file.kind !== "folder" && !isZipFile(file)),
    [visible],
  );
  const previewIndex = previewable.findIndex((file) => file.id === previewId);
  const previewFile = previewIndex >= 0 ? previewable[previewIndex] : null;

  const enter = (crumb: Crumb) => {
    setTrail((prev) => [...prev, crumb]);
    setQuery("");
  };

  const openItem = (file: DriveFile) => {
    if (file.kind === "folder") {
      enter({
        id: file.id,
        name: file.name,
        archive: zip && {
          fileId: zip.fileId,
          prefix: archivePath(zip.prefix, file.name),
        },
        localPath: zip ? undefined : file.localPath,
      });
      return;
    }
    if (isZipFile(file)) {
      enter({
        id: `zip:${file.id}`,
        name: file.name,
        archive: { fileId: file.id, prefix: "" },
      });
      return;
    }
    setPreviewId(file.id);
  };

  return (
    <>
      <ProjectFilesHeader
        project={project}
        tags={tags}
        trail={trail}
        onNavigateTo={(index) => setTrail((prev) => prev.slice(0, index + 1))}
        actions={actions}
        onTagsChange={onTagsChange}
        claudeOpen={tab === "claude"}
      />

      {/* O modal é onde o link do cliente cabe: precisa de campo de colar,
          estado e explicação, que não entram no card. */}
      {site?.id && (
        <div className="border-b px-6 py-4">
          <ClientLink
            project={project}
            generation={site}
            focusInput={focusShareInput}
            onUpdated={(atualizada) => onGenerationChange(project, atualizada)}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-6 py-3">
        <Segmented
          label="O que ver do projeto"
          value={tab}
          onChange={onTabChange}
          options={[
            { value: "files", label: "Arquivos", icon: <FolderOpen /> },
            { value: "timeline", label: "Linha do tempo", icon: <History /> },
            { value: "claude", label: "Claude", icon: <Bot /> },
          ]}
        />

        {tab === "files" && (
          <>
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar arquivo..."
                aria-label="Buscar arquivo"
                className="pl-8"
              />
            </div>

            <Select value={sort} onValueChange={(value) => setSort(value as FileSort)}>
              <SelectTrigger className="w-40" aria-label="Ordenar arquivos por">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(fileSortLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setAsc((prev) => !prev)}
              aria-label={asc ? "Ordem crescente — inverter" : "Ordem decrescente — inverter"}
              title={asc ? "Ordem crescente" : "Ordem decrescente"}
            >
              {asc ? (
                <ArrowDownAZ className="size-4" />
              ) : (
                <ArrowUpAZ className="size-4" />
              )}
            </Button>

            <Segmented
              label="Exibição dos arquivos"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", icon: <LayoutGrid />, title: "Grade" },
                { value: "list", icon: <List />, title: "Lista" },
              ]}
            />

            <Button
              variant="outline"
              size="icon"
              disabled={isFetching}
              onClick={() => void reload()}
              aria-label="Recarregar arquivos"
              title="Recarregar"
            >
              <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
            </Button>

            {editable && (
              <>
                <Button
                  variant="outline"
                  disabled={Boolean(uploading)}
                  onClick={() => filesInput.current?.click()}
                  title="Envia arquivos do computador para esta pasta"
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                  {uploading ? `${uploading.done} de ${uploading.total}` : "Enviar arquivos"}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={Boolean(uploading)}
                  onClick={() => folderInput.current?.click()}
                  aria-label="Enviar uma pasta"
                  title="Envia uma pasta inteira, com as subpastas (node_modules e .git ficam de fora)"
                >
                  <FolderUp className="size-4" />
                </Button>
                <input
                  ref={filesInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    const { files: picked } = event.target;
                    void receive(picked).finally(() => {
                      event.target.value = "";
                    });
                  }}
                />
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  hidden
                  // Atributo fora do padrão, mas é o que todo navegador usa para escolher pasta.
                  {...({ webkitdirectory: "" } as Record<string, string>)}
                  onChange={(event) => {
                    const { files: picked } = event.target;
                    void receive(picked).finally(() => {
                      event.target.value = "";
                    });
                  }}
                />
              </>
            )}
          </>
        )}
      </div>

      {tab === "timeline" ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ProjectTimeline project={project} />
        </div>
      ) : tab === "claude" ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ClaudePanel
            project={project}
            onGenerateBriefing={(alvo) => actions.onGenerateWithClaude?.(alvo)}
            onPushSite={(alvo) => actions.onPushClaudeSite?.(alvo)}
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Dentro de um zip: de qual arquivo é a lista, e a saída para tê-lo
                inteiro — o clique no card agora entra nele em vez de baixá-lo. */}
            {zip && (
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Archive className="size-3.5 shrink-0" />
                <p className="min-w-0 flex-1">
                  Conteúdo de <span className="font-medium text-foreground">{zipName}</span>
                  {archive.data && (
                    <>
                      {" · "}
                      {archive.data.truncated
                        ? `os primeiros ${archive.data.entries.length.toLocaleString("pt-BR")} de ${pluralize(archive.data.total, "arquivo")}`
                        : pluralize(archive.data.total, "arquivo")}
                    </>
                  )}
                </p>
                <a
                  href={rawUrl(zip.fileId, true)}
                  download
                  className="inline-flex shrink-0 items-center gap-1 underline underline-offset-2 hover:text-foreground"
                >
                  <Download className="size-3" />
                  Baixar o .zip
                </a>
              </div>
            )}
            {isPending ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-44 rounded-lg" />
                ))}
              </div>
            ) : error ? (
              <EmptyNotice
                className="py-16"
                icon={<FolderOpen />}
                title={zip ? "Não foi possível abrir o .zip" : "Não foi possível carregar os arquivos"}
                description={(error as Error).message}
                action={
                  <Button variant="outline" size="sm" onClick={() => void reload()}>
                    Tentar novamente
                  </Button>
                }
              />
            ) : visible.length === 0 ? (
              <EmptyNotice
                className="py-16"
                icon={<FolderOpen />}
                title={query ? "Nenhum arquivo encontrado" : zip ? "Nada para mostrar" : "Pasta vazia"}
                description={
                  query
                    ? `Nada com “${query}” nesta pasta.`
                    : zip
                      ? "Este .zip não tem arquivos."
                      : fromPanel
                        ? "Nada guardado aqui ainda. Envie arquivos do computador, ou use “Enviar site ao GitHub” para o código de um site."
                        : "Esta pasta está vazia no Drive."
                }
                action={
                  editable && !query ? (
                    <Button variant="outline" size="sm" onClick={() => filesInput.current?.click()}>
                      <Upload />
                      Enviar arquivos
                    </Button>
                  ) : undefined
                }
              />
            ) : view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                {visible.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    onOpen={openItem}
                    onDelete={editable && file.localPath ? setRemoving : undefined}
                  />
                ))}
              </div>
            ) : (
              <FileTable files={visible} onOpen={openItem} onDelete={editable ? setRemoving : undefined} />
            )}
          </div>

          <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
            <span>
              {pluralize(visible.length, "item", "itens")}
              {query ? ` de ${files.length}` : ""}
            </span>
            <span>{formatBytes(totalBytes(visible))}</span>
          </div>
        </>
      )}

      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.kind === "folder"
                ? "A pasta e tudo o que há dentro dela saem do projeto. Não dá para desfazer."
                : "O arquivo sai do projeto. Não dá para desfazer."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) void remove(removing);
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FilePreviewDialog
        file={previewFile}
        onOpenChange={(open) => !open && setPreviewId(null)}
        hasPrev={previewIndex > 0}
        hasNext={previewIndex >= 0 && previewIndex < previewable.length - 1}
        onNavigate={(direction) => {
          const next = previewable[previewIndex + direction];
          if (next) setPreviewId(next.id);
        }}
      />
    </>
  );
}
