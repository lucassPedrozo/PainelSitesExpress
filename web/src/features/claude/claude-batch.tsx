import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, CheckCircle2, Loader2, Lock, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/lib/api";
import { fetchClaudeMaterial, generateClaudeSite, requestClaudeBriefing } from "@/lib/api";
import { pluralize, projectIdentity } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { cn } from "@/lib/utils";
import { claudeBatchPlan, claudeBatchPlanFromProject, type ClaudeBatchPlan } from "./claude-batch-plan";
import { errorMessage, semPermissaoDeGerar } from "./claude-text";
import { useClaudeRefresh, useClaudeStatus } from "./use-claude";

/**
 * Vários projetos na fila do Claude de uma vez.
 *
 * Aqui o lote é só a entrada na fila: o painel copia o material de cada
 * projeto e enfileira o pedido, e quem atende — um por vez — é o servidor.
 * Por isso esta janela pode fechar assim que o último pedido entrar.
 */

type Ready = Extract<ClaudeBatchPlan, { ok: true }>;
type Row =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; plan: Ready }
  | { status: "blocked"; reason: string }
  | { status: "sending" | "done"; plan: Ready }
  | { status: "failed"; message: string; plan: Ready };

type Phase = "select" | "confirm" | "running" | "finished";

/** Leituras do material em paralelo, sem afogar a API. */
const LOAD_CONCURRENCY = 3;

const kindLabel = { briefing: "Briefing", site: "Site" } as const;

