import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { DriveFile } from "@/lib/api";
import { thumbnailUrl } from "@/lib/api";
import { formatBytes, formatDateTime, kindLabels } from "@/lib/format";
import { FileIcon } from "@/components/file-icon";

/** As duas formas de ver os arquivos de uma pasta: grade e tabela. */

export function FileCard({
  file,
  onOpen,
}: {
  file: DriveFile;
  onOpen: (file: DriveFile) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = file.hasThumbnail && !thumbFailed;

  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition hover:border-foreground/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-muted/50">
        {showThumb ? (
          <img
            src={thumbnailUrl(file.id, 400)}
            alt=""
            loading="lazy"
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
  );
}

export function FileTable({
  files,
  onOpen,
}: {
  files: DriveFile[];
  onOpen: (file: DriveFile) => void;
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
                  <span className="block truncate" title={file.name}>
                    {file.name}
                  </span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <FolderOpen className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
