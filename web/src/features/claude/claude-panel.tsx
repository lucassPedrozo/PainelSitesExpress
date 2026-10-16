import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  ListX,
  Loader2,
  PackageX,
  PauseCircle,
  Play,
  RefreshCw,
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
import { formatElapsed, pluralize, projectIdentity, timeOf } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useNow } from "@/lib/use-now";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { When } from "@/components/when";
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
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { claudeRoundLabel, claudeStageLabel } from "@/features/projects/project-status";
import { requestNotificationPermission } from "@/lib/notifications";
import { ClaudeAdoptNotice } from "./claude-adopt";
import { ClaudeBriefingCard } from "./claude-briefing-card";
import { ClaudeLog } from "./claude-log";
import { effortLabel } from "./claude-options";
import {
  ConfirmClaudeDialog,
  GenerationOffNotice,
  NoticeWithAction,
  RunStatusBadge,
  SectionDisclosure,
  TechnicalDetails,
} from "./claude-shared";
import { ClaudeApprovalCard, ClaudeContinueCard, ClaudeSiteCard } from "./claude-site-card";
import {
  claudeBlock,
  errorMessage,
  formatDuration,
  formatEstimate,
  requestLabels,
  requestOrigin,
  runStatusLabels,
} from "./claude-text";
import { useClaudeLog, useClaudeProject, useClaudeRefresh, useClaudeStatus } from "./use-claude";
import { ClaudeIcon } from "@/components/brand-icons";

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
      <ErrorNotice
        title="Não foi possível ler o projeto no motor Claude"
        error={detail.error}
        onRetry={() => void detail.refetch()}
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
  const semPermissao = can("gerar") ? null : claudeBlock.semPermissao;
  const aprovacao = semFila && Boolean(data.site?.aguardandoAprovacao);
  // O site parou no meio — com a etapa aberta, ou com o passo seguinte fora da fila.
  const parado =
    semFila && Boolean(data.site && !data.site.aguardandoAprovacao && (data.site.etapaAberta || data.site.proximo));
  const briefing = data.review && (
    <ClaudeBriefingCard
      // O rascunho nasce do que está gravado: regravado (por alguém ou pelo
      // Claude), o cartão recomeça dele.
      key={JSON.stringify([data.review.briefing, data.review.opcoes, data.review.projetos])}
      project={project}
      detail={data}
      busy={ocupado}
    />
  );

  return (
    <div className="@container space-y-6">
      {!data.generation.enabled && (
        <GenerationOffNotice reason={data.generation.reason}>
          Dá para conferir, corrigir o briefing e ver o que já foi feito.
        </GenerationOffNotice>
      )}

      {/* Sem a fila, a tela não sabe se ela está pausada: diz isso, em vez de
          sumir com o aviso calada. */}
      {status.error && (
        <NoticeWithAction
          icon={<AlertTriangle />}
          title="Não foi possível ler a fila do Claude"
          action={
            <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          }
        >
          {errorMessage(status.error, "Confira se o painel está rodando.")} Enquanto isso, a tela não sabe se a fila
          está pausada.
        </NoticeWithAction>
      )}
      {status.data?.queue.paused && <PausedQueueNotice />}

      {/* Site feito na ferramenta antiga, entre os arquivos do projeto. */}
      {!data.site && !fila && <ClaudeAdoptNotice project={project} />}

      {!data.project ? (
        <EmptyNotice
          icon={<ClaudeIcon />}
          title="Este projeto ainda não passou pelo Claude"
          description="O primeiro passo é o briefing: o Claude lê o material do projeto e escreve um, que você revisa antes de o site ser gerado."
          action={
            <div className="flex flex-col items-center gap-1.5">
              <DisabledHint reason={semPermissao}>
                <Button size="sm" disabled={Boolean(semPermissao)} onClick={() => onGenerateBriefing(project)}>
                  <ClaudeIcon mono />
                  Gerar briefing com o Claude
                </Button>
              </DisabledHint>
              {semPermissao && <Reason>{semPermissao}</Reason>}
            </div>
          }
        />
      ) : (
        <>
          {fila && <RunCard project={project} item={fila} site={data.site} />}

          {aprovacao && <ClaudeApprovalCard project={project} detail={data} busy={ocupado} />}
          {/* O erro vem antes do botão de continuar: primeiro o que houve, depois o que fazer. */}
          {semFila && <LastRunNotice detail={data} />}
          {parado && <ClaudeContinueCard project={project} detail={data} busy={ocupado} />}

          {/* Com o site criado, ele vem antes do briefing: é o que a pessoa
              abriu a aba para ver, e o briefing vira consulta. Se o cartão de
              cima pede a decisão (aprovar, continuar), as ações do site ficam
              secundárias: uma principal por vez. */}
          {data.site && (
            <ClaudeSiteCard
              project={project}
              detail={data}
              busy={ocupado}
              primary={!aprovacao && !parado}
              onPush={() => onPushSite(project)}
            />
          )}

          {/* Com o site feito, o briefing é consulta: fica recolhido, com o
              estado dele à vista. Antes de o site existir, é o trabalho. */}
          {briefing &&
            (data.site ? (
              <SectionDisclosure title="Briefing e opções do site" meta={briefingMeta(data)}>
                {briefing}
              </SectionDisclosure>
            ) : (
              briefing
            ))}

          {data.review && !data.review.existe && semFila && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {semPermissao && <Reason className="mr-auto">{semPermissao}</Reason>}
              <DisabledHint reason={semPermissao}>
                <Button variant="outline" size="sm" disabled={Boolean(semPermissao)} onClick={() => onGenerateBriefing(project)}>
                  <ClaudeIcon />
                  Pedir o briefing ao Claude
                </Button>
              </DisabledHint>
            </div>
          )}

          <RunsCard project={project} runs={data.runs} />
        </>
      )}
    </div>
  );
}

