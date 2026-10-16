import { useMemo, useState } from "react";
import { FileSearch, ImageIcon, Loader2, Sparkles } from "lucide-react";
import { GoogleDriveIcon } from "@/components/brand-icons";
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
import { DisabledHint, Reason } from "@/components/disabled-hint";
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
import { GenerationOffNotice } from "@/features/claude/claude-shared";
import { generationOffTitle } from "@/features/claude/claude-text";
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
import { OpenInLovable, ResultPanel } from "./result-panel";
import { StockImagesSection } from "./stock-images-section";
import { nextStockSelection, rowsFromQueries, toggleStockPick, type StockPick } from "./stock-images";
import { useWorkspaceChoice } from "./use-lovable";
import { useStockSearch } from "./use-stock-search";
import { requestNotificationPermission } from "@/lib/notifications";

/**
 * A escolha do workspace do Lovable — a mesma no diálogo completo e no
 * gerar rápido, do mesmo tamanho nos dois.
 */
export function WorkspaceSelect({
  id,
  workspaces,
  value,
  onChange,
}: {
  id: string;
  workspaces: LovableWorkspace[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Workspace
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-52">
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
  );
}

/**
 * O que vai ao Lovable: prompt, anexos e a confirmação do gasto.
 *
 * A ordem de leitura é a ordem de decisão: primeiro o que impede (geração
 * desligada), depois o que o envio tem e o que falta, depois o prompt e os
 * anexos para completar, e por fim o envio — no rodapé, sempre à vista, com o
 * contador do envio (um só) e o motivo escrito quando o botão não está livre.
 *
 * Montado com `key` do projeto, então o estado nasce do pacote já carregado.
 */
export function GenerationForm({
  project,
  pkg,
  connected,
  workspaces,
  onGenerated,
  onClose,
}: {
  project: Project;
  pkg: BuildPackage;
  connected: boolean;
  workspaces: LovableWorkspace[];
  /** Avisa o painel para recarregar — é assim que o link aparece no card. */
  onGenerated: () => void;
  /** Fecha o diálogo: depois de gerar, é a saída. */
  onClose: () => void;
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
        description: "O link ficou salvo no projeto.",
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

  // Por que "Conferir envio" não está livre: o envio vazio ou acima do limite.
  const motivoDoEnvio =
    finalPrompt.length === 0
      ? "Escreva o briefing ou as observações para ter o que enviar."
      : limitesEstourados
        ? `O envio passou do limite: ${limitesEstourados}.`
        : null;
  // Por que "Gerar site" não está livre — escrito no rodapé, ao lado do botão.
  const motivoDeGerar = !pkg.generation.enabled
    ? `${generationOffTitle.lovable}.`
    : !connected
      ? "Conecte o painel ao Lovable para gerar."
      : !workspaceId
        ? "Escolha o workspace do Lovable."
        : motivoDoEnvio;

  return (
    <>
      {/* ---- Antes de tudo: o que impede, e o que o envio tem ------------- */}
      <div className="shrink-0 space-y-3 border-b px-6 py-3">
        {!pkg.generation.enabled && <GenerationOffNotice engine="lovable" reason={pkg.generation.reason} />}
        <BriefingAssessment assessment={avaliacao} onGoTo={goTo} />
        {!result && <PreviousGenerations project={project} />}
      </div>

      {/* Numa coluna só as duas seções empilham e passam da altura do
          diálogo: a área rola, em vez de uma seção invadir a outra. Em duas
          colunas a linha da grade fica presa à altura que sobra
          (`grid-rows-1` = minmax(0,1fr)) e cada seção rola por dentro; com
          `auto-rows-auto` a linha crescia com o conteúdo e vazava por cima
          do rodapé. */}
      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:grid-cols-2 lg:grid-rows-1 lg:divide-x lg:overflow-hidden">
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
                { value: "drive", label: "Do Drive", icon: <GoogleDriveIcon />, count: selected.size },
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

      {/* ---- Rodapé: o envio, numa linha, e os botões ---------------------- */}
      <div className="shrink-0 space-y-3 border-t bg-muted/40 px-6 py-3">
        {plan && !result && <PlanSummary plan={plan} />}
        {result && <ResultPanel result={result} />}

        {result ? (
          // Gerado: o rodapé troca de vez. Um segundo "Gerar site" criaria
          // outro projeto no Lovable — outro débito —, então gerar de novo
          // pede fechar e abrir o diálogo outra vez.
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <OpenInLovable result={result} />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              {workspaces.length > 0 && (
                <WorkspaceSelect
                  id="lovable-workspace"
                  workspaces={workspaces}
                  value={workspaceId}
                  onChange={choose}
                />
              )}
              <div className="min-w-0 space-y-0.5">
                {/* O contador do envio, num lugar só: anexos, tamanho e caracteres. */}
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
                  {` · ${resumo.promptChars.toLocaleString("pt-BR")} de ${pkg.limits.maxPromptChars.toLocaleString("pt-BR")} caracteres`}
                </p>
                {motivoDeGerar ? (
                  <Reason>{motivoDeGerar}</Reason>
                ) : (
                  <p className="text-xs text-muted-foreground">{avaliacao.summary}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={!canSend}
                onClick={() => void runPreview()}
                title="Valida o envio sem falar com o Lovable — não gasta crédito."
              >
                {busy === "preview" ? <Loader2 className="animate-spin" /> : <FileSearch />}
                Conferir envio
              </Button>
              <DisabledHint reason={motivoDeGerar}>
                <Button
                  disabled={!canSend || Boolean(motivoDeGerar)}
                  onClick={() => setConfirming(true)}
                >
                  {busy === "generate" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Gerar site
                </Button>
              </DisabledHint>
            </div>
          </div>
        )}
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
