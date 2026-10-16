import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSearch, FolderOpen, ImageIcon, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import type {
  BuildFile,
  ClaudeBriefingPlan,
  ClaudeMaterial,
  ClaudeOptions,
  ClaudeRunChoices,
  Project,
  StockSearchResult,
} from "@/lib/api";
import { fetchClaudeMaterial, isPanelProject, previewClaudeBriefing, requestClaudeBriefing } from "@/lib/api";
import { formatBytes, plural, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { ErrorNotice } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AttachmentRow } from "@/features/material/attachment-row";
import { filterFiles } from "@/features/generate/generation-prompt";
import { StockImagesSection } from "@/features/material/stock-images-section";
import { nextStockSelection, toggleStockPick, type StockPick } from "@/features/material/stock-images";
import { useStockSearch } from "@/features/material/use-stock-search";
import { requestNotificationPermission } from "@/lib/notifications";
import { RunChoicesFields } from "./claude-option-fields";
import { choicesLine, choicesSentence } from "./claude-options";
import { TechnicalCode, TechnicalDetails } from "@/components/technical-details";
import { ConfirmClaudeDialog, GenerationOffNotice } from "./claude-shared";
import { claudeBlock, errorMessage } from "./claude-text";
import { useClaudeOptions, useClaudeRefresh } from "./use-claude";
import { ClaudeIcon, GoogleDriveIcon } from "@/components/brand-icons";

