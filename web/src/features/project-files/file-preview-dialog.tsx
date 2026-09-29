import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import type { DriveFile } from "@/lib/api";
import { rawUrl } from "@/lib/api";
import { formatBytes, formatDateTime, kindLabels } from "@/lib/format";
import { FileIcon } from "@/components/file-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  file: DriveFile | null;
  onOpenChange: (open: boolean) => void;
  onNavigate?: (direction: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
};

/** Visualização do arquivo dentro do painel, sem sair para o Drive. */
export function FilePreviewDialog({
  file,
  onOpenChange,
  onNavigate,
  hasPrev,
  hasNext,
}: Props) {
  useEffect(() => {
    if (!file || !onNavigate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && hasNext) onNavigate(1);
      if (event.key === "ArrowLeft" && hasPrev) onNavigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, hasNext, hasPrev, onNavigate]);

  return (
    <Dialog open={Boolean(file)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="h-[92vh] max-w-[min(1200px,95vw)] sm:max-w-[min(1200px,95vw)]">
        {file && (
          /* A chave reinicia o indicador de carregamento a cada arquivo: antes
             um efeito o religava depois da troca, e a imagem anterior aparecia
             por um instante como se já fosse a nova. */
          <PreviewFrame
            key={file.id}
            file={file}
            onNavigate={onNavigate}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewFrame({
  file,
  onNavigate,
  hasPrev,
  hasNext,
}: {
  file: DriveFile;
  onNavigate?: (direction: 1 | -1) => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  const [loading, setLoading] = useState(true);

  return (
    <>
      <DialogHeader className="flex-row items-start gap-3">
        <FileIcon kind={file.kind} className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1 space-y-1">
          <DialogTitle className="truncate text-base" title={file.name}>
            {file.name}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Badge variant="secondary">{kindLabels[file.kind]}</Badge>
            <span>{formatBytes(file.size)}</span>
            <span aria-hidden>·</span>
            <span>Modificado em {formatDateTime(file.modifiedTime)}</span>
            {file.width && file.height ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {file.width} × {file.height}px
                </span>
              </>
            ) : null}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" title="Baixar">
            <a href={rawUrl(file.id, true)} download>
              <Download className="size-4" />
            </a>
          </Button>
          <Button asChild variant="ghost" size="icon" title="Abrir no Drive">
            <a href={file.webViewLink} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </DialogHeader>

      <div className="relative flex flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
        {loading && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        )}
        <PreviewBody file={file} onLoaded={() => setLoading(false)} />

        {onNavigate && (
          <>
            <NavButton
              side="left"
              disabled={!hasPrev}
              onClick={() => onNavigate(-1)}
            />
            <NavButton
              side="right"
              disabled={!hasNext}
              onClick={() => onNavigate(1)}
            />
          </>
        )}
      </div>
    </>
  );
}

function PreviewBody({
  file,
  onLoaded,
}: {
  file: DriveFile;
  onLoaded: () => void;
}) {
  const src = rawUrl(file.id);

  if (file.previewKind === "image") {
    return (
      <img
        src={src}
        alt={file.name}
        onLoad={onLoaded}
        onError={onLoaded}
        className="max-h-full max-w-full rounded-md object-contain shadow-sm"
      />
    );
  }

  if (file.previewKind === "pdf" || file.previewKind === "text") {
    return (
      <iframe
        src={file.previewKind === "pdf" ? `${src}#toolbar=1&view=FitH` : src}
        title={file.name}
        onLoad={onLoaded}
        className="size-full rounded-md border bg-background"
      />
    );
  }

  if (file.previewKind === "video") {
    return (
      <video
        src={src}
        controls
        onLoadedData={onLoaded}
        className="max-h-full max-w-full rounded-md"
      />
    );
  }

  if (file.previewKind === "audio") {
    return (
      <audio
        src={src}
        controls
        onLoadedData={onLoaded}
        className="w-full max-w-xl"
      />
    );
  }

  onLoaded();
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <FileIcon kind={file.kind} className="size-10" />
      <p className="text-sm text-muted-foreground">
        Pré-visualização não disponível para este formato.
      </p>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={rawUrl(file.id, true)} download>
            <Download className="size-4" /> Baixar
          </a>
        </Button>
        <Button asChild size="sm">
          <a href={file.webViewLink} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" /> Abrir no Drive
          </a>
        </Button>
      </div>
    </div>
  );
}

function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Button
      variant="secondary"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={side === "left" ? "Arquivo anterior" : "Próximo arquivo"}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full shadow-md ${
        side === "left" ? "left-3" : "right-3"
      } ${disabled ? "opacity-0" : ""}`}
    >
      <Icon className="size-4" />
    </Button>
  );
}
