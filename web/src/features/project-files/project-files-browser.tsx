import { useMemo, useState } from "react";
import { Segmented } from "@/components/segmented";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
} from "lucide-react";
import type { DriveFile, Generation, Project } from "@/lib/api";
import { fetchFolderFiles } from "@/lib/api";
import { formatBytes, projectIdentity } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import type { TagsController } from "@/features/tags/use-tags";
import type { ProjectActionHandlers } from "@/features/projects/project-actions";
import { ClientLink } from "@/features/project-files/client-link";
import { FilePreviewDialog } from "@/features/project-files/file-preview-dialog";
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
import { cn } from "@/lib/utils";
import { EmptyState, FileCard, FileTable } from "./file-list";
import {
  fileSortLabels,
  sortFiles,
  totalBytes,
  type FileSort,
} from "./file-sorting";
import { ProjectFilesHeader, type Crumb } from "./project-files-header";

/**
 * Navegação pelos arquivos de um projeto.
 *
 * Montado com `key={project.id}`: trocar de projeto monta outro navegador, com
 * a trilha já começando na pasta certa. Antes um `useEffect` reiniciava a
 * trilha depois da renderização, e a lista do projeto anterior aparecia por um
 * instante dentro do novo.
 */
export function ProjectFilesBrowser({
  project,
  tags,
  focusShareInput,
  actions,
  onTagsChange,
  onGenerationChange,
}: {
  project: Project;
  tags: TagsController;
  focusShareInput: boolean;
  actions: ProjectActionHandlers;
  onTagsChange: (project: Project, tagIds: string[]) => void;
  onGenerationChange: (project: Project, generation: Generation) => void;
}) {
  const queryClient = useQueryClient();
  const [trail, setTrail] = useState<Crumb[]>(() => [
    { id: project.id, name: projectIdentity(project).label },
  ]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FileSort>("name");
  const [asc, setAsc] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const current = trail.at(-1) ?? { id: project.id, name: "" };
  /** A geração mais recente é a que vai ao cliente; as antigas ficam na lista. */
  const site = project.generations.at(-1);

  const {
    data: files = [],
    isPending,
    isFetching,
    error,
  } = useQuery({
    queryKey: queryKeys.folderFiles(current.id),
    queryFn: async () => (await fetchFolderFiles(current.id)).files,
  });

  /** Recarregar manda a API reler o Drive, e não só o cache do painel. */
  const reload = () =>
    queryClient.fetchQuery({
      queryKey: queryKeys.folderFiles(current.id),
      queryFn: async () => (await fetchFolderFiles(current.id, true)).files,
      staleTime: 0,
    });

  const visible = useMemo(
    () => sortFiles(files, { query, sort, asc }),
    [files, query, sort, asc],
  );

  const previewable = useMemo(
    () => visible.filter((file) => file.kind !== "folder"),
    [visible],
  );
  const previewIndex = previewable.findIndex((file) => file.id === previewId);
  const previewFile = previewIndex >= 0 ? previewable[previewIndex] : null;

  const openItem = (file: DriveFile) => {
    if (file.kind === "folder") {
      setTrail((prev) => [...prev, { id: file.id, name: file.name }]);
      setQuery("");
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
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar arquivo..."
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
          title="Recarregar"
        >
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isPending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-44 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title="Não foi possível carregar"
            description={(error as Error).message}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nenhum arquivo aqui"
            description={
              query
                ? "Nenhum resultado para a busca."
                : "Esta pasta está vazia no Drive."
            }
          />
        ) : view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {visible.map((file) => (
              <FileCard key={file.id} file={file} onOpen={openItem} />
            ))}
          </div>
        ) : (
          <FileTable files={visible} onOpen={openItem} />
        )}
      </div>

      <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
        <span>
          {visible.length} {visible.length === 1 ? "item" : "itens"}
          {query ? ` de ${files.length}` : ""}
        </span>
        <span>{formatBytes(totalBytes(visible))}</span>
      </div>

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
