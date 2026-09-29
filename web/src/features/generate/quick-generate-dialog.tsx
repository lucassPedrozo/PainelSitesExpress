import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BuildPackage, Project } from "@/lib/api";
import { fetchBuildPackage, generateSite } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { quickPlan, type QuickPlan } from "./quick-generate";
import { LovableReturnDialog } from "./lovable-return-dialog";
import { useLovableConnection, useWorkspaceChoice } from "./use-lovable";

/**
 * Gerar sem abrir o diálogo completo — um site ou vários.
 *
 * O diálogo completo mostra o briefing e os arquivos para revisar, e na
 * maioria das vezes se clicava "Gerar" sem mexer em nada. Aqui vai o envio
 * padrão (briefing + anexos recomendados + assinatura), com uma confirmação
 * só — inclusive para uma fila de projetos, gerados um depois do outro.
 */

type Row =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; plan: Extract<QuickPlan, { ok: true }>; pkg: BuildPackage }
  | { status: "blocked"; reason: string }
  | { status: "generating" | "done"; plan: Extract<QuickPlan, { ok: true }> }
  | { status: "failed"; message: string; plan: Extract<QuickPlan, { ok: true }> };

type Phase = "select" | "confirm" | "running" | "finished";

/** Leituras do Drive em paralelo, sem afogar a API com dezenas de uma vez. */
const LOAD_CONCURRENCY = 3;

