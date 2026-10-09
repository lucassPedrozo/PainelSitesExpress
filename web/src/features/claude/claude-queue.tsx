import { useMemo, useState } from "react";
import { Bot, ListX, Loader2, Lock, PauseCircle, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ClaudeQueueItem, ClaudeStatus, Project } from "@/lib/api";
import {
  cancelClaudeRun,
  discardInterruptedClaudeRun,
  removeClaudeQueueItem,
  resumeClaudeQueue,
  resumeInterruptedClaudeRun,
} from "@/lib/api";
import { pluralize, projectIdentity } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useNow } from "@/lib/use-now";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyNotice } from "@/components/page-header";
import { formatElapsed } from "@/features/projects/project-progress";
import { claudeStageLabel } from "@/features/projects/project-status";
import { ConfirmClaudeDialog, HintWhenDisabled, NoticeWithAction, RunStatusBadge } from "./claude-shared";
import { errorMessage, requestLabels, semPermissaoDeGerar } from "./claude-text";
import { useClaudeQueueSync, useClaudeRefresh, useClaudeStatus } from "./use-claude";

/**
 * A fila do Claude, do painel inteiro: o que roda agora, o que espera a vez e
 * o que um reinício interrompeu. Uma execução por vez — a assinatura é uma só.
 *
 * O botão só aparece onde o motor está instalado, e leva o número de pedidos
 * pendentes: é ele que diz, de qualquer ponto da lista, que há algo rodando.
 */
