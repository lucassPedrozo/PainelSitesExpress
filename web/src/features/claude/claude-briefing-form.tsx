import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, FileSearch, FolderOpen, ImageIcon, Loader2, Lock, Search } from "lucide-react";
import { toast } from "sonner";
import type {
  BuildFile,
  ClaudeBriefingPlan,
  ClaudeMaterial,
  Project,
  StockSearchResult,
} from "@/lib/api";
import { fetchClaudeMaterial, isPanelProject, previewClaudeBriefing, requestClaudeBriefing } from "@/lib/api";
import { formatBytes, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { Segmented } from "@/components/segmented";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AttachmentRow } from "@/features/generate/attachment-row";
import { filterFiles } from "@/features/generate/generation-prompt";
import { StockImagesSection } from "@/features/generate/stock-images-section";
import { nextStockSelection, toggleStockPick, type StockPick } from "@/features/generate/stock-images";
import { useStockSearch } from "@/features/generate/use-stock-search";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { ConfirmClaudeDialog, HintWhenDisabled } from "./claude-shared";
import { errorMessage, semPermissaoDeGerar } from "./claude-text";
import { useClaudeRefresh } from "./use-claude";

/**
 * O primeiro passo da geração pelo Claude: o material do projeto que ele vai
 * ler para escrever o briefing.
 *
 * O Claude não recebe um prompt: lê os arquivos marcados, o texto das
 * informações do site e as observações do pedido, e devolve um briefing
 * estruturado — que alguém revisa antes de o site ser gerado. "Conferir
 * pedido" é um ensaio: mostra o que seria copiado e o comando que rodaria, sem
 * gastar nada.
 */
