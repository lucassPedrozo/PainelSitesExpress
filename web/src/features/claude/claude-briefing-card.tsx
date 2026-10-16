import { useState } from "react";
import { ChevronRight, CircleAlert, FileSearch, ImageOff, Loader2, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type {
  ClaudeBriefing,
  ClaudeOptions,
  ClaudeProjectDetail,
  ClaudeRunChoices,
  ClaudeSiteDefaults,
  ClaudeSitePlan,
  Project,
} from "@/lib/api";
import {
  claudeImageUrl,
  generateClaudeSite,
  previewClaudeSite,
  saveClaudeBriefing,
  saveClaudeOptions,
} from "@/lib/api";
import { plural, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { When } from "@/components/when";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { requestNotificationPermission } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { BriefingEditor } from "./briefing-editor";
import { sameBriefing } from "./briefing-fields";
import { OptionLabel, OptionSelect, RunChoicesFields } from "./claude-option-fields";
import {
  ART_DIRECTIONS,
  MAX_LINKS,
  MAX_NOTAS,
  MOTIONS,
  REFERENCES_HELP,
  REFERENCES_HINT,
  RODADAS,
  ROUNDS_HELP,
  ROUNDS_HINT,
  ROUTE_CHOICES,
  advancedOptionsChanged,
  choicesLine,
  choicesSentence,
  levelHelp,
  levelLabel,
  roundsLabel,
  routeChoiceHelp,
  routeChoiceValue,
  sameChoices,
  sameSiteOptions,
  siteOptionsDraft,
  siteOptionsPayload,
  siteOptionsProblem,
  type SiteOptionsDraft,
} from "./claude-options";
import { ConfirmClaudeDialog, TechnicalCode, TechnicalDetails } from "./claude-shared";
import { claudeBlock, errorMessage } from "./claude-text";
import { useClaudeOptions, useClaudeRefresh } from "./use-claude";
import { ClaudeIcon } from "@/components/brand-icons";

/** O ensaio de "Conferir": o plano que o motor devolveu e o comando que rodaria. */
type Conferido = {
  plan: ClaudeSitePlan;
  command: string;
  escolhas: ClaudeRunChoices | null;
  /** Havia mudança no briefing ainda não gravada: o ensaio leu o gravado. */
  comMudancas: boolean;
};

/**
 * A revisão antes de gerar o site: o que a conferência do motor diz do
 * briefing, o próprio briefing para corrigir, as fotos que ele cita e as
 * opções do site. O botão que gasta fica no rodapé do cartão, à vista durante
 * a revisão inteira — antes ficava no fim de várias telas de rolagem.
 *
 * Montado com `key` do conteúdo gravado: o rascunho nasce do que está no
 * motor, e volta a nascer quando outra pessoa (ou o Claude) o regrava.
 */
export function ClaudeBriefingCard({
  project,
  detail,
  busy,
}: {
  project: Project;
  detail: ClaudeProjectDetail;
  /** Há um pedido deste projeto na fila: o briefing não se mexe no meio dele. */
  busy: boolean;
}) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const review = detail.review!;
  const gravado = review.briefing;

  const [rascunho, setRascunho] = useState<ClaudeBriefing>(() => gravado ?? {});
  const [jsonInvalido, setJsonInvalido] = useState<string | null>(null);
  const [opcoes, setOpcoes] = useState<SiteOptionsDraft>(() => siteOptionsDraft(review.opcoes));
  const opcoesDoProjeto = useClaudeOptions(project.id);
  /** `null`: ninguém mexeu — vale o modelo e o esforço que o projeto tem gravados. */
  const [escolhas, setEscolhas] = useState<ClaudeRunChoices | null>(null);
  const [working, setWorking] = useState<"save" | "options" | "preview" | "generate" | null>(null);
  const [conferido, setConferido] = useState<Conferido | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** "Opções avançadas" nasce aberto quando o site já tem alguma fora do padrão. */
  const [avancadas, setAvancadas] = useState(() => advancedOptionsChanged(siteOptionsDraft(review.opcoes)) > 0);

  const mudou = !sameBriefing(rascunho, gravado);
  const jaTemSite = review.projetos.length > 0;
  const semPermissao = !can("gerar");
  const travado = busy || semPermissao;

  /** O modelo e o esforço que valem agora; `null` enquanto as opções do projeto não chegam. */
  const escolhasGravadas = opcoesDoProjeto.data?.options ?? null;
  const atuais = escolhas ?? escolhasGravadas;
  // O que vale para o que o site não escolheu. Os do briefing servem enquanto
  // os do projeto não chegam: são os mesmos.
  const padroes: ClaudeSiteDefaults = opcoesDoProjeto.data?.defaults ?? review.padroes;
  const rodadas = opcoes.rodadas ?? padroes.rodadas;
  const escolherRota = opcoes.escolher_rota ?? padroes.escolher_rota;

  const opcoesMudaram =
    !sameSiteOptions(opcoes, siteOptionsDraft(review.opcoes)) ||
    Boolean(escolhas && escolhasGravadas && !sameChoices(escolhas, escolhasGravadas));
  const problemaDasOpcoes = siteOptionsProblem(opcoes);
  const foraDoPadrao = advancedOptionsChanged(opcoes);
  // Com erro nas opções avançadas, o bloco abre sozinho: o erro não fica escondido.
  const avancadasAbertas = avancadas || Boolean(problemaDasOpcoes);

  // Qualquer mudança no briefing ou nas opções anula o ensaio: ele era de outro conteúdo.
  const mudarRascunho = (briefing: ClaudeBriefing) => {
    setRascunho(briefing);
    setConferido(null);
  };
  const mudarOpcoes = (patch: Partial<SiteOptionsDraft>) => {
    setOpcoes((atual) => ({ ...atual, ...patch }));
    setConferido(null);
  };
  const toggleSkill = (skill: string, marcada: boolean) => {
    setOpcoes((atual) => ({
      ...atual,
      skills: marcada ? [...atual.skills, skill] : atual.skills.filter((item) => item !== skill),
    }));
    setConferido(null);
  };

  /**
   * O que segue com o pedido de gerar — e com o ensaio, para ele conferir o
   * mesmo pedido. O modelo e o esforço só vão quando alguém mexeu neles: sem
   * a chave, o servidor usa o que o projeto tem gravado.
   */
  const pedidoDoSite = () => ({ refazer: jaTemSite, opcoes: siteOptionsPayload(opcoes), ...escolhas });

  const salvar = async () => {
    setWorking("save");
    try {
      const { review: novo } = await saveClaudeBriefing(project.id, rascunho);
      await refresh();
      if (novo.erros.length > 0) {
        toast.warning("Briefing gravado, com pendências", {
          description: `A conferência apontou ${pluralize(novo.erros.length, "pendência")}.`,
        });
      } else {
        toast.success("Briefing gravado e aceito pela conferência");
      }
    } catch (err) {
      toast.error("Não foi possível gravar o briefing", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  /** Guarda as opções sem gerar nada: é por aqui que se troca o modelo de um site já gerado. */
  const gravarOpcoes = async () => {
    setWorking("options");
    try {
      await saveClaudeOptions(project.id, { ...escolhas, site: siteOptionsPayload(opcoes) });
      await refresh();
      setEscolhas(null);
      toast.success("Opções gravadas", { description: "Nada foi disparado." });
    } catch (err) {
      toast.error("Não foi possível gravar as opções", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const conferir = async () => {
    setWorking("preview");
    try {
      const data = await previewClaudeSite(project.id, pedidoDoSite());
      setConferido({ plan: data.plan, command: data.command, escolhas: atuais, comMudancas: mudou });
    } catch (err) {
      setConferido(null);
      toast.error("A conferência apontou um problema", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const gerar = async () => {
    requestNotificationPermission();
    setWorking("generate");
    try {
      await generateClaudeSite(project.id, pedidoDoSite());
      await refresh();
      toast.success("Geração na fila do Claude", { description: "O card mostra o andamento." });
    } catch (err) {
      toast.error("A geração não entrou na fila", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  /**
   * O primeiro briefing ainda depende de um pedido deste projeto — rodando,
   * esperando a vez ou interrompido por um reinício: não há o que editar.
   */
  const pedido = !review.existe ? (detail.project?.queue?.estado ?? null) : null;
  const escrevendo = !review.existe && busy;

  // O que impede de gerar, na ordem em que a pessoa resolve. Fica escrito no
  // rodapé, ao lado dos botões — vale também para "Conferir" e para gravar.
  const motivo = semPermissao
    ? claudeBlock.semPermissao
    : busy
      ? claudeBlock.naFila
      : !review.existe
        ? "Ainda não há briefing para gerar o site."
        : jsonInvalido
          ? "Corrija o JSON do briefing."
          : mudou
            ? "Grave o briefing antes de gerar."
            : review.erros.length > 0
              ? "A conferência ainda aponta pendências no briefing."
              : (problemaDasOpcoes ?? (!detail.generation.enabled ? claudeBlock.desligada : null));

  return (
    <section aria-labelledby="claude-briefing" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="claude-briefing" className="text-sm font-medium">
          Briefing
        </h3>
        {!review.existe ? (
          pedido === "rodando" ? (
            <Badge variant="info">Sendo escrito</Badge>
          ) : pedido === "esperando" ? (
            <Badge variant="info">Na fila</Badge>
          ) : (
            <Badge variant="outline">Ainda não escrito</Badge>
          )
        ) : review.erros.length > 0 ? (
          <Badge variant="warning">{pluralize(review.erros.length, "pendência")}</Badge>
        ) : (
          <Badge variant="success">Aceito pela conferência</Badge>
        )}
        {detail.project?.material && (
          <span className="text-xs text-muted-foreground">
            <When at={detail.project.material.copiedAt} prefix="material copiado" /> ·{" "}
            {pluralize(detail.project.material.files, "arquivo")}
          </span>
        )}
      </div>

      {/* Sem briefing não há o que a conferência recusar: o que o motor diz
          nesse caso é só que ainda não achou o arquivo. */}
      {!review.existe && (
        <p className="max-w-prose text-sm text-muted-foreground">
          {pedido === "rodando"
            ? "O Claude está lendo o material e escrevendo o briefing. Ele aparece aqui quando a execução terminar."
            : pedido === "esperando"
              ? "O pedido do briefing espera a vez na fila do Claude. O briefing aparece aqui quando a execução terminar."
              : pedido === "interrompida"
                ? "A execução que escreveria o briefing foi interrompida. Retome-a ou descarte-a, logo acima."
                : "Peça o briefing ao Claude, no botão abaixo, ou preencha os campos e grave: a conferência diz o que falta."}
        </p>
      )}

      {review.existe && review.erros.length > 0 && (
        <Alert variant="warning">
          <CircleAlert />
          <AlertTitle>A conferência recusou o briefing</AlertTitle>
          <AlertDescription>
            <ol className="list-decimal space-y-0.5 pl-4">
              {review.erros.map((erro) => (
                <li key={erro}>{erro}</li>
              ))}
            </ol>
          </AlertDescription>
        </Alert>
      )}

      {review.existe && review.erros.length === 0 && (review.resumo.length > 0 || review.avisos.length > 0) && (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
          {review.resumo.map((linha) => (
            <p key={linha}>{linha}</p>
          ))}
          {review.avisos.length > 0 && <WarningsList avisos={review.avisos} />}
        </div>
      )}

      {/* Com espaço, os campos à esquerda e, ao lado, o que acompanha o briefing:
          as fotos citadas e as opções do site. */}
      <div className={cn("grid items-start gap-x-8 gap-y-4", review.existe && "@4xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]")}>
        <div className="min-w-0 space-y-4">
          {!escrevendo && (
            <>
              <BriefingEditor
                briefing={rascunho}
                onChange={mudarRascunho}
                onInvalidChange={setJsonInvalido}
                disabled={travado}
              />

              <div className="flex flex-wrap items-center gap-2">
                <DisabledHint reason={semPermissao ? claudeBlock.semPermissao : busy ? claudeBlock.naFila : null}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!mudou || Boolean(jsonInvalido) || travado || working !== null}
                    onClick={() => void salvar()}
                  >
                    {working === "save" ? <Loader2 className="animate-spin" /> : <Save />}
                    Gravar briefing
                  </Button>
                </DisabledHint>
                {mudou && !jsonInvalido && (
                  <>
                    <Button variant="ghost" size="sm" disabled={working !== null} onClick={() => mudarRascunho(gravado ?? {})}>
                      Descartar mudanças
                    </Button>
                    <span className="text-xs text-muted-foreground">Mudanças ainda não gravadas.</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {(review.fotos.length > 0 || review.existe) && (
          <div className="min-w-0 space-y-4">
            {review.fotos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground">
                  Fotos do cliente citadas no briefing · {review.fotos.length}
                </h4>
                <ul className="grid grid-files gap-2">
                  {review.fotos.map((foto) => (
                    <li key={foto.arquivo} className="overflow-hidden rounded-lg border bg-card">
                      <div className="grid aspect-4/3 place-items-center bg-muted/40">
                        {foto.existe ? (
                          <img
                            src={claudeImageUrl(project.id, "material", foto.caminho)}
                            alt={foto.descricao}
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <ImageOff className="size-5 text-muted-foreground" aria-hidden />
                        )}
                      </div>
                      <p className="line-clamp-2 px-2 py-1.5 text-2xs text-muted-foreground" title={foto.descricao}>
                        {foto.existe ? foto.descricao : `Arquivo não encontrado: ${foto.arquivo}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
          )}

            {review.existe && (
              <fieldset className="@container space-y-4 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Opções do site</legend>

                {/* Quem escreve e quanto pensa: o que mais pesa no resultado e no
                    consumo — por isso à vista; o resto fica em "Opções avançadas". */}
                <RunChoicesFields
                  className="sm:grid-cols-1 @lg:grid-cols-2"
                  idPrefix="claude-opcoes"
                  query={opcoesDoProjeto}
                  value={atuais}
                  disabled={travado}
                  onChange={(next) => {
                    setEscolhas(next);
                    // O comando conferido era de outro modelo ou de outro esforço.
                    setConferido(null);
                  }}
                />

                <Collapsible open={avancadasAbertas} onOpenChange={setAvancadas}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm">
                      <ChevronRight className={cn("transition-transform", avancadasAbertas && "rotate-90")} />
                      Opções avançadas
                      {foraDoPadrao > 0 && (
                        <span className="font-normal text-muted-foreground">
                          · {pluralize(foraDoPadrao, "fora do padrão", "fora do padrão")}
                        </span>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  {/* Montado mesmo fechado: o que a pessoa escreveu continua lá. */}
                  <CollapsibleContent forceMount className="space-y-4 pt-3 data-[state=closed]:hidden">
                    <AdvancedOptions
                      opcoes={opcoes}
                      padroes={padroes}
                      escolherRota={escolherRota}
                      bancos={review.bancos}
                      skillsDisponiveis={review.skillsDisponiveis}
                      maxSkills={review.maxSkills}
                      problema={problemaDasOpcoes}
                      disabled={travado}
                      onChange={mudarOpcoes}
                      onToggleSkill={toggleSkill}
                    />
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!opcoesMudaram || mudou || Boolean(problemaDasOpcoes) || travado || working !== null}
                    onClick={() => void gravarOpcoes()}
                    title="Guarda as opções no projeto. Não usa o Claude."
                  >
                    {working === "options" ? <Loader2 className="animate-spin" /> : <Save />}
                    Gravar opções
                  </Button>
                  {opcoesMudaram &&
                    (mudou ? (
                      <Reason>Grave o briefing antes de gravar as opções.</Reason>
                    ) : (
                      <span className="text-xs text-muted-foreground">Opções ainda não gravadas.</span>
                    ))}
                </div>
                <p className="max-w-prose text-xs text-muted-foreground">
                  As opções seguem com o pedido de gerar; “Gravar opções” as guarda antes, sem usar o Claude. O modelo
                  e o esforço valem para as próximas execuções do projeto, ajustes incluídos; as outras, para o próximo
                  site gerado.
                </p>
              </fieldset>
            )}
          </div>
        )}
      </div>

      {jaTemSite && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Este briefing já gerou {pluralize(review.projetos.length, "site")}</AlertTitle>
          <AlertDescription>
            Para mudar o site que existe, peça um ajuste nele. Gerar de novo cria outro site, do zero.
          </AlertDescription>
        </Alert>
      )}

      {conferido && <PreviewResult conferido={conferido} defaults={opcoesDoProjeto.data?.defaults ?? null} />}

      {/* O rodapé das ações fica preso ao fim da área que rola enquanto o
          briefing está na tela: o motivo, o ensaio e o botão que gasta. Com o
          site já gerado, a ação principal é a do site, e gerar outro do zero
          vira secundária. */}
      {review.existe && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-popover px-3 py-2 shadow-md">
          {motivo && <Reason className="mr-auto">{motivo}</Reason>}
          <Button
            variant="outline"
            size="sm"
            disabled={semPermissao || working !== null}
            onClick={() => void conferir()}
            title="Mostra o que a conferência diz e o comando que rodaria. Não usa o Claude."
          >
            {working === "preview" ? <Loader2 className="animate-spin" /> : <FileSearch />}
            Conferir
          </Button>
          <DisabledHint reason={motivo}>
            <Button
              variant={jaTemSite ? "outline" : "default"}
              size="sm"
              disabled={Boolean(motivo) || working !== null}
              onClick={() => setConfirming(true)}
            >
              {working === "generate" ? <Loader2 className="animate-spin" /> : <ClaudeIcon mono />}
              {jaTemSite ? "Gerar outro site do zero" : "Gerar site"}
            </Button>
          </DisabledHint>
        </div>
      )}

      <ConfirmClaudeDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={jaTemSite ? "Gerar outro site, do zero?" : "Gerar o site com o Claude?"}
        confirmLabel="Gerar e usar a assinatura"
        onConfirm={() => void gerar()}
      >
        {jaTemSite
          ? "O site que já existe continua como está, e um novo é criado a partir deste briefing."
          : "O Claude define a direção criativa, escreve o site e revisa o resultado."}{" "}
        Depois o site passa por até {roundsLabel(rodadas)} de crítica e refino, cada passo numa execução que o
        painel põe na fila sozinho: esta confirmação vale para a sequência inteira
        {atuais && opcoesDoProjeto.data && `, com ${choicesSentence(atuais, opcoesDoProjeto.data.defaults)}`}.{" "}
        {escolherRota
          ? "Antes de o site ser escrito, a criação para na direção criativa e espera você aprovar a rota ou escolher outra."
          : "O painel acompanha e avisa quando o site for entregue."}
      </ConfirmClaudeDialog>
    </section>
  );
}

/** Os avisos da conferência: o site sai, mas mais simples. Recolhidos, com a contagem à vista. */
function WarningsList({ avisos }: { avisos: string[] }) {
  return (
    <details className="text-muted-foreground">
      <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        {pluralize(avisos.length, "aviso")}: o site sai, mas mais simples
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {avisos.map((aviso) => (
          <li key={aviso}>{aviso}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * O que só alguns sites mudam: as rodadas, a rota, a direção de arte, o
 * movimento, as páginas, o banco de imagens, as skills, as referências e as
 * observações. Cada um com uma frase curta; a explicação longa, no "?".
 */
function AdvancedOptions({
  opcoes,
  padroes,
  escolherRota,
  bancos,
  skillsDisponiveis,
  maxSkills,
  problema,
  disabled,
  onChange,
  onToggleSkill,
}: {
  opcoes: SiteOptionsDraft;
  padroes: ClaudeSiteDefaults;
  /** A escolha que vale: a do site ou, sem ela, o padrão. */
  escolherRota: boolean;
  bancos: string[];
  skillsDisponiveis: string[];
  maxSkills: number;
  problema: string | null;
  disabled: boolean;
  onChange: (patch: Partial<SiteOptionsDraft>) => void;
  onToggleSkill: (skill: string, marcada: boolean) => void;
}) {
  const notas = opcoes.notas.trim().length;
  return (
    <>
      <div className="grid gap-x-4 gap-y-3 @lg:grid-cols-2">
        <OptionSelect
          id="claude-opcoes-rodadas"
          label="Rodadas de crítica e refino"
          value={opcoes.rodadas === null ? null : String(opcoes.rodadas)}
          onChange={(valor) => onChange({ rodadas: valor === null ? null : Number(valor) })}
          defaultText={roundsLabel(padroes.rodadas)}
          options={RODADAS.map((numero) => ({ value: String(numero), label: roundsLabel(numero) }))}
          help={ROUNDS_HINT}
          moreHelp={ROUNDS_HELP}
          disabled={disabled}
        />
        <OptionSelect
          id="claude-opcoes-rota"
          label="Escolher a rota antes de gerar"
          value={routeChoiceValue(opcoes.escolher_rota)}
          onChange={(valor) => onChange({ escolher_rota: valor === null ? null : valor === "sim" })}
          defaultText={padroes.escolher_rota ? "sim" : "não"}
          options={ROUTE_CHOICES}
          help={routeChoiceHelp(escolherRota)}
          disabled={disabled}
        />
        <OptionSelect
          id="claude-opcoes-direcao"
          label="Direção de arte"
          value={opcoes.direcao_de_arte}
          onChange={(valor) => onChange({ direcao_de_arte: valor })}
          defaultText={levelLabel(ART_DIRECTIONS, padroes.direcao_de_arte)}
          options={ART_DIRECTIONS}
          help={levelHelp(ART_DIRECTIONS, opcoes.direcao_de_arte, padroes.direcao_de_arte)}
          disabled={disabled}
        />
        <OptionSelect
          id="claude-opcoes-movimento"
          label="Movimento"
          value={opcoes.movimento}
          onChange={(valor) => onChange({ movimento: valor })}
          defaultText={levelLabel(MOTIONS, padroes.movimento)}
          options={MOTIONS}
          help={levelHelp(MOTIONS, opcoes.movimento, padroes.movimento)}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-x-4 gap-y-3 @lg:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={opcoes.multiplas_paginas}
            disabled={disabled}
            onCheckedChange={(valor) => onChange({ multiplas_paginas: valor })}
          />
          Várias páginas
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={opcoes.banco_de_imagens}
              disabled={disabled}
              onCheckedChange={(valor) => onChange({ banco_de_imagens: valor })}
            />
            Completar com fotos de banco
          </label>
          <p className="text-xs text-muted-foreground">
            {bancos.length > 0
              ? `Bancos configurados: ${bancos.join(", ")}.`
              : "Nenhum banco de imagens configurado: o site sai só com as fotos do cliente."}
          </p>
        </div>
      </div>

      {skillsDisponiveis.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Skills · até {maxSkills} por site</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {skillsDisponiveis.map((skill) => {
              const marcada = opcoes.skills.includes(skill);
              return (
                <label key={skill} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={marcada}
                    disabled={disabled || (!marcada && opcoes.skills.length >= maxSkills)}
                    onCheckedChange={(valor) => onToggleSkill(skill, valor === true)}
                  />
                  {skill}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-x-4 gap-y-3 @lg:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <OptionLabel
            id="claude-opcoes-referencias"
            label={`Referências · um endereço por linha, até ${MAX_LINKS}`}
            help={REFERENCES_HELP}
          />
          <Textarea
            id="claude-opcoes-referencias"
            rows={3}
            value={opcoes.links}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={siteOptionsPayload(opcoes).referencias.links.length > MAX_LINKS}
            onChange={(event) => onChange({ links: event.target.value })}
            placeholder="https://site-que-o-cliente-admira.com.br"
            className="max-h-40 resize-y text-sm leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">{REFERENCES_HINT}</p>
        </div>
        <div className="min-w-0 space-y-1">
          <OptionLabel id="claude-opcoes-notas" label="O que olhar nas referências" />
          <Textarea
            id="claude-opcoes-notas"
            rows={3}
            value={opcoes.notas}
            disabled={disabled}
            aria-invalid={notas > MAX_NOTAS}
            onChange={(event) => onChange({ notas: event.target.value })}
            placeholder="O que vale em cada uma, ou o que evitar: “a tipografia da primeira”, “nada do menu da segunda”."
            className="max-h-40 resize-y text-sm leading-relaxed"
          />
          <p className={cn("text-xs tabular-nums text-muted-foreground", notas > MAX_NOTAS && "text-destructive")}>
            {notas.toLocaleString("pt-BR")} de {MAX_NOTAS.toLocaleString("pt-BR")} caracteres
          </p>
        </div>
      </div>
      {problema && <p className="text-xs text-destructive">{problema}</p>}

      <div className="space-y-1">
        <OptionLabel id="claude-opcoes-observacoes" label="Observações para a criação" />
        <Textarea
          id="claude-opcoes-observacoes"
          rows={2}
          value={opcoes.observacoes}
          disabled={disabled}
          onChange={(event) => onChange({ observacoes: event.target.value })}
          placeholder="O que o briefing não diz: seções a destacar, o que evitar."
          className="max-h-40 resize-y text-sm leading-relaxed"
        />
      </div>
    </>
  );
}

/**
 * O resultado de "Conferir": o que a conferência diz do briefing — as
 * pendências que impediriam gerar, o resumo e os avisos — e com que modelo o
 * site roda. A frase digitada ao Claude, o id do modelo e o comando ficam em
 * "Detalhes técnicos".
 */
function PreviewResult({ conferido, defaults }: { conferido: Conferido; defaults: ClaudeOptions["defaults"] | null }) {
  const { plan, command, escolhas, comMudancas } = conferido;
  const pendencias = plan.errors.length;
  return (
    <div role="status" className="space-y-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
      <p className="font-medium">Conferido — nada foi disparado</p>
      {comMudancas && (
        <p className="text-muted-foreground">
          O ensaio leu o briefing gravado: as mudanças ainda não gravadas ficaram de fora.
        </p>
      )}

      {pendencias > 0 ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-warning">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden />
            {pluralize(pendencias, "pendência")} {plural(pendencias, "impede", "impedem")} gerar o site
          </p>
          <ol className="list-decimal space-y-0.5 pl-4">
            {plan.errors.map((erro) => (
              <li key={erro}>{erro}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p>O briefing passa pela conferência.</p>
      )}

      {plan.summary.length > 0 && (
        <div className="space-y-0.5">
          {plan.summary.map((linha) => (
            <p key={linha}>{linha}</p>
          ))}
        </div>
      )}
      {plan.warnings.length > 0 && <WarningsList avisos={plan.warnings} />}

      {escolhas && defaults && (
        <p className="text-muted-foreground">O site roda com {choicesSentence(escolhas, defaults)}.</p>
      )}

      <TechnicalDetails>
        <p>
          Pedido que será digitado ao Claude: <span className="text-foreground">“{plan.phrase}”</span>
        </p>
        {escolhas && defaults && <p>{choicesLine(escolhas, defaults)}</p>}
        <p>Comando que será executado:</p>
        <TechnicalCode>{command}</TechnicalCode>
      </TechnicalDetails>
    </div>
  );
}