export function ClaudeQueueButton({
  projects,
  onOpenProject,
}: {
  projects: Project[];
  /** Abre o projeto na aba do Claude. */
  onOpenProject: (project: Project) => void;
}) {
  const status = useClaudeStatus();
  const [open, setOpen] = useState(false);
  useClaudeQueueSync(status.data);
  if (!status.data?.installed) return null;

  const fila = status.data.queue;
  const pendentes = (fila.running ? 1 : 0) + fila.waiting.length + fila.interrupted.length;
  const atencao = fila.paused || fila.interrupted.length > 0;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          // Quem abre a fila quer o que há agora, não o que havia na última consulta.
          void status.refetch();
        }}
        aria-label={`Fila do Claude: ${pluralize(pendentes, "pedido")}`}
        title={
          fila.paused
            ? "A fila do Claude está pausada desde que o painel reiniciou"
            : "O que o Claude está fazendo agora e o que espera a vez"
        }
      >
        {fila.running ? <Loader2 className="animate-spin text-info" /> : <Bot />}
        <span className="hidden sm:inline">Fila do Claude</span>
        {pendentes > 0 && (
          <Badge variant={atencao ? "warning" : "info"} className="tabular-nums">
            {pendentes}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent layout="sectioned" className="max-h-[88vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Fila do Claude</DialogTitle>
            <DialogDescription>
              Uma execução por vez, na ordem em que os pedidos chegaram. Fechar esta janela ou o navegador
              não interrompe nada.
            </DialogDescription>
          </DialogHeader>
          <QueueBody
            status={status.data}
            projects={projects}
            onOpenProject={(project) => {
              setOpen(false);
              onOpenProject(project);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** O projeto do pedido: o nome, que abre o projeto na aba do Claude. */
function ItemName({
  item,
  project,
  onOpen,
}: {
  item: ClaudeQueueItem;
  project: Project | undefined;
  onOpen: (project: Project) => void;
}) {
  return project ? (
    <button
      type="button"
      className="block max-w-full min-w-0 truncate rounded-sm text-left text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
      onClick={() => onOpen(project)}
      title="Abrir o projeto na aba do Claude"
    >
      {projectIdentity(project).label}
    </button>
  ) : (
    <span className="block min-w-0 truncate text-sm font-medium">{item.slug ?? "Projeto fora da lista"}</span>
  );
}

function QueueBody({
  status,
  projects,
  onOpenProject,
}: {
  status: ClaudeStatus;
  projects: Project[];
  onOpenProject: (project: Project) => void;
}) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const now = useNow();
  const porId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const [working, setWorking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<
    { kind: "cancel" | "resume-queue" } | { kind: "resume" | "discard"; item: ClaudeQueueItem } | null
  >(null);

  const fila = status.queue;
  const podeGerar = can("gerar");
  const semPermissao = podeGerar ? null : semPermissaoDeGerar;
  const desligada = status.generation.enabled ? null : "A geração pelo Claude está desligada neste painel.";

  const agir = async (chave: string, acao: () => Promise<unknown>, ok: string, falha: string) => {
    setWorking(chave);
    try {
      await acao();
      await refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(falha, { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  /** O projeto de um pedido, para o nome e para abri-lo. */
  const projetoDe = (item: ClaudeQueueItem) => (item.projectId ? porId.get(item.projectId) : undefined);

  const vazia = !fila.running && fila.waiting.length === 0 && fila.interrupted.length === 0;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
      {!status.generation.enabled && (
        <Alert variant="warning">
          <Lock />
          <AlertTitle>A geração pelo Claude está desligada neste painel</AlertTitle>
          <AlertDescription>{status.generation.reason}</AlertDescription>
        </Alert>
      )}

      {fila.paused && (
        <NoticeWithAction
          icon={<PauseCircle />}
          title="A fila está pausada"
          action={
            <HintWhenDisabled reason={semPermissao ?? desligada}>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(semPermissao ?? desligada) || working !== null}
                onClick={() => setConfirming({ kind: "resume-queue" })}
              >
                {working === "resume-queue" ? <Loader2 className="animate-spin" /> : <Play />}
                Retomar fila
              </Button>
            </HintWhenDisabled>
          }
        >
          O painel foi reiniciado com pedidos esperando. Eles só voltam a rodar quando alguém retomar.
        </NoticeWithAction>
      )}

      {vazia && (
        <EmptyNotice
          icon={<Bot />}
          title="Nada na fila"
          description="Os pedidos de briefing, de site e de ajuste aparecem aqui enquanto esperam ou rodam."
        />
      )}

      {fila.running && (
        <section aria-labelledby="fila-rodando" className="space-y-2">
          <h3 id="fila-rodando" className="text-xs font-medium text-muted-foreground">
            Rodando agora
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-info/30 bg-info/5 px-3 py-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden />
            <div className="min-w-0 flex-1">
              <ItemName item={fila.running} project={projetoDe(fila.running)} onOpen={onOpenProject} />
              <p className="truncate text-xs text-muted-foreground">
                {requestLabels[fila.running.tipo]}
                {fila.running.etapa && ` · ${claudeStageLabel(fila.running.etapa)}`}
                {fila.running.inicio && ` · há ${formatElapsed(now - Date.parse(fila.running.inicio))}`}
                {fila.running.por && ` · por ${fila.running.por}`}
              </p>
            </div>
            <HintWhenDisabled reason={semPermissao}>
              <Button
                variant="outline"
                size="sm"
                disabled={!podeGerar || working !== null}
                onClick={() => setConfirming({ kind: "cancel" })}
              >
                {working === "cancel" ? <Loader2 className="animate-spin" /> : <Square />}
                Cancelar
              </Button>
            </HintWhenDisabled>
          </div>
        </section>
      )}

      {fila.waiting.length > 0 && (
        <section aria-labelledby="fila-esperando" className="space-y-2">
          <h3 id="fila-esperando" className="text-xs font-medium text-muted-foreground">
            Esperando a vez · {fila.waiting.length}
          </h3>
          <ol className="divide-y rounded-lg border">
            {fila.waiting.map((item, indice) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{indice + 1}º</span>
                <div className="min-w-0 flex-1">
                  <ItemName item={item} project={projetoDe(item)} onOpen={onOpenProject} />
                  <p className="truncate text-xs text-muted-foreground">
                    {requestLabels[item.tipo]}
                    {item.por && ` · por ${item.por}`}
                  </p>
                </div>
                <HintWhenDisabled reason={semPermissao}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!podeGerar || working !== null}
                    onClick={() =>
                      void agir(
                        item.id,
                        () => removeClaudeQueueItem(item.id),
                        "Pedido tirado da fila",
                        "Não foi possível tirar da fila",
                      )
                    }
                  >
                    {working === item.id ? <Loader2 className="animate-spin" /> : <ListX />}
                    Tirar da fila
                  </Button>
                </HintWhenDisabled>
              </li>
            ))}
          </ol>
        </section>
      )}

      {fila.interrupted.length > 0 && (
        <section aria-labelledby="fila-interrompidas" className="space-y-2">
          <h3 id="fila-interrompidas" className="text-xs font-medium text-muted-foreground">
            Interrompidas por um reinício · {fila.interrupted.length}
          </h3>
          <ul className="divide-y rounded-lg border border-warning/30">
            {fila.interrupted.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <PauseCircle className="size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0 flex-1">
                  <ItemName item={item} project={projetoDe(item)} onOpen={onOpenProject} />
                  <p className="truncate text-xs text-muted-foreground">
                    {requestLabels[item.tipo]}
                    {item.por && ` · por ${item.por}`}
                  </p>
                </div>
                <HintWhenDisabled reason={semPermissao}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!podeGerar || working !== null}
                    onClick={() => setConfirming({ kind: "discard", item })}
                  >
                    <Trash2 />
                    Descartar
                  </Button>
                </HintWhenDisabled>
                <HintWhenDisabled reason={semPermissao ?? desligada}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(semPermissao ?? desligada) || working !== null}
                    onClick={() => setConfirming({ kind: "resume", item })}
                  >
                    {working === item.id ? <Loader2 className="animate-spin" /> : <Play />}
                    Retomar
                  </Button>
                </HintWhenDisabled>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fila.last && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          Última execução: <ItemName item={fila.last.item} project={projetoDe(fila.last.item)} onOpen={onOpenProject} /> · {requestLabels[fila.last.item.tipo]}
          <RunStatusBadge status={fila.last.status} />
        </p>
      )}

      <AlertDialog open={confirming?.kind === "cancel"} onOpenChange={(aberto) => !aberto && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a execução do Claude?</AlertDialogTitle>
            <AlertDialogDescription>
              O Claude é interrompido agora, e o que ele já escreveu fica como está. O próximo pedido da fila
              começa em seguida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixar rodando</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void agir("cancel", () => cancelClaudeRun(), "Execução cancelada", "Não foi possível cancelar")}
            >
              Cancelar execução
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming?.kind === "discard"} onOpenChange={(aberto) => !aberto && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar a execução interrompida?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela sai da lista e nada é rodado. O que o Claude já tinha escrito fica como está.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming?.kind !== "discard") return;
                const { item } = confirming;
                void agir(item.id, () => discardInterruptedClaudeRun(item.id), "Execução descartada", "Não foi possível descartar");
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmClaudeDialog
        open={confirming?.kind === "resume-queue"}
        onOpenChange={(aberto) => !aberto && setConfirming(null)}
        title="Retomar a fila do Claude?"
        confirmLabel="Retomar e usar a assinatura"
        onConfirm={() =>
          void agir("resume-queue", () => resumeClaudeQueue(), "Fila do Claude retomada", "Não foi possível retomar a fila")
        }
      >
        {pluralize(fila.waiting.length, "pedido volta", "pedidos voltam")} a rodar, um de cada vez.
      </ConfirmClaudeDialog>

      <ConfirmClaudeDialog
        open={confirming?.kind === "resume"}
        onOpenChange={(aberto) => !aberto && setConfirming(null)}
        title="Retomar a execução interrompida?"
        confirmLabel="Retomar e usar a assinatura"
        onConfirm={() => {
          if (confirming?.kind !== "resume") return;
          const { item } = confirming;
          void agir(item.id, () => resumeInterruptedClaudeRun(item.id), "Execução de volta à fila", "Não foi possível retomar");
        }}
      >
        O pedido volta para a fila e o Claude retoma a sessão do site, se ela ainda existir.
      </ConfirmClaudeDialog>
    </div>
  );
}