export function ClaudeBriefingForm({
  project,
  onRequested,
}: {
  project: Project;
  /** O pedido entrou na fila: o painel fecha este diálogo e mostra o andamento. */
  onRequested: (project: Project) => void;
}) {
  const material = useQuery({
    queryKey: queryKeys.claudeMaterial(project.id),
    queryFn: () => fetchClaudeMaterial(project.id),
    // A varredura do Drive é cara e o material não muda no meio do pedido.
    staleTime: 5 * 60_000,
  });

  if (material.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{errorMessage(material.error)}</p>
        <Button variant="outline" onClick={() => void material.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (material.isPending || !material.data) {
    return (
      <div className="grid flex-1 gap-4 p-6 lg:grid-cols-2">
        <Skeleton className="h-full min-h-64 rounded-xl" />
        <Skeleton className="h-full min-h-64 rounded-xl" />
      </div>
    );
  }
  return <BriefingRequest project={project} material={material.data} onRequested={onRequested} />;
}

function BriefingRequest({
  project,
  material,
  onRequested,
}: {
  project: Project;
  material: ClaudeMaterial;
  onRequested: (project: Project) => void;
}) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const fromPanel = isPanelProject(project);

  const [texto, setTexto] = useState(material.prompt.text);
  const [observacoes, setObservacoes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(material.files.filter((file) => file.recommended).map((file) => file.id)),
  );
  const [stockResults, setStockResults] = useState<StockSearchResult[]>([]);
  const [stock, setStock] = useState<Map<number, StockPick>>(() => new Map());
  const [tab, setTab] = useState<"files" | "stock">("files");
  const [query, setQuery] = useState("");
  const [conferido, setConferido] = useState<{ plan: ClaudeBriefingPlan; command: string } | null>(null);
  const [busy, setBusy] = useState<"preview" | "request" | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** Mexer no pedido invalida a conferência anterior: ela era de outro conteúdo. */
  const changed = () => setConferido(null);

  const stockSearch = useStockSearch({
    onResults: (results) => {
      changed();
      setStockResults(results);
      setStock((current) => nextStockSelection(current, results));
    },
  });

  const visible = useMemo(() => filterFiles(material.files, query), [material.files, query]);
  const selecionaveis = useMemo(() => material.files.filter((file) => !file.blockedReason), [material.files]);
  const marcados = useMemo(() => material.files.filter((file) => selected.has(file.id)), [material.files, selected]);
  const bytes = marcados.reduce((soma, file) => soma + (file.size ?? 0), 0);
  const stockImages = useMemo(
    () => [...stock.values()].map(({ id, term, section }) => ({ id, term, section })),
    [stock],
  );

  const { limits } = material;
  const excedido = [
    marcados.length > limits.maxArquivos && `acima de ${pluralize(limits.maxArquivos, "arquivo")}`,
    bytes > limits.maxBytesTotal && `acima de ${formatBytes(limits.maxBytesTotal)}`,
    texto.trim().length > limits.maxCaracteresDoTexto &&
      `texto acima de ${limits.maxCaracteresDoTexto.toLocaleString("pt-BR")} caracteres`,
    observacoes.trim().length > limits.maxCaracteresDasObservacoes &&
      `observações acima de ${limits.maxCaracteresDasObservacoes.toLocaleString("pt-BR")} caracteres`,
  ].filter(Boolean) as string[];
  // Sem nada marcado ainda dá para pedir, se as observações citarem o site do
  // cliente: quem reconhece o endereço é o motor, e a conferência diz.
  const vazio = marcados.length === 0 && !texto.trim() && stockImages.length === 0 && !observacoes.trim();
  const podeConferir = !busy && excedido.length === 0 && !vazio;

  const corpo = () => ({
    fileIds: [...selected],
    texto,
    observacoes,
    stockImages,
  });

  const toggle = (file: BuildFile) => {
    if (file.blockedReason) return;
    changed();
    setSelected((atual) => {
      const next = new Set(atual);
      if (next.has(file.id)) next.delete(file.id);
      else next.add(file.id);
      return next;
    });
  };

  const conferir = async () => {
    setBusy("preview");
    try {
      const data = await previewClaudeBriefing(project.id, corpo());
      setConferido({ plan: data.plan, command: data.command });
      toast.success("Pedido conferido", { description: "Nada foi copiado nem disparado." });
    } catch (err) {
      setConferido(null);
      toast.error("A conferência apontou um problema", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const pedir = async () => {
    requestNotificationPermission();
    setBusy("request");
    try {
      const data = await requestClaudeBriefing(project.id, corpo());
      await refresh();
      toast.success("Pedido na fila do Claude", {
        description:
          data.material.pulados.length > 0
            ? `${pluralize(data.material.arquivos, "arquivo copiado", "arquivos copiados")}; ${pluralize(data.material.pulados.length, "ficou", "ficaram")} de fora. O card mostra o andamento.`
            : `${pluralize(data.material.arquivos, "arquivo copiado", "arquivos copiados")}. O card mostra o andamento.`,
      });
      onRequested(project);
    } catch (err) {
      toast.error("O pedido não entrou na fila", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const motivoDoBloqueio = !can("gerar")
    ? semPermissaoDeGerar
    : !material.generation.enabled
      ? "A geração pelo Claude está desligada neste painel."
      : null;

  return (
    <>
      {/* Antes de tudo, o que impede: a pessoa não preenche a tela inteira
          para descobrir no fim que o botão não vai funcionar. */}
      {!material.generation.enabled && (
        <div className="shrink-0 border-b px-6 py-3">
          <Alert variant="warning">
            <Lock />
            <AlertTitle>A geração pelo Claude está desligada neste painel</AlertTitle>
            <AlertDescription>
              {material.generation.reason} Dá para conferir o pedido mesmo assim.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:grid-cols-[1.05fr_1fr] lg:grid-rows-1 lg:divide-x lg:overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-col gap-2 p-6 lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="claude-informacoes" className="text-sm font-medium">
              Informações do site
            </Label>
            <span className="truncate text-xs text-muted-foreground">
              {material.prompt.file?.name ??
                (fromPanel ? "Escreva ou cole aqui" : "Sem “Informações do Site” no Drive")}
            </span>
          </div>
          <Textarea
            id="claude-informacoes"
            value={texto}
            onChange={(event) => {
              setTexto(event.target.value);
              changed();
            }}
            placeholder="O que o cliente informou: empresa, serviços, contato, endereço, horário. O Claude lê este texto junto com os arquivos marcados."
            className="max-h-[45vh] min-h-56 flex-1 resize-none overflow-y-auto text-sm leading-relaxed lg:max-h-none lg:min-h-40"
          />
          <p className="text-xs text-muted-foreground">
            Vai para a pasta de trabalho como <code>informacoes-do-site.txt</code>. O arquivo do projeto
            não é alterado.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="claude-observacoes" className="text-sm font-medium">
              Observações para o Claude
            </Label>
            <Textarea
              id="claude-observacoes"
              rows={3}
              value={observacoes}
              onChange={(event) => {
                setObservacoes(event.target.value);
                changed();
              }}
              placeholder="O que priorizar ou deixar de fora. Para aproveitar o site atual do cliente, cite o endereço: “use o conteúdo de cliente.com.br”."
              className="max-h-40 resize-none overflow-y-auto text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Entram no pedido. O Claude só lê páginas da web dos endereços citados aqui; sem endereço, ele
              não acessa a rede.
            </p>
          </div>
        </section>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="px-6 pt-4">
            <Segmented
              label="Origem do material"
              value={tab}
              onChange={setTab}
              options={[
                { value: "files", label: fromPanel ? "Do projeto" : "Do Drive", icon: <FolderOpen />, count: selected.size },
                { value: "stock", label: "Banco de imagens", icon: <ImageIcon />, count: stock.size },
              ]}
            />
          </div>

          <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-6 pt-3 lg:overflow-y-auto", tab !== "files" && "hidden")}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                Arquivos para o Claude ler
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {selected.size} de {selecionaveis.length}
                </span>
              </h3>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    changed();
                    setSelected(new Set(selecionaveis.map((file) => file.id)));
                  }}
                >
                  Todos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    changed();
                    setSelected(new Set());
                  }}
                >
                  Nenhum
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar arquivo ou subpasta..."
                aria-label="Buscar arquivo ou subpasta"
                className="pl-8"
              />
            </div>
            <div className="min-h-40 flex-1 space-y-1 overflow-y-auto rounded-lg border p-1">
              {visible.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {material.files.length === 0 ? "Este projeto ainda não tem arquivos." : "Nenhum arquivo encontrado."}
                </p>
              ) : (
                visible.map((file) => (
                  <AttachmentRow
                    key={file.id}
                    file={file}
                    checked={selected.has(file.id)}
                    onToggle={() => toggle(file)}
                    briefLabel="já vai como texto"
                  />
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Os marcados são copiados para a pasta de trabalho do motor; um .zip é aberto na cópia. Vídeo e
              áudio ficam de fora: o Claude não os lê.
            </p>
          </section>

          <StockImagesSection
            className={cn("flex-1 pt-3", tab !== "stock" && "hidden")}
            search={stockSearch}
            picks={stock}
            results={stockResults}
            stockBlock=""
            onToggle={(candidate, group) => {
              changed();
              setStock((current) => toggleStockPick(current, candidate, group));
            }}
          />
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-t px-6 py-3">
        {conferido && <PlanBox plan={conferido.plan} command={conferido.command} />}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className={cn("text-xs tabular-nums text-muted-foreground", excedido.length > 0 && "text-destructive")}>
            {pluralize(marcados.length, "arquivo")}
            {bytes > 0 && ` · ${formatBytes(bytes)}`}
            {texto.trim() && ` · ${pluralize(texto.trim().length, "caractere")} de informações`}
            {stockImages.length > 0 && ` · ${pluralize(stockImages.length, "foto")} de banco`}
            {excedido.length > 0 && ` · ${excedido.join(" · ")}`}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!podeConferir || !can("gerar")}
              onClick={() => void conferir()}
              title="Confere o pedido e mostra o comando que rodaria. Não copia nada nem usa o Claude."
            >
              {busy === "preview" ? <Loader2 className="animate-spin" /> : <FileSearch />}
              Conferir pedido
            </Button>
            <HintWhenDisabled reason={motivoDoBloqueio}>
              <Button size="sm" disabled={!podeConferir || Boolean(motivoDoBloqueio)} onClick={() => setConfirming(true)}>
                {busy === "request" ? <Loader2 className="animate-spin" /> : <Bot />}
                Gerar briefing
              </Button>
            </HintWhenDisabled>
          </div>
        </div>
      </div>

      <ConfirmClaudeDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Pedir o briefing ao Claude?"
        confirmLabel="Gerar briefing e usar a assinatura"
        onConfirm={() => void pedir()}
      >
        O painel copia {pluralize(marcados.length, "arquivo")}
        {stockImages.length > 0 && ` e ${pluralize(stockImages.length, "foto")} de banco`} para a pasta de
        trabalho e põe o pedido na fila. O site só é gerado depois que alguém revisar o briefing.
      </ConfirmClaudeDialog>
    </>
  );
}

/** O resultado do ensaio: o que seria copiado, a frase do pedido e o comando exato. */
function PlanBox({ plan, command }: { plan: ClaudeBriefingPlan; command: string }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
      <p className="font-medium">Conferido — nada foi copiado nem disparado</p>
      <p className="text-muted-foreground">
        {pluralize(plan.files.length, "arquivo")}
        {plan.totalBytes > 0 && ` (${formatBytes(plan.totalBytes)})`}
        {plan.unknownSizes > 0 && `, ${plan.unknownSizes} com tamanho conhecido só na exportação`}
        {plan.infoChars > 0 && `, ${pluralize(plan.infoChars, "caractere")} de informações`}
        {plan.stockImages.length > 0 && `, ${pluralize(plan.stockImages.length, "foto")} de banco conferidas no Pixabay`}
        .{" "}
        {plan.sites.length > 0
          ? `O Claude poderá ler páginas de ${plan.sites.join(", ")} — e de nenhum outro endereço.`
          : "O Claude não terá acesso à rede."}
      </p>
      <p className="text-muted-foreground">
        Pedido que será digitado ao Claude: <span className="text-foreground">“{plan.phrase.split("\n")[0]}”</span>
      </p>
      <details className="text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">Comando que será executado</summary>
        <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-2xs leading-relaxed break-all whitespace-pre-wrap">
          {command}
        </pre>
      </details>
    </div>
  );
}
