import type { BuildFile } from "@/lib/api";
import { thumbnailUrl } from "@/lib/api";
import { formatBytes, kindLabels } from "@/lib/format";
import { FileIcon } from "@/components/file-icon";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Uma linha da lista de anexos: marcar, ver o que é e por que não pode ir. */
export function AttachmentRow({
  file,
  checked,
  onToggle,
}: {
  file: BuildFile;
  checked: boolean;
  onToggle: () => void;
}) {
  const disabled = Boolean(file.blockedReason);

  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-1.5 transition",
        disabled
          ? "cursor-not-allowed opacity-55"
          : "cursor-pointer hover:bg-muted/60",
      )}
      title={file.blockedReason ?? file.attachWarning ?? file.name}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
      />

      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40">
        {file.hasThumbnail ? (
          <img
            src={thumbnailUrl(file.id, 80)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <FileIcon kind={file.kind} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {file.folder ? `${file.folder} · ` : ""}
          {kindLabels[file.kind]}
          {file.size !== null && ` · ${formatBytes(file.size)}`}
        </p>
        {/* Ressalva do tipo: o arquivo sobe, mas o aproveitamento pelo modelo
            não foi possível confirmar sem gastar crédito. Melhor dizer isso
            do que bloquear — ou do que prometer. */}
        {file.attachWarning && !disabled && (
          <p className="truncate text-xs text-warning">
            {file.attachWarning}
          </p>
        )}
      </div>

      {file.isBrief && (
        <Badge variant="secondary" className="shrink-0 font-normal">
          já está no prompt
        </Badge>
      )}
      {file.exportedToPdf && !file.isBrief && (
        <Badge variant="outline" className="shrink-0 font-normal">
          vira PDF
        </Badge>
      )}
      {disabled && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {file.blockedReason}
        </span>
      )}
    </label>
  );
}
