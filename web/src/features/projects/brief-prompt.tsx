import { useCallback, useState } from "react";
import { Check, Copy, ExternalLink, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Project, ProjectBrief } from "@/lib/api";
import { fetchProjectBrief } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OtherBriefsNotice } from "./other-briefs-notice";
import { cn } from "@/lib/utils";

/** Busca o briefing uma vez e reaproveita o texto entre copiar e visualizar. */
function useBrief(project: Project) {
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (brief) return brief;
    setLoading(true);
    try {
      const data = await fetchProjectBrief(project.id);
      setBrief(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [brief, project.id]);

  return { brief, loading, load };
}

export function CopyBriefButton({
  project,
  variant = "outline",
  size = "sm",
  label = "Copiar prompt",
  className,
  disabled = false,
  title,
}: {
  project: Project;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default";
  label?: string;
  className?: string;
  /** Projeto sem briefing no Drive: o botão fica à vista, mas inerte. */
  disabled?: boolean;
  title?: string;
}) {
  const { loading, load } = useBrief(project);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      const data = await load();
      const ok = await copyToClipboard(data.text);
      if (!ok) throw new Error("O navegador bloqueou o acesso à área de transferência");

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Prompt copiado", {
        description: `${data.text.length.toLocaleString("pt-BR")} caracteres de “${data.file.name}”`,
      });
    } catch (err) {
      toast.error("Não foi possível copiar o prompt", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={loading || disabled}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      title={title ?? `Copiar o conteúdo de “${project.brief?.name}”`}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : copied ? (
        <Check className="size-4" />
      ) : (
        <Copy className="size-4" />
      )}
      {copied ? "Copiado" : label}
    </Button>
  );
}

/** Visualização do prompt antes de levá-lo para o Lovable. */
export function ViewBriefButton({ project }: { project: Project }) {
  const { brief, loading, load } = useBrief(project);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const openDialog = async () => {
    setOpen(true);
    try {
      await load();
    } catch (err) {
      setOpen(false);
      toast.error("Não foi possível ler o briefing", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const copy = async () => {
    if (!brief) return;
    const ok = await copyToClipboard(brief.text);
    if (!ok) return toast.error("O navegador bloqueou a área de transferência");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const label = projectIdentity(project).label;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={loading}
        onClick={(event) => {
          event.stopPropagation();
          void openDialog();
        }}
      >
        <Eye className="size-4" />
        Ver prompt
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent layout="sectioned" className="h-[85vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">Prompt — {label}</DialogTitle>
            <DialogDescription className="truncate">
              {brief ? brief.file.name : "Carregando..."}
            </DialogDescription>
            {brief && <OtherBriefsNotice others={brief.others} />}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-6 py-4">
            {loading || !brief ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">
                {brief.text}
              </pre>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {brief ? `${brief.text.length.toLocaleString("pt-BR")} caracteres` : ""}
            </span>
            <div className="flex items-center gap-2">
              {brief && (
                <Button asChild variant="ghost" size="sm">
                  <a href={brief.file.webViewLink} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Abrir no Drive
                  </a>
                </Button>
              )}
              <Button size="sm" disabled={!brief} onClick={() => void copy()}>
                <span className={cn("contents", copied && "text-current")}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </span>
                {copied ? "Copiado" : "Copiar prompt"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