/** O briefing fechado, numa linha: o que a conferência disse e de quem é o site. */
function briefingMeta(detail: ClaudeProjectDetail) {
  const review = detail.review;
  if (!review?.existe) return "Ainda não escrito";
  const estado = review.erros.length > 0 ? pluralize(review.erros.length, "pendência") : "Aceito pela conferência";
  return [estado, review.resumo[0]].filter(Boolean).join(" · ");
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
  edicao: "Ajustando o site do repositório",
};

/** A frase que o painel digitou ao Claude: é do motor, não da decisão — fica recolhida. */
function TypedRequest({ frase }: { frase: string }) {
  return (
    <TechnicalDetails>
      <p>
        Pedido digitado ao Claude: <span className="whitespace-pre-wrap text-foreground">“{frase}”</span>
      </p>
    </TechnicalDetails>
  );
}

/** O pedido deste projeto: esperando a vez, rodando (com o log) ou interrompido. */
export function RunCard({ project, item, site }: { project: Project; item: ClaudeQueueItem; site: ClaudeSite | null }) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const now = useNow();
  const rodando = item.estado === "rodando";
  const log = useClaudeLog(item.id, rodando);
  const [confirming, setConfirming] = useState<"cancel" | "resume" | "discard" | null>(null);
  const [working, setWorking] = useState(false);
  const semPermissao = can("gerar") ? null : claudeBlock.semPermissao;
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

  const inicio = timeOf(item.inicio ?? item.criadoEm);
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
          </AlertDescription>
        </Alert>
        <TypedRequest frase={item.frase} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {semPermissao && <Reason className="mr-auto">{semPermissao}</Reason>}
          <DisabledHint reason={semPermissao}>
            <Button variant="outline" size="sm" disabled={Boolean(semPermissao) || working} onClick={() => setConfirming("discard")}>
              <Trash2 />
              Descartar
            </Button>
          </DisabledHint>
          <DisabledHint reason={semPermissao}>
            <Button size="sm" disabled={Boolean(semPermissao) || working} onClick={() => setConfirming("resume")}>
              {working ? <Loader2 className="animate-spin" /> : <Play />}
              Retomar
            </Button>
          </DisabledHint>
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
          {item.tipo === "edicao"
            ? "O pedido volta para a fila e parte da última versão do site no GitHub."
            : "O pedido volta para a fila e o Claude retoma a sessão do site, se ela ainda existir."}
        </ConfirmClaudeDialog>
        <AlertDialog open={confirming === "discard"} onOpenChange={(open) => !open && setConfirming(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar a execução interrompida de {projectIdentity(project).label}?</AlertDialogTitle>
              <AlertDialogDescription>
                Ela sai da lista e nada é rodado. O que o Claude já tinha escrito fica como está.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
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
        {inicio !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {rodando ? "há " : "pedido há "}
            {formatElapsed(now - inicio)}
          </span>
        )}
        {origem && <span className="text-xs text-muted-foreground">{origem}</span>}
        <span className="ml-auto">
          <DisabledHint reason={semPermissao}>
            {rodando ? (
              <Button variant="outline" size="sm" disabled={Boolean(semPermissao) || working} onClick={() => setConfirming("cancel")}>
                {working ? <Loader2 className="animate-spin" /> : <Square />}
                Cancelar execução
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(semPermissao) || working}
                onClick={() =>
                  void agir(() => removeClaudeQueueItem(item.id), "Pedido tirado da fila", "Não foi possível tirar da fila")
                }
              >
                {working ? <Loader2 className="animate-spin" /> : <ListX />}
                Tirar da fila
              </Button>
            )}
          </DisabledHint>
        </span>
      </div>
      {semPermissao && <Reason>{semPermissao}</Reason>}

      {rodando && (
        <>
          {log.error ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-destructive">
              <p>
                Não foi possível ler o log ({errorMessage(log.error, "sem resposta do painel")}). O painel tenta de
                novo a cada poucos segundos.
              </p>
              <Button variant="link" size="xs" onClick={log.retry}>
                Tentar agora
              </Button>
            </div>
          ) : null}
          <ClaudeLog
            lines={log.lines}
            live
            empty={log.error ? "O log ainda não pôde ser lido." : "Esperando as primeiras linhas do Claude…"}
            className="h-72"
          />
        </>
      )}

      <TypedRequest frase={item.frase} />

      <AlertDialog open={confirming === "cancel"} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a execução do Claude em {projectIdentity(project).label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {item.tipo === "edicao"
                ? "O Claude é interrompido agora e nada é enviado ao GitHub: o site fica como estava. O próximo pedido da fila começa em seguida."
                : "O Claude é interrompido agora, e o que ele já escreveu fica como está. Se uma etapa ficar aberta, dá para continuá-la ou encerrá-la depois. O próximo pedido da fila começa em seguida."}
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
  const semPermissao = can("gerar") ? null : claudeBlock.semPermissao;

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
          <DisabledHint reason={semPermissao}>
            <Button size="sm" variant="outline" disabled={Boolean(semPermissao) || working} onClick={() => setConfirming(true)}>
              {working ? <Loader2 className="animate-spin" /> : <Play />}
              Retomar fila
            </Button>
          </DisabledHint>
        }
      >
        O painel foi reiniciado com pedidos esperando. Eles só voltam a rodar quando alguém retomar a fila.
        {semPermissao && <Reason className="mt-1">{semPermissao}</Reason>}
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
        <When at={ultima.at} className="mt-1 block text-xs" />
      </AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------------ *
 * Histórico
 * ------------------------------------------------------------------ */

