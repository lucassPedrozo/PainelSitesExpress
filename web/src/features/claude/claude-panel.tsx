import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Clock,
  ListX,
  Loader2,
  Lock,
  PackageX,
  PauseCircle,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { ClaudeProjectDetail, ClaudeQueueItem, ClaudeRequestType, ClaudeRun, ClaudeSite, Project } from "@/lib/api";
import {
  cancelClaudeRun,
  discardInterruptedClaudeRun,
  fetchClaudeRunLog,
  removeClaudeQueueItem,
  resumeClaudeQueue,
  resumeInterruptedClaudeRun,
} from "@/lib/api";
import { formatDateTime, pluralize } from "@/lib/format";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyNotice } from "@/components/page-header";
import { formatElapsed } from "@/features/projects/project-progress";
import { claudeRoundLabel, claudeStageLabel } from "@/features/projects/project-status";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { ClaudeAdoptNotice } from "./claude-adopt";
import { ClaudeBriefingCard } from "./claude-briefing-card";
import { ClaudeLog } from "./claude-log";
import { effortLabel } from "./claude-options";
import { ConfirmClaudeDialog, HintWhenDisabled, NoticeWithAction, RunStatusBadge } from "./claude-shared";
import { ClaudeApprovalCard, ClaudeContinueCard, ClaudeSiteCard } from "./claude-site-card";
import {
  errorMessage,
  formatDuration,
  formatEstimate,
  requestLabels,
  requestOrigin,
  semPermissaoDeGerar,
} from "./claude-text";
import { useClaudeLog, useClaudeProject, useClaudeRefresh, useClaudeStatus } from "./use-claude";

/**
 * O projeto no motor Claude: o que está rodando agora, o que espera uma
 * pessoa, o briefing para revisar, o site e o histórico das execuções.
 *
 * A ordem é a da urgência: primeiro o que roda ou parou, depois o que pede uma
 * decisão, depois o que só se consulta. É a mesma pergunta do card — "o que
 * falta?" — respondida com o detalhe que não cabe nele.
 */
