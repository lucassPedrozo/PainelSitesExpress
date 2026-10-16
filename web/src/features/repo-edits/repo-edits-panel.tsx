import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  ExternalLink,
  GitMerge,
  History,
  Loader2,
  PauseCircle,
  PencilLine,
  RefreshCw,
  ScrollText,
  Settings2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchRepoEditLog,
  fetchRepoEdits,
  fetchRepoVersion,
  removeRepoEditAttachment,
  requestRepoEdit,
  uploadRepoEditAttachment,
  type Project,
  type RepoCommit,
  type RepoEdit,
  type RepoEditOrigin,
  type RepoEditStatus,
} from "@/lib/api";
import { formatElapsed, pluralize } from "@/lib/format";
import { noPermission, usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { ClaudeIcon, GitHubIcon, LovableIcon } from "@/components/brand-icons";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { When } from "@/components/when";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AdjustAttachments } from "@/features/claude/claude-adjust-attachments";
import { attachmentsPayload, useAdjustAttachments } from "@/features/claude/use-adjust-attachments";
import { ClaudeLog } from "@/features/claude/claude-log";
import { RunCard } from "@/features/claude/claude-panel";
import { ConfirmClaudeDialog, GenerationOffNotice, SectionDisclosure } from "@/features/claude/claude-shared";
import { claudeBlock, errorMessage } from "@/features/claude/claude-text";
import { useClaudeRefresh } from "@/features/claude/use-claude";
import { requestNotificationPermission } from "@/lib/notifications";

/**
 * A aba "Ajustes": ajustes pelo Claude num site que mora num repositório do
 * GitHub — os feitos no Lovable. Mostra a última versão do site no GitHub e
 * quem fez a última alteração (Lovable, Claude ou uma pessoa), recebe o pedido
 * e guarda a memória de tudo o que já foi pedido.
 *
 * O ajuste sempre parte da última versão do GitHub; ao terminar, se o build
 * passar, o painel faz um commit normal e envia — a área de aprovação
 * republica e o Lovable recebe a mudança pela sincronização dele.
 */

const attachmentApi = { upload: uploadRepoEditAttachment, remove: removeRepoEditAttachment };

/** Quem fez uma alteração: ícone e nome. */
const origins: Record<RepoEditOrigin, { label: string; icon: ReactNode }> = {
  lovable: { label: "Lovable", icon: <LovableIcon className="size-3.5" /> },
  claude: { label: "Claude", icon: <ClaudeIcon className="size-3.5" /> },
  person: { label: "Pessoa", icon: <UserRound className="size-3.5" /> },
  panel: { label: "Painel", icon: <Settings2 className="size-3.5" /> },
};

function OriginBadge({ commit }: { commit: Pick<RepoCommit, "origin" | "author"> }) {
  const origin = origins[commit.origin];
  return (
    <Badge variant="outline" className="gap-1.5 font-medium">
      {origin.icon}
      {commit.origin === "person" ? commit.author : origin.label}
    </Badge>
  );
}

/** A situação de um ajuste da memória. */
const statusView: Record<RepoEditStatus, { label: string; variant: "success" | "secondary" | "destructive" | "warning" | "info" | "outline"; icon: ReactNode }> = {
  queued: { label: "Na fila", variant: "outline", icon: <Clock /> },
  running: { label: "Rodando", variant: "info", icon: <Loader2 className="animate-spin" /> },
  pushed: { label: "Enviado ao GitHub", variant: "success", icon: <CircleCheck /> },
  unchanged: { label: "Sem mudança", variant: "secondary", icon: <CircleSlash /> },
  failed: { label: "Não enviado", variant: "destructive", icon: <CircleX /> },
  conflict: { label: "Conflito com o Lovable", variant: "warning", icon: <GitMerge /> },
  cancelled: { label: "Cancelado", variant: "secondary", icon: <CircleSlash /> },
  interrupted: { label: "Interrompido", variant: "warning", icon: <PauseCircle /> },
};

const shortSha = (sha: string) => sha.slice(0, 7);