/**
 * Cada execução do `claude -p` neste projeto, com o log de cada uma. Na linha
 * fica o que se lê de relance — quanto durou e quem pediu —; o modelo, o
 * esforço, os turnos e a estimativa ficam no log, em "Detalhes técnicos".
 */
function RunsCard({ project, runs }: { project: Project; runs: ClaudeRun[] }) {
  const [aberta, setAberta] = useState<ClaudeRun | null>(null);
  if (runs.length === 0) return null;
  const ultima = runs.reduce((atual, run) => ((timeOf(run.data) ?? 0) > (timeOf(atual.data) ?? 0) ? run : atual));

  return (
    <SectionDisclosure
      title="Execuções"
      meta={
        <>
          {pluralize(runs.length, "execução", "execuções")} · a última: {requestLabels[ultima.tipo].toLowerCase()},{" "}
          {runStatusLabels[ultima.status].toLowerCase()} <When at={ultima.data} />
        </>
      }
    >
      <ul className="divide-y rounded-lg border">
        {runs.map((run) => {
          const detalhes = [formatDuration(run.duracaoMs), run.por ? `por ${run.por}` : null].filter(Boolean);
          return (
            <li key={run.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{requestLabels[run.tipo]}</span>
                  <RunStatusBadge status={run.status} />
                  <When at={run.data} className="text-muted-foreground" />
                </p>
                {detalhes.length > 0 && <p className="text-muted-foreground">{detalhes.join(" · ")}</p>}
                {run.mensagem && run.status !== "sucesso" && (
                  <p className="line-clamp-2 text-muted-foreground">{run.mensagem}</p>
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

      <Dialog open={Boolean(aberta)} onOpenChange={(open) => !open && setAberta(null)}>
        <DialogContent layout="sectioned" className="h-dialog-tall sm:max-w-5xl">
          {aberta && <RunLog project={project} run={aberta} />}
        </DialogContent>
      </Dialog>
    </SectionDisclosure>
  );
}

function RunLog({ project, run }: { project: Project; run: ClaudeRun }) {
  const log = useQuery({
    queryKey: ["claude", "log", project.id, run.id],
    queryFn: () => fetchClaudeRunLog(project.id, run.id),
    staleTime: run.status === "rodando" ? 0 : 5 * 60_000,
  });
  const estimativa = formatEstimate(run.custoEstimadoUsd);
  const tecnicos = [
    run.modelo ? `Modelo: ${run.modelo}` : null,
    run.esforco ? `Esforço: ${effortLabel(run.esforco).toLowerCase()}` : null,
    run.turnos ? pluralize(run.turnos, "turno") : null,
    estimativa,
    run.retomou ? "Retomou a sessão do site" : null,
    run.sessaoNovaPorFalha ? "Sessão nova: a anterior não existia mais" : null,
  ].filter(Boolean);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          Log · {requestLabels[run.tipo]} — {projectIdentity(project).label}
          <RunStatusBadge status={run.status} />
        </DialogTitle>
        <DialogDescription>
          <When at={run.data} />
          {[formatDuration(run.duracaoMs), run.por ? `por ${run.por}` : null]
            .filter(Boolean)
            .map((item) => ` · ${item}`)
            .join("")}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        {run.mensagem && (
          <pre className="max-h-32 shrink-0 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-sans text-sm whitespace-pre-wrap">
            {run.mensagem}
          </pre>
        )}
        <TechnicalDetails className="shrink-0">
          <p>
            Pedido digitado ao Claude: <span className="whitespace-pre-wrap text-foreground">“{run.pedido}”</span>
          </p>
          {tecnicos.length > 0 && <p>{tecnicos.join(" · ")}</p>}
          {estimativa && (
            <p>
              A estimativa é a do Claude Code, a preço de API. O consumo de verdade sai da assinatura, e os valores
              não se somam aos de outros motores.
            </p>
          )}
        </TechnicalDetails>
        {log.isPending ? (
          <Skeleton className="min-h-64 flex-1 rounded-lg" />
        ) : log.error ? (
          <ErrorNotice title="Não foi possível ler o log" error={log.error} onRetry={() => void log.refetch()} />
        ) : (
          <ClaudeLog
            lines={log.data?.lines ?? []}
            empty="Esta execução não deixou linhas no log."
            className="min-h-64 flex-1"
          />
        )}
      </DialogBody>
    </>
  );
}
