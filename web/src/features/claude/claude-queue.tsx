import { useMemo, useState } from "react";
import { ListX, Loader2, PauseCircle, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ClaudeQueueItem, ClaudeStatus, Project } from "@/lib/api";
import {
  cancelClaudeRun,
  claudeRunningItems,
  discardInterruptedClaudeRun,
  removeClaudeQueueItem,
  resumeClaudeQueue,
  resumeInterruptedClaudeRun,
} from "@/lib/api";
import { formatElapsed, pluralize, projectIdentity, timeOf } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useNow } from "@/lib/use-now";
import { DisabledHint, Reason } from "@/components/disabled-hint";
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
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { claudeRoundOf, claudeStageLabel } from "@/features/projects/project-status";
import { ConfirmClaudeDialog, GenerationOffNotice, NoticeWithAction, RunStatusBadge } from "./claude-shared";
import { claudeBlock, errorMessage, requestLabels, requestOrigin } from "./claude-text";
import { useClaudeQueueSync, useClaudeRefresh, useClaudeStatus } from "./use-claude";
import { ClaudeIcon } from "@/components/brand-icons";

/**
 * A fila do Claude, do painel inteiro: o que roda agora, o que espera a vez e
 * o que um reinício interrompeu. Vários sites nascem ao mesmo tempo, e os
 * ajustes de sites já entregues rodam ao lado deles.
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
  const pendentes = claudeRunningItems(fila).length + fila.waiting.length + fila.interrupted.length;
  const atencao = fila.paused || fila.interrupted.length > 0;
  const resumo = fila.paused
    ? "pausada"
    : fila.running
      ? `${claudeRunningItems(fila).length} rodando`
      : pendentes > 0
        ? pluralize(pendentes, "pedido")
        : null;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          // Quem abre a fila quer o que há agora, não o que havia na última consulta.
          void status.refetch();
        }}
        aria-label={`Fila do Claude${resumo ? `: ${resumo}` : ""}`}
      >
        {fila.running ? <Loader2 className="animate-spin text-info" /> : <ClaudeIcon />}
        <span className="hidden sm:inline">Fila do Claude</span>
        {resumo && (
          <Badge variant={atencao ? "warning" : "info"} className="tabular-nums">
            {resumo}
          </Badge>
        )}
      </Button>
      <ClaudeQueueDialog open={open} onOpenChange={setOpen} projects={projects} onOpenProject={onOpenProject} />
    </>
  );
}

/** A fila inteira, num diálogo: o que roda, o que espera e o que um reinício interrompeu. */
export function ClaudeQueueDialog({
  open,
  onOpenChange,
  projects,
  onOpenProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  onOpenProject: (project: Project) => void;
}) {
  const status = useClaudeStatus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fila do Claude</DialogTitle>
          <DialogDescription>
            Vários sites são criados ao mesmo tempo, e os ajustes rodam ao lado; quantos de cada, as Configurações dizem. Fechar esta janela não interrompe nada.
          </DialogDescription>
        </DialogHeader>
        {status.data ? (
          <QueueBody
            status={status.data}
            projects={projects}
            onOpenProject={(project) => {
              onOpenChange(false);
              onOpenProject(project);
            }}
          />
        ) : (
          <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
        )}
      </DialogContent>
    </Dialog>
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

/** "Crítica · rodada 1 de 2": o pedido, com a rodada quando o card do projeto a conhece. */
const pedidoDe = (item: ClaudeQueueItem, project: Project | undefined) => {
  const rodada =
    item.tipo === "criticar" || item.tipo === "refinar" ? claudeRoundOf(item.tipo, project?.claude?.site) : null;
  return rodada ? `${requestLabels[item.tipo]} · ${rodada}` : requestLabels[item.tipo];
};

/** " · por Ana", " · seguiu sozinho, do pedido de Ana": quem pôs o pedido na fila, para a linha dele. */
const origemDe = (item: ClaudeQueueItem) => {
  const origem = requestOrigin(item);
  return origem ? ` · ${origem}` : null;
};

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
    { kind: "resume-queue" } | { kind: "cancel" | "resume" | "discard"; item: ClaudeQueueItem } | null
  >(null);

  const fila = status.queue;
  const podeGerar = can("gerar");
  const semPermissao = podeGerar ? null : claudeBlock.semPermissao;
  const desligada = status.generation.enabled ? null : claudeBlock.desligada;

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

  const rodando = claudeRunningItems(fila);
  const vazia = rodando.length === 0 && fila.waiting.length === 0 && fila.interrupted.length === 0;

  return (
    <DialogBody className="space-y-4">
      {/* As travas vêm antes da lista, escritas uma vez: os botões abaixo só
          ficam desligados, sem repetir o motivo em cada linha. */}
      {!status.generation.enabled && <GenerationOffNotice reason={status.generation.reason} />}
      {semPermissao && <Reason>{semPermissao}</Reason>}

      {fila.paused && (
        <NoticeWithAction
          icon={<PauseCircle />}
          title="A fila está pausada"
          action={
            <DisabledHint reason={semPermissao ?? desligada}>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(semPermissao ?? desligada) || working !== null}
                onClick={() => setConfirming({ kind: "resume-queue" })}
              >
                {working === "resume-queue" ? <Loader2 className="animate-spin" /> : <Play />}
                Retomar fila
              </Button>
            </DisabledHint>
          }
        >
          O painel foi reiniciado com pedidos esperando. Eles só voltam a rodar quando alguém retomar.
        </NoticeWithAction>
      )}

      {vazia && (
        <EmptyNotice
          icon={<ClaudeIcon />}
          title="Nada na fila"
          description="Os pedidos de briefing, de site e de ajuste aparecem aqui enquanto esperam ou rodam — e também as críticas e os refinos, que o painel põe na fila sozinho."
        />
      )}

      {rodando.length > 0 && (
        <section aria-labelledby="fila-rodando" className="space-y-2">
          <h3 id="fila-rodando" className="text-xs font-medium text-muted-foreground">
            Rodando agora{rodando.length > 1 && ` · ${rodando.length}`}
          </h3>
          {/* Vários sites nascem juntos, e os ajustes rodam ao lado: pode haver mais de uma execução. */}
          <ul className="space-y-2">
            {rodando.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-info/30 bg-info/5 px-3 py-2"
              >
                <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden />
                <div className="min-w-0 flex-1">
                  <ItemName item={item} project={projetoDe(item)} onOpen={onOpenProject} />
                  <p className="truncate text-xs text-muted-foreground">
                    {pedidoDe(item, projetoDe(item))}
                    {/* A crítica e o refino já dizem a etapa no nome do pedido. */}
                    {item.etapa &&
                      item.tipo !== "criticar" &&
                      item.tipo !== "refinar" &&
                      ` · ${claudeStageLabel(item.etapa)}`}
                    {item.inicio && ` · há ${formatElapsed(now - (timeOf(item.inicio) ?? now))}`}
                    {origemDe(item)}
                  </p>
                </div>
                <DisabledHint reason={semPermissao}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!podeGerar || working !== null}
                    onClick={() => setConfirming({ kind: "cancel", item })}
                  >
                    {working === item.id ? <Loader2 className="animate-spin" /> : <Square />}
                    Cancelar execução
                  </Button>
                </DisabledHint>
              </li>
            ))}
          </ul>
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
                {/* A vez que o servidor diz manda; o índice da lista é só o recurso
                    de um servidor que não a manda. */}
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.posicao ?? indice + 1}º
                </span>
                <div className="min-w-0 flex-1">
                  <ItemName item={item} project={projetoDe(item)} onOpen={onOpenProject} />
                  <p className="truncate text-xs text-muted-foreground">
                    {pedidoDe(item, projetoDe(item))}
                    {origemDe(item)}
                  </p>
                </div>
                <DisabledHint reason={semPermissao}>
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
                </DisabledHint>
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
                    {pedidoDe(item, projetoDe(item))}
                    {origemDe(item)}
                  </p>
                </div>
                <DisabledHint reason={semPermissao}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!podeGerar || working !== null}
                    onClick={() => setConfirming({ kind: "discard", item })}
                  >
                    <Trash2 />
                    Descartar
                  </Button>
                </DisabledHint>
                <DisabledHint reason={semPermissao ?? desligada}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(semPermissao ?? desligada) || working !== null}
                    onClick={() => setConfirming({ kind: "resume", item })}
                  >
                    {working === item.id ? <Loader2 className="animate-spin" /> : <Play />}
                    Retomar
                  </Button>
                </DisabledHint>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fila.last && (
        <div className="space-y-0.5 border-t pt-3 text-xs text-muted-foreground">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Última execução: <ItemName item={fila.last.item} project={projetoDe(fila.last.item)} onOpen={onOpenProject} /> ·{" "}
            {requestLabels[fila.last.item.tipo]}
            <RunStatusBadge status={fila.last.status} />
          </p>
          {/* O que ela deixou dito — o motivo de uma falha, quase sempre. Curto: o
              inteiro fica no log, no projeto. */}
          {fila.last.mensagem && <p className="line-clamp-2">{fila.last.mensagem}</p>}
        </div>
      )}

      <AlertDialog open={confirming?.kind === "cancel"} onOpenChange={(aberto) => !aberto && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a execução do Claude?</AlertDialogTitle>
            <AlertDialogDescription>
              O Claude é interrompido agora, e o que ele já escreveu fica como está. O próximo pedido da fila
              que couber começa em seguida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixar rodando</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirming?.kind !== "cancel") return;
                const { item } = confirming;
                void agir(item.id, () => cancelClaudeRun(item.id), "Execução cancelada", "Não foi possível cancelar");
              }}
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
              variant="destructive"
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
        {pluralize(fila.waiting.length, "pedido volta", "pedidos voltam")} a rodar, na ordem da fila.
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
    </DialogBody>
  );
}