/**
 * O primeiro passo da geração pelo Claude: o material do projeto que ele vai
 * ler para escrever o briefing.
 *
 * O Claude não recebe um prompt: lê os arquivos marcados, o texto das
 * informações do site e as observações do pedido, e devolve um briefing
 * estruturado — que alguém revisa antes de o site ser gerado. "Conferir
 * pedido" é um ensaio: mostra o que seria copiado e o comando que rodaria, sem
 * gastar nada.
 *
 * O modelo e o esforço escolhidos aqui são os do projeto: valem para o
 * briefing e para as execuções seguintes, e voltam a aparecer na revisão.
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
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorNotice
          title="Não foi possível ler o material do projeto"
          error={material.error}
          onRetry={() => void material.refetch()}
        />
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
  const opcoes = useClaudeOptions(project.id);
  /** `null`: ninguém mexeu — vale o modelo e o esforço que o projeto tem gravados. */
  const [escolhas, setEscolhas] = useState<ClaudeRunChoices | null>(null);
  const [conferido, setConferido] = useState<{
    plan: ClaudeBriefingPlan;
    command: string;
    escolhas: ClaudeRunChoices | null;
  } | null>(null);
  const [busy, setBusy] = useState<"preview" | "request" | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** O modelo e o esforço que valem agora; `null` enquanto as opções do projeto não chegam. */
  const atuais = escolhas ?? opcoes.data?.options ?? null;

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

  // O que impede, escrito ao lado dos botões, na ordem em que a pessoa
  // resolve: o ensaio para nos três primeiros; gerar, também na trava.
  const motivoDoPedido = !can("gerar")
    ? claudeBlock.semPermissao
    : vazio
      ? "Marque arquivos, escreva as informações do site ou cite o site do cliente nas observações."
      : excedido.length > 0
        ? `O pedido passou do limite: ${excedido.join(", ")}.`
        : null;
  const motivoDoBloqueio = motivoDoPedido ?? (!material.generation.enabled ? claudeBlock.desligada : null);

  // O modelo e o esforço só vão quando alguém mexeu neles: sem a chave, o
  // servidor usa o que o projeto tem gravado.
  const corpo = () => ({
    fileIds: [...selected],
    texto,
    observacoes,
    stockImages,
    ...escolhas,
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
      setConferido({ plan: data.plan, command: data.command, escolhas: atuais });
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

  return (
    <>
      {/* Antes de tudo, o que impede: a pessoa não preenche a tela inteira
          para descobrir no fim que o botão não vai funcionar. */}
      {!material.generation.enabled && (
        <div className="shrink-0 border-b px-6 py-3">
          <GenerationOffNotice reason={material.generation.reason}>Dá para conferir o pedido mesmo assim.</GenerationOffNotice>
        </div>
      )}

      <div className="grid min-h-0 flex-1 auto-rows-max overflow-y-auto lg:grid-cols-2 lg:grid-rows-1 lg:divide-x lg:overflow-hidden">
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
            className="max-h-96 min-h-56 flex-1 resize-none overflow-y-auto text-sm leading-relaxed lg:max-h-none lg:min-h-40"
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Modelo e esforço deste projeto</legend>
            <RunChoicesFields
              idPrefix="claude-pedido"
              query={opcoes}
              value={atuais}
              disabled={!can("gerar")}
              onChange={(next) => {
                setEscolhas(next);
                changed();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Valem para o briefing e para as execuções seguintes do projeto; dá para trocar na revisão, antes
              de gerar o site. A escolha é gravada quando o pedido entra na fila.
            </p>
          </fieldset>
        </section>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="px-6 pt-4">
            <Segmented
              label="Origem do material"
              value={tab}
              onChange={setTab}
              options={[
                { value: "files", label: fromPanel ? "Do projeto" : "Do Drive", icon: fromPanel ? <FolderOpen /> : <GoogleDriveIcon />, count: selected.size },
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
                  {material.files.length === 0
                    ? "Este projeto ainda não tem arquivos."
                    : `Nenhum arquivo com “${query.trim()}” no nome ou na subpasta.`}
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
            engine="claude"
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

      <div className="shrink-0 space-y-3 border-t bg-muted/40 px-6 py-3">
        {conferido && (
          <PlanBox
            plan={conferido.plan}
            command={conferido.command}
            choices={conferido.escolhas}
            defaults={opcoes.data?.defaults ?? null}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs tabular-nums text-muted-foreground">
              {pluralize(marcados.length, "arquivo")}
              {bytes > 0 && ` · ${formatBytes(bytes)}`}
              {texto.trim() && ` · ${pluralize(texto.trim().length, "caractere")} de informações`}
              {stockImages.length > 0 && ` · ${pluralize(stockImages.length, "foto")} de banco`}
            </p>
            {motivoDoBloqueio && <Reason>{motivoDoBloqueio}</Reason>}
          </div>

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
            <DisabledHint reason={motivoDoBloqueio}>
              <Button size="sm" disabled={!podeConferir || Boolean(motivoDoBloqueio)} onClick={() => setConfirming(true)}>
                {busy === "request" ? <Loader2 className="animate-spin" /> : <ClaudeIcon mono />}
                Gerar briefing
              </Button>
            </DisabledHint>
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
        trabalho e põe o pedido na fila
        {atuais && opcoes.data && `, com ${choicesSentence(atuais, opcoes.data.defaults)}`}. O site só é gerado
        depois que alguém revisar o briefing.
      </ConfirmClaudeDialog>
    </>
  );
}

/**
 * O resultado do ensaio: o que seria copiado e com que modelo o briefing sai.
 * A frase digitada ao Claude, o id do modelo e o comando ficam em "Detalhes
 * técnicos".
 */
function PlanBox({
  plan,
  command,
  choices,
  defaults,
}: {
  plan: ClaudeBriefingPlan;
  command: string;
  /** O modelo e o esforço conferidos; `null` sem as opções do projeto em mãos. */
  choices: ClaudeRunChoices | null;
  defaults: ClaudeOptions["defaults"] | null;
}) {
  const fotos = plan.stockImages.length;
  return (
    <div role="status" className="space-y-1.5 rounded-lg border border-dashed bg-background p-3 text-xs">
      <p className="font-medium">Conferido — nada foi copiado nem disparado</p>
      <p className="text-muted-foreground">
        {pluralize(plan.files.length, "arquivo")}
        {plan.totalBytes > 0 && ` (${formatBytes(plan.totalBytes)})`}
        {plan.unknownSizes > 0 &&
          `, ${plan.unknownSizes} com tamanho conhecido só na exportação`}
        {plan.infoChars > 0 && `, ${pluralize(plan.infoChars, "caractere")} de informações`}
        {/* As fotos do pedido de briefing são as da busca do painel, e o
            servidor as confere no Pixabay — o banco que essa busca usa. */}
        {fotos > 0 && `, ${pluralize(fotos, "foto")} de banco ${plural(fotos, "conferida", "conferidas")} no Pixabay`}
        .{" "}
        {plan.sites.length > 0
          ? `O Claude poderá ler páginas de ${plan.sites.join(", ")} — e de nenhum outro endereço.`
          : "O Claude não terá acesso à rede."}
      </p>
      {choices && defaults && (
        <p className="text-muted-foreground">O briefing sai com {choicesSentence(choices, defaults)}.</p>
      )}
      <TechnicalDetails>
        <p>
          Pedido que será digitado ao Claude:{" "}
          <span className="whitespace-pre-wrap text-foreground">“{plan.phrase}”</span>
        </p>
        {choices && defaults && <p>{choicesLine(choices, defaults)}</p>}
        <p>Comando que será executado:</p>
        <TechnicalCode>{command}</TechnicalCode>
      </TechnicalDetails>
    </div>
  );
}