export function ClaudeBatchContent({
  projects,
  engineChoice,
  onRunningChange,
  onQueued,
  onClose,
}: {
  projects: Project[];
  /** A escolha do motor, no cabeçalho. */
  engineChoice: ReactNode;
  onRunningChange: (running: boolean) => void;
  /** Algo entrou na fila: a lista de projetos precisa ser relida. */
  onQueued: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const status = useClaudeStatus();
  const refresh = useClaudeRefresh();

  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(projects.map((project) => [project.id, { status: "loading" } as Row])),
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("select");

  const setRow = (id: string, row: Row) => setRows((current) => ({ ...current, [id]: row }));

  // ---- O pedido de cada projeto ------------------------------------------
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const aplicar = (project: Project, plan: ClaudeBatchPlan) => {
      if (plan.ok) {
        setRow(project.id, { status: "ready", plan });
        setChecked((current) => new Set(current).add(project.id));
      } else {
        setRow(project.id, { status: "blocked", reason: plan.reason });
      }
    };
    const fila = [...projects];
    const worker = async () => {
      for (let project = fila.shift(); project; project = fila.shift()) {
        const atual = project;
        // O que o card já sabe decide a maioria: só quem vai pedir briefing
        // precisa da leitura do material.
        const decidido = claudeBatchPlanFromProject(atual);
        if (decidido) {
          aplicar(atual, decidido);
          continue;
        }
        try {
          const material = await queryClient.fetchQuery({
            queryKey: queryKeys.claudeMaterial(atual.id),
            queryFn: () => fetchClaudeMaterial(atual.id),
            staleTime: 5 * 60_000,
          });
          aplicar(atual, claudeBatchPlan(atual, material));
        } catch (err) {
          setRow(atual.id, { status: "error", message: errorMessage(err, "Falha ao ler o material") });
        }
      }
    };
    void Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
  }, [projects, queryClient]);

  const loading = Object.values(rows).some((row) => row.status === "loading");
  const prontos = projects.filter((project) => rows[project.id]?.status === "ready");
  const chosen = prontos.filter((project) => checked.has(project.id));
  const enviados = projects.filter((project) => rows[project.id]?.status === "done").length;
  const todosMarcados = prontos.length > 0 && prontos.every((project) => checked.has(project.id));

  const disabledReason = !can("gerar")
    ? semPermissaoDeGerar
    : status.data && !status.data.installed
      ? (status.data.reason ?? "O motor Claude não está instalado neste painel.")
      : status.data && !status.data.generation.enabled
        ? "A geração pelo Claude está desligada neste painel."
        : null;

  // ---- A entrada na fila -------------------------------------------------
  const run = async () => {
    requestNotificationPermission();
    setPhase("running");
    onRunningChange(true);
    let ok = 0;
    for (const project of chosen) {
      const row = rows[project.id];
      if (row?.status !== "ready") continue;
      setRow(project.id, { status: "sending", plan: row.plan });
      try {
        if (row.plan.kind === "briefing") await requestClaudeBriefing(project.id, {});
        else await generateClaudeSite(project.id, {});
        ok += 1;
        setRow(project.id, { status: "done", plan: row.plan });
      } catch (err) {
        setRow(project.id, { status: "failed", plan: row.plan, message: errorMessage(err, "O pedido não entrou na fila") });
      }
    }
    onRunningChange(false);
    setPhase("finished");
    await refresh();
    onQueued();
    if (ok === chosen.length) {
      toast.success(`${pluralize(ok, "pedido entrou", "pedidos entraram")} na fila do Claude`, {
        description: "Um por vez. O card de cada projeto mostra o andamento.",
      });
    } else {
      toast.warning(`${ok} de ${chosen.length} pedidos entraram na fila`, {
        description: "Veja na lista o motivo de cada recusa.",
      });
    }
  };

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle>Pôr {pluralize(projects.length, "projeto")} na fila do Claude</DialogTitle>
          {engineChoice}
        </div>
        <DialogDescription>
          Quem ainda não tem briefing pede o briefing, com o material recomendado do projeto; quem já tem um
          briefing aceito pede o site. Nada entra na fila antes de você confirmar.
        </DialogDescription>
      </DialogHeader>

      <ol className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-3">
        <li className={cn(phase === "running" && "font-medium text-foreground")}>
          <span className="font-medium">1. Entrada na fila</span>
          <span className="block text-muted-foreground">
            O painel copia o material de cada projeto e enfileira o pedido. Esta aba precisa ficar aberta só
            até aqui.
          </span>
        </li>
        <li className={cn(phase === "finished" && "font-medium text-foreground")}>
          <span className="font-medium">2. Um por vez</span>
          <span className="block text-muted-foreground">
            O Claude atende um pedido de cada vez, na ordem. A fila segue mesmo com o navegador fechado.
          </span>
        </li>
        <li>
          <span className="font-medium">3. A sua vez</span>
          <span className="block text-muted-foreground">
            Cada briefing espera a sua revisão antes de virar site. O site passa sozinho pela crítica e pelo
            refino e, entregue, espera o envio ao GitHub.
          </span>
        </li>
      </ol>

      <p className="text-xs text-muted-foreground">
        O lote não escolhe modelo, esforço nem opções do site: cada projeto usa o que tem gravado e, no que não
        escolheu, o padrão das Configurações.
      </p>

      {status.data && !status.data.generation.enabled && (
        <Alert variant="warning">
          <Lock />
          <AlertTitle>A geração pelo Claude está desligada neste painel</AlertTitle>
          <AlertDescription>{status.data.generation.reason}</AlertDescription>
        </Alert>
      )}

      {prontos.length > 0 && phase === "select" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={todosMarcados}
            onCheckedChange={(value) =>
              setChecked(value === true ? new Set(prontos.map((project) => project.id)) : new Set())
            }
          />
          Marcar todos os prontos
        </label>
      )}

      <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
        {projects.map((project) => (
          <BatchRow
            key={project.id}
            project={project}
            row={rows[project.id] ?? { status: "loading" }}
            selectable={phase === "select"}
            checked={checked.has(project.id)}
            onToggle={() => toggle(project.id)}
          />
        ))}
      </ul>

      {phase === "confirm" && (
        <Alert variant="warning">
          <Bot />
          <AlertTitle>
            Isto consome a assinatura do Claude Code: {pluralize(chosen.length, "pedido")} na fila
          </AlertTitle>
          <AlertDescription>
            Cada pedido dispara o Claude Code nesta máquina, um depois do outro.
          </AlertDescription>
        </Alert>
      )}
      {phase === "running" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Enfileirando: {enviados} de {chosen.length}. Mantenha esta aba aberta até o último entrar.
        </p>
      )}
      {phase === "finished" && (
        <p className="text-sm text-muted-foreground">
          {enviados} de {chosen.length} na fila. O Claude atende um por vez — pode fechar.
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {phase === "select" && (disabledReason ?? (loading ? "Lendo o material dos projetos…" : null))}
        </span>
        <div className="flex items-center gap-2">
          {phase === "select" && (
            <Button
              disabled={chosen.length === 0 || Boolean(disabledReason) || loading}
              onClick={() => setPhase("confirm")}
            >
              <Bot />
              Continuar com {pluralize(chosen.length, "pedido")}
            </Button>
          )}
          {phase === "confirm" && (
            <>
              <Button variant="outline" onClick={() => setPhase("select")}>
                Voltar
              </Button>
              <Button onClick={() => void run()}>Confirmar e usar a assinatura</Button>
            </>
          )}
          {phase === "finished" && <Button onClick={onClose}>Fechar</Button>}
        </div>
      </DialogFooter>
    </>
  );
}

function BatchRow({
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
  const nome = projectIdentity(project).label;
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      {selectable && (
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={row.status !== "ready"}
          onCheckedChange={onToggle}
          aria-label={`Incluir ${nome}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {nome}
          {plan && <span className="ml-2 text-xs font-normal text-muted-foreground">{kindLabel[plan.kind]}</span>}
        </p>
        <p
          className={cn(
            "text-xs text-muted-foreground",
            (row.status === "blocked" || row.status === "error" || row.status === "failed") && "text-destructive",
          )}
        >
          {row.status === "loading" && "Lendo o material…"}
          {row.status === "blocked" && row.reason}
          {row.status === "error" && row.message}
          {row.status === "failed" && row.message}
          {row.status === "sending" && "Copiando o material e enfileirando…"}
          {row.status === "done" && "Na fila do Claude. O card mostra o andamento."}
          {row.status === "ready" && row.plan.summary}
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
        {row.status === "sending" && <Loader2 className="size-4 animate-spin text-info" />}
        {row.status === "done" && <CheckCircle2 className="size-4 text-success" />}
        {row.status === "failed" && <XCircle className="size-4 text-destructive" />}
      </span>
    </li>
  );
}
