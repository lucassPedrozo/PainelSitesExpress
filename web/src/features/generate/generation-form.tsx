import { useMemo, useState } from "react";
import { AlertTriangle, FileSearch, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type {
  BuildFile,
  BuildPackage,
  GenerationPlan,
  GenerationResult,
  LovableWorkspace,
  Project,
} from "@/lib/api";
import { generateSite, previewGeneration } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AttachmentsSection } from "./attachments-section";
import {
  composePrompt,
  initialSelection,
  selectAll,
  summarizeSelection,
} from "./generation-prompt";
import {
  ConfirmGenerationDialog,
  PlanSummary,
  PreviousGenerations,
} from "./generation-notices";
import { PromptSection } from "./prompt-section";
import { ResultPanel } from "./result-panel";
import { useWorkspaceChoice } from "./use-lovable";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";


/**
 * O que vai ao Lovable: prompt, anexos e a confirmação do gasto.
 *
 * Montado com `key` do projeto, então o estado nasce do pacote já carregado —
 * antes um `useEffect` preenchia prompt e seleção depois da primeira
 * renderização, e a tela piscava vazia entre as duas.
 */
export function GenerationForm({
  project,
  pkg,
  connected,
  workspaces,
  onGenerated,
}: {
  project: Project;
  pkg: BuildPackage;
  connected: boolean;
  workspaces: LovableWorkspace[];
  /** Avisa o painel para recarregar — é assim que o link aparece no card. */
  onGenerated: () => void;
}) {
  const [prompt, setPrompt] = useState(pkg.prompt.text);
  /**
   * Instruções do operador, separadas do briefing. Misturar as duas coisas
   * faria perder de vista o que é pedido do cliente e o que é decisão nossa.
   */
  const [observations, setObservations] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialSelection(pkg.files, pkg.limits.maxAttachments),
  );
  const [plan, setPlan] = useState<GenerationPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const { workspaceId, choose } = useWorkspaceChoice(workspaces);
  const workspaceName =
    workspaces.find((item) => item.id === workspaceId)?.name ?? workspaceId;

  const finalPrompt = useMemo(
    () => composePrompt(prompt, observations),
    [prompt, observations],
  );
  const resumo = useMemo(
    () => summarizeSelection(pkg, selected, finalPrompt),
    [pkg, selected, finalPrompt],
  );

  const canSend =
    finalPrompt.length > 0 && !resumo.overLimit && !resumo.promptTooLong && !busy;

  /** Mexer no envio invalida a conferência anterior: ela era de outro conteúdo. */
  const changed = () => setPlan(null);

  const toggle = (file: BuildFile) => {
    if (file.blockedReason) return;
    changed();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file.id)) next.delete(file.id);
      else next.add(file.id);
      return next;
    });
  };

  const runPreview = async () => {
    setBusy("preview");
    try {
      const data = await previewGeneration(project.id, {
        prompt: finalPrompt,
        fileIds: [...selected],
      });
      setPlan(data.plan);
      toast.success("Envio conferido", {
        description: "Nenhuma chamada ao Lovable foi feita.",
      });
    } catch (err) {
      setPlan(null);
      toast.error("A conferência apontou um problema", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const runGenerate = async () => {
    requestNotificationPermission();
    setBusy("generate");
    try {
      const data = await generateSite(project.id, {
        prompt: finalPrompt,
        fileIds: [...selected],
        workspaceId,
        workspaceName,
      });
      setResult(data);
      onGenerated();
      toast.success("Site criado no Lovable", {
        description: "O link ficou salvo no card do projeto.",
      });
    } catch (err) {
      toast.error("A geração falhou", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* Numa coluna só as duas seções empilham e passam da altura do
          diálogo: a área rola, em vez de uma seção invadir a outra. Em duas
          colunas cada seção rola por dentro. */}
      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:auto-rows-auto lg:grid-cols-[1.05fr_1fr] lg:divide-x lg:overflow-visible">
        <PromptSection
          pkg={pkg}
          prompt={prompt}
          onPromptChange={(value) => {
            setPrompt(value);
            changed();
          }}
          observations={observations}
          onObservationsChange={(value) => {
            setObservations(value);
            changed();
          }}
          summary={resumo}
        />

        <AttachmentsSection
          pkg={pkg}
          selected={selected}
          summary={resumo}
          onToggle={toggle}
          onSelectAll={() => {
            changed();
            setSelected(selectAll(pkg.files, pkg.limits.maxAttachments));
          }}
          onSelectNone={() => {
            changed();
            setSelected(new Set());
          }}
        />
      </div>

      {/* ---- Rodapé ---------------------------------------------------- */}
      <div className="space-y-3 border-t px-6 py-3">
        {!result && <PreviousGenerations project={project} />}
        {plan && <PlanSummary plan={plan} />}
        {result && <ResultPanel result={result} />}

        {pkg.signature.missing.length > 0 ? (
          <p className="flex items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Assinatura Joinvix incompleta — falta{" "}
            {pkg.signature.missing.map((v) => `“Rodapé ${v}”`).join(" e ")}: o painel
            não conseguiu baixar do repositório joinvix-footer. Se gerar assim, o
            build da publicação insere a assinatura no fim da página.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Vão junto, em todo site: {pkg.signature.files.join(" e ")} (assinatura
            Joinvix do rodapé).
          </p>
        )}

        {!pkg.generation.enabled && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            {pkg.generation.reason}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {workspaces.length > 0 && (
              <Select value={workspaceId} onValueChange={choose}>
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue placeholder="Escolha o workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                      {workspace.role !== "owner" && " (colaborador)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span
              className={cn(
                "text-xs tabular-nums text-muted-foreground",
                resumo.overLimit && "text-destructive",
              )}
            >
              {selected.size} anexo(s)
              {resumo.totalBytes > 0 && ` · ${formatBytes(resumo.totalBytes)}`}
              {resumo.overLimit &&
                ` · acima do limite de ${pkg.limits.maxAttachments}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canSend}
              onClick={() => void runPreview()}
            >
              {busy === "preview" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSearch className="size-4" />
              )}
              Conferir envio
            </Button>
            <Button
              size="sm"
              disabled={
                !canSend || !connected || !pkg.generation.enabled || !workspaceId
              }
              onClick={() => setConfirming(true)}
            >
              {busy === "generate" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Gerar site
            </Button>
          </div>
        </div>
      </div>

      <ConfirmGenerationDialog
        open={confirming}
        onOpenChange={setConfirming}
        promptChars={resumo.promptChars}
        attachments={selected.size + pkg.signature.files.length}
        workspaceName={workspaceName}
        onConfirm={() => void runGenerate()}
      />
    </>
  );
}