export function ClaudePanel({
  project,
  onGenerateBriefing,
  onPushSite,
}: {
  project: Project;
  /** Abre o diálogo de geração, já no motor Claude. */
  onGenerateBriefing: (project: Project) => void;
  /** Abre o envio do site validado ao GitHub. */
  onPushSite: (project: Project) => void;
}) {
  const { can } = usePermissions();
  const detail = useClaudeProject(project.id);
  const status = useClaudeStatus();

  if (detail.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <EmptyNotice
        icon={<AlertTriangle />}
        title="Não foi possível ler o projeto no motor Claude"
        description={errorMessage(detail.error)}
        action={
          <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
            Tentar novamente
          </Button>
        }
      />
    );
  }

  const data = detail.data;
  if (!data.installed) {
    return (
      <EmptyNotice
        icon={<PackageX />}
        title="O motor Claude não está instalado neste painel"
        description={data.reason ?? undefined}
      />
    );
  }

  // O painel em uso troca a interface sem reiniciar o servidor. Entre uma coisa
  // e outra, a resposta ainda é a de antes das rodadas — sem o andamento do
  // site nem os padrões das opções —, e as telas abaixo não teriam o que mostrar.
  if ((data.site && !data.site.pipeline) || (data.review && !data.review.padroes)) {
    return (
      <EmptyNotice
        icon={<RotateCw />}
        title="O painel precisa ser reiniciado"
        description="A interface foi atualizada, e o servidor ainda roda a versão anterior do motor Claude. Reinicie o painel para ver este projeto aqui."
      />
    );
  }

  const fila = data.project?.queue ?? null;
  const ocupado = Boolean(fila);
  const semFila = !fila;

  return (
    <div className="space-y-6">
      {!data.generation.enabled && (
        <Alert variant="warning">
          <Lock />
          <AlertTitle>A geração pelo Claude está desligada neste painel</AlertTitle>
          <AlertDescription>
            {data.generation.reason} Dá para conferir, corrigir o briefing e ver o que já foi feito.
          </AlertDescription>
        </Alert>
      )}

      {status.data?.queue.paused && <PausedQueueNotice />}

      {/* Site feito na ferramenta antiga, entre os arquivos do projeto. */}
      {!data.site && !fila && <ClaudeAdoptNotice project={project} />}

      {!data.project ? (
        <EmptyNotice
          icon={<Bot />}
          title="Este projeto ainda não passou pelo Claude"
          description="O primeiro passo é o briefing: o Claude lê o material do projeto e escreve um, que você revisa antes de o site ser gerado."
          action={
            <HintWhenDisabled reason={can("gerar") ? null : semPermissaoDeGerar}>
              <Button size="sm" disabled={!can("gerar")} onClick={() => onGenerateBriefing(project)}>
                <Bot />
                Gerar briefing com o Claude
              </Button>
            </HintWhenDisabled>
          }
        />
      ) : (
        <>
          {fila && <RunCard item={fila} site={data.site} />}

          {semFila && data.site?.aguardandoAprovacao && (
            <ClaudeApprovalCard project={project} detail={data} busy={ocupado} />
          )}
          {/* O erro vem antes do botão de continuar: primeiro o que houve, depois o que fazer. */}
          {semFila && <LastRunNotice detail={data} />}
          {/* O site parou no meio — com a etapa aberta, ou com o passo seguinte fora da fila. */}
          {semFila && data.site && !data.site.aguardandoAprovacao && (data.site.etapaAberta || data.site.proximo) && (
            <ClaudeContinueCard project={project} detail={data} busy={ocupado} />
          )}

          {/* Com o site criado, ele vem antes do briefing: é o que a pessoa
              abriu a aba para ver, e o briefing vira consulta. */}
          {data.site && (
            <ClaudeSiteCard project={project} detail={data} busy={ocupado} onPush={() => onPushSite(project)} />
          )}

          {data.review && (
            <ClaudeBriefingCard
              // O rascunho nasce do que está gravado: regravado (por alguém ou
              // pelo Claude), o cartão recomeça dele.
              key={JSON.stringify([data.review.briefing, data.review.opcoes, data.review.projetos])}
              project={project}
              detail={data}
              busy={ocupado}
            />
          )}

          {data.review && !data.review.existe && semFila && (
            <div className="flex justify-end">
              <HintWhenDisabled reason={can("gerar") ? null : semPermissaoDeGerar}>
                <Button variant="outline" size="sm" disabled={!can("gerar")} onClick={() => onGenerateBriefing(project)}>
                  <Bot />
                  Pedir o briefing ao Claude
                </Button>
              </HintWhenDisabled>
            </div>
          )}

          <RunsCard project={project} runs={data.runs} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * O pedido do projeto na fila
 * ------------------------------------------------------------------ */

const runTitles: Record<ClaudeRequestType, string> = {
  analisar: "Gerando o briefing",
  ajuste: "Ajustando o site",
  cliente: "Gerando o site",
  continuar: "Continuando a geração",
  criticar: "Criticando o site",
  refinar: "Refinando o site",
};

/** O pedido deste projeto: esperando a vez, rodando (com o log) ou interrompido. */
function RunCard({ item, site }: { item: ClaudeQueueItem; site: ClaudeSite | null }) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const now = useNow();
  const rodando = item.estado === "rodando";
  const { lines } = useClaudeLog(item.id, rodando);
  const [confirming, setConfirming] = useState<"cancel" | "resume" | "discard" | null>(null);
  const [working, setWorking] = useState(false);
  const podeGerar = can("gerar");
  // Nas rodadas, o título diz qual: é o que separa esta crítica da anterior.
  const rodada =
    site && (item.tipo === "criticar" || item.tipo === "refinar")
      ? claudeRoundLabel(site.pipeline.rodada, site.pipeline.rodadas)
      : null;
  const origem = requestOrigin(item);

  const agir = async (acao: () => Promise<unknown>, ok: string, falha: string) => {
    setWorking(true);
    try {
      await acao();
      await refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(falha, { description: errorMessage(err) });
    } finally {
      setWorking(false);
    }
  };

  const inicio = Date.parse(item.inicio ?? item.criadoEm);
  const etapa = claudeStageLabel(item.etapa);

  if (item.estado === "interrompida") {
    return (
      <section aria-label="Execução interrompida" className="space-y-3">
        <Alert variant="warning">
          <PauseCircle />
          <AlertTitle>A execução foi interrompida</AlertTitle>
          <AlertDescription>
            O painel foi reiniciado no meio dela. Nada volta a rodar sozinho: retome de onde parou, ou
            descarte para pedir de novo.
            <span className="mt-1 block text-foreground">“{item.frase.split("\n")[0]}”</span>
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <HintWhenDisabled reason={podeGerar ? null : semPermissaoDeGerar}>
            <Button variant="outline" size="sm" disabled={!podeGerar || working} onClick={() => setConfirming("discard")}>
              <Trash2 />
              Descartar
            </Button>
          </HintWhenDisabled>
          <HintWhenDisabled reason={podeGerar ? null : semPermissaoDeGerar}>
            <Button size="sm" disabled={!podeGerar || working} onClick={() => setConfirming("resume")}>
              {working ? <Loader2 className="animate-spin" /> : <Play />}
              Retomar
            </Button>
          </HintWhenDisabled>
        </div>

        <ConfirmClaudeDialog
          open={confirming === "resume"}
          onOpenChange={(open) => !open && setConfirming(null)}
          title="Retomar a execução interrompida?"
          confirmLabel="Retomar e usar a assinatura"
          onConfirm={() => {
            requestNotificationPermission();
            void agir(
              () => resumeInterruptedClaudeRun(item.id),
              "Execução de volta à fila do Claude",
              "Não foi possível retomar",
            );
          }}
        >
          O pedido volta para a fila e o Claude retoma a sessão do site, se ela ainda existir.
        </ConfirmClaudeDialog>
        <AlertDialog open={confirming === "discard"} onOpenChange={(open) => !open && setConfirming(null)}>
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
                onClick={() =>
                  void agir(() => discardInterruptedClaudeRun(item.id), "Execução descartada", "Não foi possível descartar")
                }
              >
                Descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    );
  }

  return (
    <section aria-label="Execução do Claude" className="space-y-3 rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {rodando ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-info" aria-hidden />
        ) : (
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <h3 className="text-sm font-medium">
          {rodando
            ? [runTitles[item.tipo], rodada].filter(Boolean).join(" · ")
            : item.posicao
              ? `Na fila do Claude · ${item.posicao}º a rodar`
              : "Na fila do Claude"}
        </h3>
        {rodando && etapa && <span className="inline-block text-xs text-muted-foreground first-letter:uppercase">{etapa}</span>}
        {Number.isFinite(inicio) && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {rodando ? "há " : "pedido há "}
            {formatElapsed(now - inicio)}
          </span>
        )}
        <span className="ml-auto">
          <HintWhenDisabled reason={podeGerar ? null : semPermissaoDeGerar}>
            {rodando ? (
              <Button variant="outline" size="sm" disabled={!podeGerar || working} onClick={() => setConfirming("cancel")}>
                {working ? <Loader2 className="animate-spin" /> : <Square />}
                Cancelar execução
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!podeGerar || working}
                onClick={() =>
                  void agir(() => removeClaudeQueueItem(item.id), "Pedido tirado da fila", "Não foi possível tirar da fila")
                }
              >
                {working ? <Loader2 className="animate-spin" /> : <ListX />}
                Tirar da fila
              </Button>
            )}
          </HintWhenDisabled>
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Pedido: <span className="text-foreground">“{item.frase.split("\n")[0]}”</span>
        {origem && ` · ${origem}`}
      </p>

      {rodando && (
        <ClaudeLog lines={lines} live empty="Esperando as primeiras linhas do Claude…" className="h-72" />
      )}

      <AlertDialog open={confirming === "cancel"} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a execução do Claude?</AlertDialogTitle>
            <AlertDialogDescription>
              O Claude é interrompido agora, e o que ele já escreveu fica como está. Se uma etapa ficar
              aberta, dá para continuá-la ou encerrá-la depois. O próximo pedido da fila começa em seguida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixar rodando</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void agir(() => cancelClaudeRun(item.id), "Execução cancelada", "Não foi possível cancelar")}
            >
              Cancelar execução
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A fila voltou pausada de um reinício: nada roda até alguém mandar. */
function PausedQueueNotice() {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const retomar = async () => {
    setWorking(true);
    try {
      await resumeClaudeQueue();
      await refresh();
      toast.success("Fila do Claude retomada");
    } catch (err) {
      toast.error("Não foi possível retomar a fila", { description: errorMessage(err) });
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <NoticeWithAction
        icon={<PauseCircle />}
        title="A fila do Claude está pausada"
        action={
          <HintWhenDisabled reason={can("gerar") ? null : semPermissaoDeGerar}>
            <Button size="sm" variant="outline" disabled={!can("gerar") || working} onClick={() => setConfirming(true)}>
              {working ? <Loader2 className="animate-spin" /> : <Play />}
              Retomar fila
            </Button>
          </HintWhenDisabled>
        }
      >
        O painel foi reiniciado com pedidos esperando. Eles só voltam a rodar quando alguém retomar a fila.
      </NoticeWithAction>
      <ConfirmClaudeDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Retomar a fila do Claude?"
        confirmLabel="Retomar e usar a assinatura"
        onConfirm={() => void retomar()}
      >
        Os pedidos que esperavam voltam a rodar, na ordem da fila.
      </ConfirmClaudeDialog>
    </>
  );
}

/** A última execução, quando ela não terminou bem: o motivo fica à vista. */
function LastRunNotice({ detail }: { detail: ClaudeProjectDetail }) {
  const ultima = detail.project?.lastRun;
  // A etapa aberta e a aprovação têm o cartão delas, logo acima.
  if (!ultima || ultima.status !== "falha" || detail.site?.etapaAberta) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>
        {ultima.type === "analisar" ? "O briefing não ficou pronto" : `${requestLabels[ultima.type]}: a execução falhou`}
      </AlertTitle>
      <AlertDescription>
        <pre className="max-h-48 overflow-y-auto font-sans text-sm whitespace-pre-wrap">{ultima.message}</pre>
        <span className="mt-1 block text-xs">{formatDateTime(ultima.at)}</span>
      </AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------------ *
 * Histórico
 * ------------------------------------------------------------------ */

/** Cada execução do `claude -p` neste projeto, com o log de cada uma. */
function RunsCard({ project, runs }: { project: Project; runs: ClaudeRun[] }) {
  const [aberta, setAberta] = useState<ClaudeRun | null>(null);
  if (runs.length === 0) return null;

  return (
    <section aria-labelledby="claude-execucoes" className="space-y-2">
      <h3 id="claude-execucoes" className="text-sm font-medium">
        Execuções
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{runs.length}</span>
      </h3>
      <ul className="divide-y rounded-lg border">
        {runs.map((run) => {
          const detalhes = [
            formatDuration(run.duracaoMs),
            run.turnos ? pluralize(run.turnos, "turno") : null,
            run.modelo,
            run.esforco ? `esforço ${effortLabel(run.esforco).toLowerCase()}` : null,
            formatEstimate(run.custoEstimadoUsd),
            run.retomou ? "retomou a sessão" : null,
            run.sessaoNovaPorFalha ? "sessão nova (a anterior não existia mais)" : null,
            run.por ? `por ${run.por}` : null,
          ].filter(Boolean);
          return (
            <li key={run.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{requestLabels[run.tipo]}</span>
                  <RunStatusBadge status={run.status} />
                  <span className="tabular-nums text-muted-foreground">{formatDateTime(run.data)}</span>
                </p>
                {detalhes.length > 0 && <p className="text-muted-foreground">{detalhes.join(" · ")}</p>}
                {run.mensagem && run.status !== "sucesso" && (
                  <p className="line-clamp-2 text-muted-foreground" title={run.mensagem}>
                    {run.mensagem}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setAberta(run)}>
                <ScrollText />
                Ver log
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        A estimativa é a do Claude Code, a preço de API. O consumo de verdade sai da assinatura, e os valores
        não se somam aos de outros motores.
      </p>

      <Dialog open={Boolean(aberta)} onOpenChange={(open) => !open && setAberta(null)}>
        <DialogContent layout="sectioned" className="h-[88vh] sm:max-w-[min(960px,96vw)]">
          {aberta && <RunLog project={project} run={aberta} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RunLog({ project, run }: { project: Project; run: ClaudeRun }) {
  const log = useQuery({
    queryKey: ["claude", "log", project.id, run.id],
    queryFn: () => fetchClaudeRunLog(project.id, run.id),
    staleTime: run.status === "rodando" ? 0 : 5 * 60_000,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
          {requestLabels[run.tipo]} · {formatDateTime(run.data)}
          <RunStatusBadge status={run.status} />
        </DialogTitle>
        <DialogDescription>“{run.pedido.split("\n")[0]}”</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
        {run.mensagem && (
          <pre className="max-h-32 shrink-0 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-sans text-sm whitespace-pre-wrap">
            {run.mensagem}
          </pre>
        )}
        {log.isPending ? (
          <Skeleton className="min-h-0 flex-1 rounded-lg" />
        ) : log.error ? (
          <EmptyNotice icon={<AlertTriangle />} title="Não foi possível ler o log" description={errorMessage(log.error)} />
        ) : (
          <ClaudeLog
            lines={log.data?.lines ?? []}
            empty="Esta execução não deixou linhas no log."
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </>
  );
}
