import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Project, ProjectBrief } from "@/lib/api";
import { fetchProjectBrief } from "@/lib/api";
import { pluralize, projectIdentity } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { queryKeys } from "@/lib/query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OtherBriefsNotice } from "./other-briefs-notice";

/**
 * Busca o briefing uma vez e reaproveita o texto entre copiar, visualizar e o
 * Resumo do projeto, que o mostra pela mesma chave de consulta.
 */
function useBrief(project: Project) {
  const queryClient = useQueryClient();
  const [brief, setBrief] = useState<ProjectBrief | null>(
    () => queryClient.getQueryData<ProjectBrief>(queryKeys.brief(project.id)) ?? null,
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (brief) return brief;
    setLoading(true);
    try {
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.brief(project.id),
        queryFn: () => fetchProjectBrief(project.id),
        staleTime: 5 * 60_000,
      });
      setBrief(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [brief, project.id, queryClient]);

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
        description: `${pluralize(data.text.length, "caractere")} de “${data.file.name}”`,
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
      title={title ?? (project.brief?.name ? `Copiar o conteúdo de “${project.brief.name}”` : "Copiar o prompt")}
    >
      {loading ? <Loader2 className="animate-spin" /> : copied ? <Check /> : <Copy />}
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
        <Eye />
        Ver prompt
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent layout="sectioned" className="h-dialog-tall sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Prompt de {label}</DialogTitle>
            <DialogDescription className="truncate">
              {brief ? `${brief.file.name} · ${pluralize(brief.text.length, "caractere")}` : "Lendo o briefing no Drive…"}
            </DialogDescription>
            {brief && <OtherBriefsNotice others={brief.others} />}
          </DialogHeader>

          <DialogBody className="bg-muted/40">
            {loading || !brief ? (
              <div className="flex h-full items-center justify-center" aria-busy="true" aria-label="Carregando o briefing">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">{brief.text}</pre>
            )}
          </DialogBody>

          <DialogFooter>
            {brief && (
              <Button asChild variant="ghost" className="sm:mr-auto">
                <a href={brief.file.webViewLink} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Abrir no Drive
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button disabled={!brief} onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copiado" : "Copiar prompt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