export function RepoEditsPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: queryKeys.repoEdits(project.id),
    queryFn: () => fetchRepoEdits(project.id),
    // Enquanto há pedido na fila, a memória e a versão acompanham o andamento.
    refetchInterval: (query) => (query.state.data?.queue ? 3000 : false),
  });
  const available = state.data?.available === true;
  const version = useQuery({
    queryKey: queryKeys.repoVersion(project.id),
    queryFn: () => fetchRepoVersion(project.id),
    enabled: available,
    staleTime: 30_000,
    retry: false,
  });

  // O pedido terminou: a versão do GitHub mudou (ou não), e é lida de novo.
  const tinhaPedido = useRef(false);
  const temPedido = Boolean(state.data?.queue);
  useEffect(() => {
    if (tinhaPedido.current && !temPedido) void queryClient.invalidateQueries({ queryKey: queryKeys.repoVersion(project.id) });
    tinhaPedido.current = temPedido;
  }, [temPedido, project.id, queryClient]);

  if (state.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Carregando os ajustes">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (state.error || !state.data) {
    return (
      <ErrorNotice
        title="Não foi possível carregar os ajustes"
        error={state.error}
        onRetry={() => void state.refetch()}
      />
    );
  }

  const data = state.data;
  const item = data.queue;

  return (
    <div className="space-y-6">
      {!data.available ? (
        <Alert variant="info">
          <GitHubIcon />
          <AlertTitle>Ajustes pelo Claude não disponíveis neste projeto</AlertTitle>
          <AlertDescription>{data.reason}</AlertDescription>
        </Alert>
      ) : (
        <VersionCard
          repo={data.repo!}
          version={version.data ?? data.version}
          loading={version.isFetching}
          error={version.error}
          onRefresh={() => void version.refetch()}
        />
      )}

      {item &&
        (item.tipo === "edicao" ? (
          <RunCard project={project} item={item} site={null} />
        ) : (
          <Alert variant="info">
            <Clock />
            <AlertTitle>Há outro pedido deste projeto na fila do Claude</AlertTitle>
            <AlertDescription>A aba Claude mostra o andamento. Um ajuste aqui pode ser pedido quando ele terminar.</AlertDescription>
          </Alert>
        ))}

      {data.available && (
        <RequestForm project={project} busy={Boolean(item)} generation={data.generation} />
      )}

      <EditsMemory project={project} edits={data.edits} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A versão no GitHub
 * ------------------------------------------------------------------ */

function VersionCard({
  repo,
  version,
  loading,
  error,
  onRefresh,
}: {
  repo: string;
  version: import("@/lib/api").RepoVersion | null;
  loading: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  const last = version?.last ?? null;
  return (
    <section aria-labelledby="ajustes-versao" className="space-y-3 rounded-xl border p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="ajustes-versao" className="text-section">
          Versão no GitHub
        </h3>
        <a
          href={`https://github.com/${repo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <GitHubIcon className="size-3.5" />
          {repo}
          {version?.branch ? ` · ${version.branch}` : ""}
        </a>
        <Button variant="outline" size="sm" className="ml-auto" disabled={loading} onClick={onRefresh}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Buscar a última versão
        </Button>
      </header>

      {error && !version ? (
        <p className="text-sm text-destructive">{errorMessage(error, "Não foi possível ler o repositório no GitHub.")}</p>
      ) : !version ? (
        <div className="space-y-2" aria-busy="true" aria-label="Lendo o repositório">
          <Skeleton className="h-5 w-72 max-w-full" />
          <Skeleton className="h-4 w-48 max-w-full" />
          <p className="text-xs text-muted-foreground">Lendo o repositório no GitHub (na primeira vez o painel baixa o site).</p>
        </div>
      ) : (
        <>
          {last ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Última alteração no site:</span>
              <OriginBadge commit={last} />
              <When at={last.at} className="text-muted-foreground" />
              <a
                href={last.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
                title={last.message}
              >
                <span className="truncate">“{last.message}”</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{shortSha(last.sha)}</span>
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">O repositório ainda não tem commits.</p>
          )}
          {version.busy ? (
            <p className="text-xs text-muted-foreground">
              Um ajuste está rodando neste site: esta é a versão de antes dele. A próxima leitura vem quando ele terminar.
            </p>
          ) : (
            version.checkedAt && <When at={version.checkedAt} prefix="Conferido no GitHub" className="text-xs text-muted-foreground" />
          )}
          {version.commits.length > 1 && (
            <SectionDisclosure title="Alterações recentes" meta={pluralize(version.commits.length, "commit")}>
              <ol className="divide-y text-sm">
                {version.commits.map((commit) => (
                  <li key={commit.sha} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2">
                    <OriginBadge commit={commit} />
                    <a href={commit.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={commit.message}>
                      {commit.message}
                    </a>
                    <span className="text-xs text-muted-foreground tabular-nums">{pluralize(commit.files, "arquivo")}</span>
                    <When at={commit.at} className="text-xs text-muted-foreground" />
                  </li>
                ))}
              </ol>
            </SectionDisclosure>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * O pedido
 * ------------------------------------------------------------------ */

function RequestForm({
  project,
  busy,
  generation,
}: {
  project: Project;
  busy: boolean;
  generation: { enabled: boolean; reason: string | null };
}) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const [pedido, setPedido] = useState("");
  const anexos = useAdjustAttachments(project.id, attachmentApi);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const semPermissao = !can("gerar") ? noPermission.gerar : !can("publicar") ? "Sua chave de acesso não pode publicar: o ajuste vai ao GitHub e à área de aprovação do cliente." : null;
  const bloqueio = semPermissao ?? (busy ? claudeBlock.naFila : !generation.enabled ? claudeBlock.desligada : null);

  const pedir = async () => {
    requestNotificationPermission();
    setWorking(true);
    try {
      await requestRepoEdit(project.id, pedido.trim(), attachmentsPayload(anexos.draft, anexos.items));
      setPedido("");
      anexos.reset();
      await refresh();
      toast.success("Ajuste na fila do Claude", { description: "O andamento aparece aqui e na fila do Claude." });
    } catch (err) {
      toast.error("O ajuste não entrou na fila", { description: errorMessage(err) });
    } finally {
      setWorking(false);
    }
  };

  return (
    <section aria-labelledby="ajustes-pedido" className="space-y-2">
      <h3 id="ajustes-pedido" className="text-section">
        <Label htmlFor="ajustes-texto" className="text-section">
          Pedir um ajuste
        </Label>
      </h3>
      {!generation.enabled && <GenerationOffNotice reason={generation.reason} />}
      <Textarea
        id="ajustes-texto"
        rows={4}
        value={pedido}
        disabled={Boolean(semPermissao) || busy}
        onChange={(event) => setPedido(event.target.value)}
        onPaste={(event) => {
          // Uma captura de tela colada vira anexo; texto colado segue normal.
          const imagens = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (!imagens.length) return;
          event.preventDefault();
          void anexos.add(imagens);
        }}
        placeholder="O que deve mudar no site: “troque a foto do topo pela fachada” ou “deixe o rodapé com o endereço completo”."
        className="max-h-60 resize-y text-sm leading-relaxed"
      />
      <AdjustAttachments attachments={anexos} disabled={Boolean(semPermissao) || busy || working} />
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <div className="mr-auto min-w-0 flex-1 basis-64 space-y-0.5 text-xs text-muted-foreground">
          {bloqueio && <Reason>{bloqueio}</Reason>}
          <p>
            O Claude parte da última versão do GitHub. Se o build passar, o painel envia: a área de aprovação republica e o
            Lovable recebe a mudança. Não edite este site no Lovable enquanto o ajuste roda.
          </p>
        </div>
        <DisabledHint reason={bloqueio}>
          <Button
            size="sm"
            disabled={Boolean(bloqueio) || !pedido.trim() || working || anexos.uploading}
            onClick={() => setConfirming(true)}
          >
            {working ? <Loader2 className="animate-spin" /> : <PencilLine />}
            Pedir ajuste
          </Button>
        </DisabledHint>
      </div>

      <ConfirmClaudeDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Pedir o ajuste ao Claude?"
        confirmLabel="Ajustar e usar a assinatura"
        onConfirm={() => void pedir()}
      >
        O painel busca a última versão do site no GitHub e o Claude aplica o que foi pedido
        {anexos.items.length > 0 && `, olhando ${pluralize(anexos.items.length, "imagem anexada", "imagens anexadas")}`}. Se o
        build passar, o ajuste vai ao GitHub — a área de aprovação do cliente republica e o Lovable recebe a mudança. Até
        terminar, não edite o site no Lovable.
      </ConfirmClaudeDialog>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * A memória dos ajustes
 * ------------------------------------------------------------------ */

function EditsMemory({ project, edits }: { project: Project; edits: RepoEdit[] }) {
  const [logOf, setLogOf] = useState<RepoEdit | null>(null);
  return (
    <section aria-labelledby="ajustes-memoria" className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h3 id="ajustes-memoria" className="text-section">
          Memória dos ajustes
        </h3>
        {edits.length > 0 && <span className="text-xs text-muted-foreground">{pluralize(edits.length, "pedido")} · o próximo pedido leva os últimos como contexto</span>}
      </header>
      {edits.length === 0 ? (
        <EmptyNotice
          icon={<History />}
          title="Nenhum ajuste pedido ainda"
          description="Cada pedido fica aqui: o que foi pedido, de qual versão partiu, o que o Claude fez e o commit no GitHub."
          className="rounded-xl border"
        />
      ) : (
        <ol className="space-y-3">
          {edits.map((edit) => (
            <EditEntry key={edit.id} edit={edit} onShowLog={() => setLogOf(edit)} />
          ))}
        </ol>
      )}
      <EditLogDialog project={project} edit={logOf} onClose={() => setLogOf(null)} />
    </section>
  );
}

function EditEntry({ edit, onShowLog }: { edit: RepoEdit; onShowLog: () => void }) {
  const status = statusView[edit.status];
  const terminou = edit.status !== "queued" && edit.status !== "running";
  return (
    <li className="space-y-2.5 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Badge variant={status.variant} className="gap-1 [&_svg]:size-3">
          {status.icon}
          {status.label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {edit.by ? `${edit.by} · ` : ""}
          <When at={edit.createdAt} />
          {edit.durationMs ? ` · levou ${formatElapsed(edit.durationMs)}` : ""}
        </span>
        {edit.runId && (
          <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={onShowLog}>
            <ScrollText />
            Ver log
          </Button>
        )}
      </div>

      <p className="text-sm whitespace-pre-wrap">{edit.request}</p>
      {edit.attachments.length > 0 && (
        <p className="text-xs text-muted-foreground">Com {pluralize(edit.attachments.length, "imagem", "imagens")}: {edit.attachments.join(", ")}</p>
      )}

      {edit.base && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          Partiu da versão em que a última alteração foi de
          <OriginBadge commit={edit.base} />
          <span className="truncate" title={edit.base.message}>
            (“{edit.base.message}”, <When at={edit.base.at} />)
          </span>
        </p>
      )}

      {terminou && (edit.summary || edit.error) && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
            edit.error ? "bg-destructive-soft text-destructive" : "bg-muted/60 text-foreground",
          )}
        >
          {edit.error ? (
            <span className="inline-flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{edit.error}</span>
            </span>
          ) : (
            <>
              <span className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ClaudeIcon className="size-3.5" /> O que o Claude fez
              </span>
              {edit.summary}
            </>
          )}
        </div>
      )}

      {edit.commit && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <a href={edit.commit.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline">
            <GitHubIcon className="size-3.5" />
            Commit <span className="font-mono">{shortSha(edit.commit.sha)}</span>
            <ExternalLink className="size-3" />
          </a>
          <span className="truncate" title={edit.commit.files.join("\n")}>
            {pluralize(edit.commit.files.length, "arquivo")}: {edit.commit.files.join(", ")}
          </span>
        </div>
      )}
    </li>
  );
}

function EditLogDialog({ project, edit, onClose }: { project: Project; edit: RepoEdit | null; onClose: () => void }) {
  const log = useQuery({
    queryKey: ["repo-edit-log", project.id, edit?.id],
    queryFn: () => fetchRepoEditLog(project.id, edit!.id),
    enabled: Boolean(edit?.runId),
  });
  return (
    <Dialog open={Boolean(edit)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Log do ajuste</DialogTitle>
          <DialogDescription className="line-clamp-2">{edit?.request}</DialogDescription>
        </DialogHeader>
        {log.isLoading ? (
          <Skeleton className="h-80 rounded-lg" />
        ) : log.error ? (
          <p className="text-sm text-destructive">{errorMessage(log.error, "Não foi possível ler o log.")}</p>
        ) : (
          <ClaudeLog lines={log.data?.lines ?? []} empty="Este ajuste não deixou log." className="h-[60vh]" />
        )}
      </DialogContent>
    </Dialog>
  );
}