export function QuickGenerateDialog({
  projects,
  onOpenChange,
  onReview,
  onGenerated,
}: {
  /** `null` fecha o diálogo. */
  projects: Project[] | null;
  onOpenChange: (open: boolean) => void;
  /** Abre o diálogo completo — só oferecido com um projeto. */
  onReview: (project: Project) => void;
  onGenerated: () => void;
}) {
  const [running, setRunning] = useState(false);
  return (
    <Dialog
      open={Boolean(projects)}
      // Fechar no meio da fila deixaria a geração seguindo sem ninguém ver.
      onOpenChange={(open) => !running && onOpenChange(open)}
    >
      <DialogContent
        className="flex max-h-[88vh] flex-col sm:max-w-2xl"
        showCloseButton={!running}
        onInteractOutside={(event) => running && event.preventDefault()}
      >
        {projects && (
          <QuickGenerateContent
            key={projects.map((p) => p.id).join(",")}
            projects={projects}
            onRunningChange={setRunning}
            onReview={onReview}
            onGenerated={onGenerated}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickGenerateContent({
  projects,
  onRunningChange,
  onReview,
  onGenerated,
  onClose,
}: {
  projects: Project[];
  onRunningChange: (running: boolean) => void;
  onReview: (project: Project) => void;
  onGenerated: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const lovable = useLovableConnection();
  const { workspaceId, choose } = useWorkspaceChoice(lovable.workspaces);
  const workspaceName =
    lovable.workspaces.find((item) => item.id === workspaceId)?.name ?? workspaceId;

  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(projects.map((p) => [p.id, { status: "loading" } as Row])),
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("select");
  const batch = projects.length > 1;
  const single = projects[0];

  const setRow = (id: string, row: Row) =>
    setRows((current) => ({ ...current, [id]: row }));

  // ---- Carga dos pacotes -------------------------------------------------
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const fila = [...projects];
    const worker = async () => {
      for (let project = fila.shift(); project; project = fila.shift()) {
        const atual = project;
        try {
          const pkg = await queryClient.fetchQuery({
            queryKey: queryKeys.buildPackage(atual.id),
            queryFn: () => fetchBuildPackage(atual.id),
            staleTime: 5 * 60_000,
          });
          const plan = quickPlan(atual, pkg);
          if (plan.ok) {
            setRow(atual.id, { status: "ready", plan, pkg });
            setChecked((current) => new Set(current).add(atual.id));
          } else {
            setRow(atual.id, { status: "blocked", reason: plan.reason });
          }
        } catch (err) {
          setRow(atual.id, {
            status: "error",
            message: err instanceof Error ? err.message : "Falha ao ler o Drive",
          });
        }
      }
    };
    void Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
  }, [projects, queryClient]);

  const loading = Object.values(rows).some((row) => row.status === "loading");
  const chosen = projects.filter(
    (p) => checked.has(p.id) && rows[p.id]?.status === "ready",
  );
  const disabledReason = useMemo(() => {
    const pkg = Object.values(rows).find(
      (row): row is Extract<Row, { status: "ready" }> => row.status === "ready",
    )?.pkg;
    if (pkg && !pkg.generation.enabled) return pkg.generation.reason;
    if (lovable.status && !lovable.connected) return "O painel não está conectado ao Lovable.";
    if (lovable.connected && !workspaceId) return "Escolha o workspace do Lovable.";
    return null;
  }, [rows, lovable.status, lovable.connected, workspaceId]);

  // ---- Geração em fila ---------------------------------------------------
  const run = async () => {
    requestNotificationPermission();
    setPhase("running");
    onRunningChange(true);
    let ok = 0;
    for (const project of chosen) {
      const row = rows[project.id];
      if (row?.status !== "ready") continue;
      setRow(project.id, { status: "generating", plan: row.plan });
      try {
        await generateSite(project.id, {
          prompt: row.plan.prompt,
          fileIds: row.plan.fileIds,
          workspaceId,
          workspaceName,
        });
        ok += 1;
        setRow(project.id, { status: "done", plan: row.plan });
      } catch (err) {
        setRow(project.id, {
          status: "failed",
          plan: row.plan,
          message: err instanceof Error ? err.message : "A geração falhou",
        });
      }
    }
    onRunningChange(false);
    setPhase("finished");
    onGenerated();
    if (ok === chosen.length) {
      toast.success(ok === 1 ? "Site criado no Lovable" : `${ok} sites criados no Lovable`, {
        description: "O painel avisa quando cada um ficar pronto.",
      });
    } else {
      toast.warning(`${ok} de ${chosen.length} sites criados`, {
        description: "Veja na lista o motivo de cada falha.",
      });
    }
    if (!batch && ok === 1) onClose();
  };

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const prontos = projects.filter((p) => rows[p.id]?.status === "ready");
  const enviados = projects.filter((p) => rows[p.id]?.status === "done").length;
  const todosMarcados = prontos.length > 0 && prontos.every((p) => checked.has(p.id));

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {batch ? `Gerar ${projects.length} sites` : `Gerar site — ${projectIdentity(single).label}`}
        </DialogTitle>
        <DialogDescription>
          Cada site vai com o envio padrão: o briefing do Drive como está, as
          imagens e compactados da pasta e a assinatura Joinvix.{" "}
          {batch
            ? "Nada é enviado antes de você confirmar."
            : "Para mexer no prompt ou nos anexos, use “Revisar tudo”."}
        </DialogDescription>
      </DialogHeader>

      {/* O que acontece depois do clique. Antes a fila dizia só "um depois do
          outro", e não ficava claro que o painel apenas entrega os projetos ao
          Lovable — a construção vem depois, lá, e o card mostra o andamento. */}
      {batch && (
        <ol className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-3">
          <li className={cn(phase === "running" && "font-medium text-foreground")}>
            <span className="font-medium">1. Envio ao Lovable</span>
            <span className="block text-muted-foreground">
              Um projeto por vez, uns segundos cada. Esta aba precisa ficar aberta
              só até esta etapa terminar.
            </span>
          </li>
          <li className={cn(phase === "finished" && "font-medium text-foreground")}>
            <span className="font-medium">2. Construção no Lovable</span>
            <span className="block text-muted-foreground">
              Todos ao mesmo tempo, lá. O card de cada projeto mostra a fase e o
              tempo — pode fechar este diálogo.
            </span>
          </li>
          <li>
            <span className="font-medium">3. Aviso de pronto</span>
            <span className="block text-muted-foreground">
              O painel avisa quando cada site termina ou para esperando resposta.
              Depois, conecte-o ao GitHub no Lovable.
            </span>
          </li>
        </ol>
      )}

      {batch && prontos.length > 0 && phase === "select" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={todosMarcados}
            onCheckedChange={(value) =>
              setChecked(value === true ? new Set(prontos.map((p) => p.id)) : new Set())
            }
          />
          Marcar todos os prontos
        </label>
      )}

      <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
        {projects.map((project) => (
          <QueueRow
            key={project.id}
            project={project}
            row={rows[project.id] ?? { status: "loading" }}
            selectable={batch && phase === "select"}
            checked={checked.has(project.id)}
            onToggle={() => toggle(project.id)}
          />
        ))}
      </ul>

      <LovableReturnDialog connection={lovable} />

      {!lovable.connected && lovable.status && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
          <Link2 className="size-4 shrink-0 text-warning" />
          <span className="min-w-40 flex-1">O painel não está conectado ao Lovable.</span>
          <Button size="sm" variant="outline" onClick={() => void lovable.connect()}>
            Conectar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void lovable.refresh()}>
            Conferir
          </Button>
        </div>
      )}

      {phase === "confirm" && (
        <p className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
          Isto gasta crédito do Lovable:{" "}
          <b className="font-medium">
            {chosen.length} {chosen.length === 1 ? "criação" : "criações"}
          </b>{" "}
          no workspace <b className="font-medium">{workspaceName}</b>.
          {batch && " O envio leva uns segundos por projeto; a construção continua no Lovable depois."}
        </p>
      )}
      {phase === "running" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Enviando ao Lovable: {enviados} de {chosen.length}. Mantenha esta aba
          aberta até o último ser enviado.
        </p>
      )}
      {phase === "finished" && batch && (
        <p className="text-sm text-muted-foreground">
          {enviados} de {chosen.length} enviados. O Lovable está construindo —
          acompanhe a fase e o tempo de cada um no card. Pode fechar.
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex items-center gap-2">
          {lovable.workspaces.length > 1 && phase === "select" && (
            <Select value={workspaceId} onValueChange={choose}>
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {lovable.workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                    {workspace.role !== "owner" && " (colaborador)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {phase === "select" && (loading || disabledReason) && (
            <span className="text-xs text-muted-foreground">
              {disabledReason ?? "Lendo o material no Drive…"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {phase === "select" && !batch && (
            <Button variant="outline" onClick={() => onReview(single)}>
              Revisar tudo
            </Button>
          )}
          {phase === "select" && (
            <Button
              disabled={chosen.length === 0 || Boolean(disabledReason)}
              onClick={() => setPhase("confirm")}
            >
              <Sparkles className="size-4" />
              {batch ? `Continuar com ${chosen.length} ${chosen.length === 1 ? "site" : "sites"}` : "Gerar site"}
            </Button>
          )}
          {phase === "confirm" && (
            <>
              <Button variant="outline" onClick={() => setPhase("select")}>
                Voltar
              </Button>
              <Button onClick={() => void run()}>
                {batch ? `Confirmar e enviar ${chosen.length}` : "Confirmar e gerar"}
              </Button>
            </>
          )}
          {phase === "finished" && <Button onClick={onClose}>Fechar</Button>}
        </div>
      </DialogFooter>
    </>
  );
}

function QueueRow({
  project,
  row,
  selectable,
  checked,
  onToggle,
}: {
  project: Project;
  row: Row;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const plan = "plan" in row ? row.plan : null;
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      {selectable && (
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={row.status !== "ready"}
          onCheckedChange={onToggle}
          aria-label={`Incluir ${projectIdentity(project).label}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{projectIdentity(project).label}</p>
        <p
          className={cn(
            "text-xs text-muted-foreground",
            (row.status === "blocked" || row.status === "error" || row.status === "failed") &&
              "text-destructive",
          )}
        >
          {row.status === "loading" && "Lendo o material no Drive…"}
          {row.status === "blocked" && row.reason}
          {row.status === "error" && row.message}
          {row.status === "failed" && row.message}
          {row.status === "generating" && "Enviando ao Lovable…"}
          {row.status === "done" && "Enviado — o Lovable está construindo. O card mostra o andamento."}
          {plan &&
            (row.status === "ready" || row.status === "blocked") &&
            `${plan.attachments} ${plan.attachments === 1 ? "anexo" : "anexos"} + assinatura · ${plan.promptChars.toLocaleString("pt-BR")} caracteres de briefing`}
        </p>
        {plan && row.status === "ready" && plan.warnings.length > 0 && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            {plan.warnings.join(" ")}
          </p>
        )}
      </div>
      <span className="shrink-0 pt-0.5">
        {row.status === "loading" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {row.status === "generating" && <Loader2 className="size-4 animate-spin text-info" />}
        {row.status === "done" && <CheckCircle2 className="size-4 text-success" />}
        {row.status === "failed" && <XCircle className="size-4 text-destructive" />}
      </span>
    </li>
  );
}
