import { useState } from "react";
import { ExternalLink, Loader2, MessageSquareReply } from "lucide-react";
import { toast } from "sonner";
import type { Generation, Project } from "@/lib/api";
import { replyToAgent } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { latestGeneration } from "@/features/projects/project-status";
import { lovableEditorUrl } from "@/features/projects/next-step";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { noPermission } from "@/lib/permissions";
import { usePermissions } from "@/lib/permissions";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
  const { can } = usePermissions();
  const site = latestGeneration(project);
  const editor = lovableEditorUrl(project);
  const [message, setMessage] = useState("Pode seguir.");
  const [sending, setSending] = useState(false);

  // Por que "Enviar resposta" não está livre, escrito no rodapé. A permissão é
  // a mesma que o servidor exige para responder.
  const motivo = !can("gerar")
    ? noPermission.gerar
    : !site?.id
      ? "O painel não tem o projeto do Lovable deste site: responda pelo editor do Lovable."
      : !message.trim()
        ? "Escreva a resposta ao agente."
        : null;

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
        {/* O editor fica a um clique, para quando a pergunta pede mais do que
            uma linha — fora do rodapé, que é só de responder ou desistir. */}
        {editor && (
          <a
            href={editor}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3" />
            Ver a conversa no Lovable
          </a>
        )}

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

      <DialogFooter>
        {motivo && <Reason className="sm:mr-auto">{motivo}</Reason>}
        <DialogClose asChild>
          <Button variant="outline" disabled={sending}>
            Cancelar
          </Button>
        </DialogClose>
        <DisabledHint reason={motivo}>
          <Button disabled={sending || Boolean(motivo)} onClick={() => void send()}>
            {sending ? <Loader2 className="animate-spin" /> : <MessageSquareReply />}
            Enviar resposta
          </Button>
        </DisabledHint>
      </DialogFooter>
    </>
  );
}
