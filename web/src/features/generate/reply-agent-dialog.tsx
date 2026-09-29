import { useState } from "react";
import { ExternalLink, Loader2, MessageSquareReply } from "lucide-react";
import { toast } from "sonner";
import type { Generation, Project } from "@/lib/api";
import { replyToAgent } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { latestGeneration } from "@/features/projects/project-status";
import { lovableEditorUrl } from "@/features/projects/next-step";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Responder ao agente que parou esperando alguém — sem abrir o Lovable.
 *
 * O painel já sabia que o agente tinha parado; faltava saber o quê ele
 * perguntou, e responder dali. Na maioria das vezes a resposta é "pode
 * seguir"; quando a pergunta pede mais, o editor continua a um clique.
 */
export function ReplyAgentDialog({
  project,
  onOpenChange,
  onReplied,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onReplied: (project: Project, generation: Generation) => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {project && (
          <ReplyForm
            key={project.id}
            project={project}
            onDone={(generation) => {
              onReplied(project, generation);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReplyForm({
  project,
  onDone,
}: {
  project: Project;
  onDone: (generation: Generation) => void;
}) {
  const site = latestGeneration(project);
  const editor = lovableEditorUrl(project);
  const [message, setMessage] = useState("Pode seguir.");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!site?.id) return;
    requestNotificationPermission();
    setSending(true);
    try {
      const { generation } = await replyToAgent(project.id, site.id, message);
      toast.success("Resposta enviada ao agente", {
        description: "O painel avisa quando ele terminar.",
      });
      onDone(generation);
    } catch (err) {
      toast.error("Não foi possível responder", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Responder ao agente — {projectIdentity(project).label}</DialogTitle>
        <DialogDescription>
          O agente parou esperando uma resposta e não segue sozinho.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="max-h-56 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          {site?.agentQuestion ?? (
            <span className="text-muted-foreground">
              O painel não conseguiu ler a pergunta. Confira no Lovable antes de
              responder.
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-reply">Sua resposta</Label>
          <Textarea
            id="agent-reply"
            value={message}
            rows={3}
            onChange={(event) => setMessage(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            É uma mensagem ao agente: gasta crédito do Lovable.
          </p>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {editor ? (
          <Button asChild variant="outline">
            <a href={editor} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Abrir no Lovable
            </a>
          </Button>
        ) : (
          <span />
        )}
        <Button
          disabled={sending || !message.trim() || !site?.id}
          onClick={() => void send()}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MessageSquareReply className="size-4" />
          )}
          Enviar resposta
        </Button>
      </DialogFooter>
    </>
  );
}
