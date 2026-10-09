import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { DriveFile } from "@/lib/api";
import { fileThumbnailUrl } from "@/lib/api";
import { formatBytes, formatDateTime, kindLabels } from "@/lib/format";
import { FileIcon } from "@/components/file-icon";
import { isZipFile } from "./archive-entries";

/** As duas formas de ver os arquivos de uma pasta: grade e tabela. */

export function FileCard({
  file,
  onOpen,
  onDelete,
}: {
  file: DriveFile;
  onOpen: (file: DriveFile) => void;
  /** Só nos projetos criados no painel: o Drive é somente leitura. */
  onDelete?: (file: DriveFile) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = file.hasThumbnail && !thumbFailed;

  return (
    <div className="group/file relative flex">
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="group flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card text-left transition hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
    >
      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-muted/50">
        {showThumb ? (
          <img
            src={fileThumbnailUrl(file, 400)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="size-full object-cover transition group-hover:scale-[1.03]"
          />
        ) : (
          <FileIcon kind={file.kind} className="size-10 opacity-80" />
        )}
        {file.kind === "folder" && (
          <span className="absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 text-2xs font-medium">
            Pasta
          </span>
        )}
        {/* O zip abre como pasta: o selo diz que o clique entra nele. */}
        {isZipFile(file) && (
          <span className="absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 text-2xs font-medium">
            Ver conteúdo
          </span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center gap-1.5">
          <FileIcon kind={file.kind} className="size-3.5" />
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {file.kind === "folder"
            ? formatDateTime(file.modifiedTime)
            : `${formatBytes(file.size)} · ${formatDateTime(file.modifiedTime)}`}
        </p>
      </div>
    </button>
    {onDelete && (
      // Irmão do card, e não filho: botão dentro de botão não é HTML válido.
      // Aparece ao passar o mouse ou focar; em tela de toque fica à vista.
      <button
        type="button"
        onClick={() => onDelete(file)}
        aria-label={`Apagar ${file.name}`}
        title="Apagar"
        className="absolute top-2 right-2 grid size-7 place-items-center rounded-md border bg-background/90 text-muted-foreground opacity-0 transition outline-none group-hover/file:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    )}
    </div>
  );
}

export function FileTable({
  files,
  onOpen,
  onDelete,
}: {
  files: DriveFile[];
  onOpen: (file: DriveFile) => void;
  onDelete?: (file: DriveFile) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Nome</th>
            <th className="w-32 px-4 py-2 text-left font-medium">Tipo</th>
            <th className="w-28 px-4 py-2 text-right font-medium">Tamanho</th>
            <th className="w-44 px-4 py-2 text-left font-medium">Modificado</th>
            {onDelete && <th className="w-12 px-2 py-2"><span className="sr-only">Apagar</span></th>}
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr
              key={file.id}
              onClick={() => onOpen(file)}
              className="cursor-pointer border-t transition hover:bg-muted/50"
            >
              <td className="max-w-0 px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileIcon kind={file.kind} />
                  <button
                    type="button"
                    className="block max-w-full truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                    title={file.name}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(file);
                    }}
                  >
                    {file.name}
                  </button>
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {kindLabels[file.kind]}
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                {file.kind === "folder" ? "—" : formatBytes(file.size)}
              </td>
              <td className="px-4 py-2 text-muted-foreground tabular-nums">
                {formatDateTime(file.modifiedTime)}
              </td>
              {onDelete && (
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(file);
                    }}
                    aria-label={`Apagar ${file.name}`}
                    title="Apagar"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

