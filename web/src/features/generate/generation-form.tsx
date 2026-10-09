import { useMemo, useState } from "react";
import { FileSearch, FolderOpen, ImageIcon, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type {
  BriefingAnalysis,
  BuildFile,
  BuildPackage,
  GenerationPlan,
  GenerationResult,
  LovableWorkspace,
  Project,
  StockSearchResult,
} from "@/lib/api";
import { generateSite, previewGeneration } from "@/lib/api";
import { formatBytes, pluralize, projectIdentity } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/segmented";
import { cn } from "@/lib/utils";
import { stockImagesBlock } from "@shared/stock-images.js";
import { AssistantPanel } from "./assistant-panel";
import { AttachmentsSection } from "./attachments-section";
import { assessBriefing, type AssessmentKey } from "./briefing-assessment";
import { BriefingAssessment } from "./briefing-assessment-view";
import {
  appendObservation,
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
import { OBSERVATIONS_INPUT_ID, PromptSection } from "./prompt-section";
import { ResultPanel } from "./result-panel";
import { StockImagesSection } from "./stock-images-section";
import { nextStockSelection, rowsFromQueries, toggleStockPick, type StockPick } from "./stock-images";
import { useWorkspaceChoice } from "./use-lovable";
import { useStockSearch } from "./use-stock-search";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";

/**
 * O que vai ao Lovable: prompt, anexos e a confirmação do gasto.
 *
 * A ordem de leitura é a ordem de decisão: primeiro o que impede (geração
 * desligada), depois o que o envio tem e o que falta, depois o prompt e os
 * anexos para completar, e por fim o envio. Antes o bloqueio e a assinatura
 * ficavam no rodapé, em cinza, e a pessoa preenchia tudo para descobrir no
 * fim que o botão não ia funcionar.
 *
 * Montado com `key` do projeto, então o estado nasce do pacote já carregado.
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
  /** Fotos de banco (Pixabay): o resultado da busca e as marcadas. */
  const [stockResults, setStockResults] = useState<StockSearchResult[]>([]);
  const [stock, setStock] = useState<Map<number, StockPick>>(() => new Map());
  const [attachTab, setAttachTab] = useState<"drive" | "stock">("drive");
  const [plan, setPlan] = useState<GenerationPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const { workspaceId, choose } = useWorkspaceChoice(workspaces);
  const workspaceName =
    workspaces.find((item) => item.id === workspaceId)?.name ?? workspaceId;

  const stockImages = useMemo(
    () => [...stock.values()].map(({ id, term, section }) => ({ id, term, section })),
    [stock],
  );
  const stockBlock = useMemo(() => stockImagesBlock(stockImages), [stockImages]);
  const finalPrompt = useMemo(
    () => composePrompt(prompt, observations, stockBlock),
    [prompt, observations, stockBlock],
  );
  const resumo = useMemo(
    () => summarizeSelection(pkg, selected, finalPrompt, stockImages.length),
    [pkg, selected, finalPrompt, stockImages.length],
  );
  const avaliacao = useMemo(
    () => assessBriefing({ pkg, prompt, observations, selected, stockCount: stockImages.length }),
    [pkg, prompt, observations, selected, stockImages.length],
  );

  const canSend =
    finalPrompt.length > 0 && !resumo.overLimit && !resumo.promptTooLong && !busy;

  /** Mexer no envio invalida a conferência anterior: ela era de outro conteúdo. */
  const changed = () => setPlan(null);

  /**
   * A busca no banco de imagens. Os termos moram aqui, e não na aba, para o
   * assistente poder preenchê-los e buscar de uma vez.
   */
  const stockSearch = useStockSearch({
    onResults: (results) => {
      changed();
      setStockResults(results);
      setStock((current) => nextStockSelection(current, results));
    },
  });

  /** Os nomes dos arquivos da pasta: a análise sabe o que há sem abrir nada. */
  const nomesDosArquivos = useMemo(() => pkg.files.map((file) => file.name), [pkg.files]);

  /** Uma sugestão do assistente vira parágrafo das observações — só por este clique. */
  const inserirObservacao = (text: string) => {
    setObservations((atual) => appendObservation(atual, text));
    changed();
    document.getElementById(OBSERVATIONS_INPUT_ID)?.focus();
  };

  /** As buscas sugeridas preenchem a aba do banco de imagens e rodam na hora. */
  const buscarSugeridas = (queries: BriefingAnalysis["imageQueries"]) => {
    if (!stockSearch.limits) return;
    setAttachTab("stock");
    void stockSearch.searchRows(rowsFromQueries(queries, stockSearch.limits));
  };

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

  /** Cada aviso da faixa leva ao lugar onde ele se completa. */
  const goTo = (key: AssessmentKey) => {
    if (key === "photos" || key === "logo") setAttachTab("drive");
    else if (key === "stock") setAttachTab("stock");
    else document.getElementById(OBSERVATIONS_INPUT_ID)?.focus();
  };

  const runPreview = async () => {
    setBusy("preview");
    try {
      const data = await previewGeneration(project.id, {
        prompt: finalPrompt,
        fileIds: [...selected],
        stockImages,
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
        stockImages,
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

  const limitesEstourados =
    resumo.overLimit || resumo.promptTooLong
      ? [
          resumo.overLimit && `acima do limite de ${pluralize(pkg.limits.maxAttachments, "anexo")}`,
          resumo.promptTooLong && `prompt acima de ${pkg.limits.maxPromptChars.toLocaleString("pt-BR")} caracteres`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <>
      {/* ---- Antes de tudo: o que impede, e o que o envio tem ------------- */}
      <div className="shrink-0 space-y-3 border-b px-6 py-3">
        {!pkg.generation.enabled && (
          <Alert variant="warning">
            <Lock />
            <AlertTitle>A geração está desligada neste painel</AlertTitle>
            <AlertDescription>{pkg.generation.reason}</AlertDescription>
          </Alert>
        )}
        <BriefingAssessment assessment={avaliacao} onGoTo={goTo} />
        {!result && <PreviousGenerations project={project} />}
      </div>

      {/* Numa coluna só as duas seções empilham e passam da altura do
          diálogo: a área rola, em vez de uma seção invadir a outra. Em duas
          colunas a linha da grade fica presa à altura que sobra
          (`grid-rows-1` = minmax(0,1fr)) e cada seção rola por dentro; com
          `auto-rows-auto` a linha crescia com o conteúdo e vazava por cima
          do rodapé. */}
      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:grid-cols-[1.05fr_1fr] lg:grid-rows-1 lg:divide-x lg:overflow-hidden">
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
          // O assistente lê o conteúdo e sugere; a faixa do topo só olha o
          // que existe. Só aparece com a chave do Gemini no servidor.
          assistant={
            <AssistantPanel
              projectId={project.id}
              projectName={projectIdentity(project).label}
              briefing={prompt}
              observations={observations}
              fileNames={nomesDosArquivos}
              stockEnabled={stockSearch.configured}
              onInsertObservation={inserirObservacao}
              onUseImageQueries={buscarSugeridas}
            />
          }
        />

        {/* Anexos: os arquivos do Drive e as fotos de banco, no mesmo teto.
            As duas abas ficam montadas para a busca não se perder na troca. */}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="px-6 pt-4">
            <Segmented
              label="Origem dos anexos"
              value={attachTab}
              onChange={setAttachTab}
              options={[
                { value: "drive", label: "Do Drive", icon: <FolderOpen />, count: selected.size },
                { value: "stock", label: "Banco de imagens", icon: <ImageIcon />, count: stock.size },
              ]}
            />
          </div>
          <AttachmentsSection
            className={cn("flex-1 pt-3", attachTab !== "drive" && "hidden")}
            pkg={pkg}
            selected={selected}
            summary={resumo}
            onToggle={toggle}
            onSelectAll={() => {
              changed();
              // O teto é do envio: o zip das fotos de banco ocupa uma vaga.
              setSelected(selectAll(pkg.files, pkg.limits.maxAttachments - (stock.size > 0 ? 1 : 0)));
            }}
            onSelectNone={() => {
              changed();
              setSelected(new Set());
            }}
          />
          <StockImagesSection
            className={cn("flex-1 pt-3", attachTab !== "stock" && "hidden")}
            search={stockSearch}
            picks={stock}
            results={stockResults}
            stockBlock={stockBlock}
            onToggle={(candidate, group) => {
              changed();
              setStock((current) => toggleStockPick(current, candidate, group));
            }}
          />
        </div>
      </div>

      {/* ---- Rodapé: o envio, numa linha, e os dois botões ---------------- */}
      <div className="shrink-0 space-y-3 border-t px-6 py-3">
        {plan && <PlanSummary plan={plan} />}
        {result && <ResultPanel result={result} />}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            {workspaces.length > 0 && (
              <div className="flex items-center gap-2">
                <Label htmlFor="lovable-workspace" className="text-xs text-muted-foreground">
                  Workspace
                </Label>
                <Select value={workspaceId} onValueChange={choose}>
                  <SelectTrigger id="lovable-workspace" size="sm" className="w-48 text-xs">
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
              </div>
            )}
            <p
              className={cn(
                "text-xs tabular-nums text-muted-foreground",
                limitesEstourados && "text-destructive",
              )}
            >
              {pluralize(resumo.attachmentCount, "anexo")}
              {resumo.stockCount > 0 && ` (um é o zip com ${pluralize(resumo.stockCount, "foto")} de banco)`}
              {" + assinatura"}
              {resumo.totalBytes > 0 && ` · ${formatBytes(resumo.totalBytes)}`}
              {` · ${pluralize(resumo.promptChars, "caractere")}`}
              {limitesEstourados && ` · ${limitesEstourados}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canSend}
              onClick={() => void runPreview()}
              title="Valida o envio sem falar com o Lovable — não gasta crédito."
            >
              {busy === "preview" ? <Loader2 className="animate-spin" /> : <FileSearch />}
              Conferir envio
            </Button>
            <Button
              size="sm"
              disabled={
                !canSend || !connected || !pkg.generation.enabled || !workspaceId
              }
              onClick={() => setConfirming(true)}
            >
              {busy === "generate" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Gerar site
            </Button>
          </div>
        </div>
      </div>

      <ConfirmGenerationDialog
        open={confirming}
        onOpenChange={setConfirming}
        promptChars={resumo.promptChars}
        attachments={resumo.attachmentCount + pkg.signature.files.length}
        workspaceName={workspaceName}
        warnings={avaliacao.warnings}
        onConfirm={() => void runGenerate()}
      />
    </>
  );
}
