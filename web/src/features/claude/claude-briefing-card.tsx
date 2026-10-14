import { useState } from "react";
import { Bot, CircleAlert, FileSearch, ImageOff, Loader2, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type {
  ClaudeBriefing,
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
import { formatDateTime, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { cn } from "@/lib/utils";
import { BriefingEditor } from "./briefing-editor";
import { sameBriefing } from "./briefing-fields";
import { OptionSelect, RunChoicesFields } from "./claude-option-fields";
import {
  ART_DIRECTIONS,
  MAX_LINKS,
  MAX_NOTAS,
  MOTIONS,
  REFERENCES_HELP,
  RODADAS,
  ROUNDS_HELP,
  ROUTE_CHOICES,
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
import { ConfirmClaudeDialog, HintWhenDisabled } from "./claude-shared";
import { errorMessage, semPermissaoDeGerar } from "./claude-text";
import { useClaudeOptions, useClaudeRefresh } from "./use-claude";

/**
 * A revisão antes de gerar o site: o que a conferência do motor diz do
 * briefing, o próprio briefing para corrigir, as fotos que ele cita e as
 * opções do site. Só depois disso vem o botão que gasta.
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
  const [conferido, setConferido] = useState<{
    plan: ClaudeSitePlan;
    command: string;
    escolhas: ClaudeRunChoices | null;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const mudou = !sameBriefing(rascunho, gravado);
  const jaTemSite = review.projetos.length > 0;
  const semPermissao = !can("gerar");

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

  const mudarOpcoes = (patch: Partial<SiteOptionsDraft>) => setOpcoes((atual) => ({ ...atual, ...patch }));

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

  // O modelo e o esforço só vão quando alguém mexeu neles: sem a chave, o
  // servidor usa o que o projeto tem gravado.
  const conferir = async () => {
    setWorking("preview");
    try {
      const data = await previewClaudeSite(project.id, { refazer: jaTemSite, ...escolhas });
      setConferido({ plan: data.plan, command: data.command, escolhas: atuais });
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
      await generateClaudeSite(project.id, { refazer: jaTemSite, opcoes: siteOptionsPayload(opcoes), ...escolhas });
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

  // O que impede de gerar, na ordem em que a pessoa resolve.
  const motivo = semPermissao
    ? semPermissaoDeGerar
    : busy
      ? "Há um pedido deste projeto na fila do Claude."
      : !review.existe
        ? "Ainda não há briefing para gerar o site."
        : jsonInvalido
          ? "Corrija o JSON do briefing."
          : mudou
            ? "Grave o briefing antes de gerar."
            : review.erros.length > 0
              ? "A conferência ainda aponta pendências no briefing."
              : problemaDasOpcoes
                ? problemaDasOpcoes
                : !detail.generation.enabled
                  ? "A geração pelo Claude está desligada neste painel."
                  : null;

  const toggleSkill = (skill: string, marcada: boolean) =>
    setOpcoes((atual) => ({
      ...atual,
      skills: marcada ? [...atual.skills, skill] : atual.skills.filter((item) => item !== skill),
    }));

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
            material copiado em {formatDateTime(detail.project.material.copiedAt)} ·{" "}
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
          {review.avisos.length > 0 && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer select-none hover:text-foreground">
                {pluralize(review.avisos.length, "aviso")}: o site sai, mas mais simples
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {review.avisos.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {!escrevendo && (
        <>
          <BriefingEditor
            briefing={rascunho}
            onChange={setRascunho}
            onInvalidChange={setJsonInvalido}
            disabled={busy || semPermissao}
          />

          <div className="flex flex-wrap items-center gap-2">
            <HintWhenDisabled reason={semPermissao ? semPermissaoDeGerar : busy ? "Há um pedido deste projeto na fila do Claude." : null}>
              <Button
                variant="outline"
                size="sm"
                disabled={!mudou || Boolean(jsonInvalido) || busy || semPermissao || working !== null}
                onClick={() => void salvar()}
              >
                {working === "save" ? <Loader2 className="animate-spin" /> : <Save />}
                Gravar briefing
              </Button>
            </HintWhenDisabled>
            {mudou && !jsonInvalido && (
              <>
                <Button variant="ghost" size="sm" disabled={working !== null} onClick={() => setRascunho(gravado ?? {})}>
                  Descartar mudanças
                </Button>
                <span className="text-xs text-muted-foreground">Mudanças ainda não gravadas.</span>
              </>
            )}
          </div>
        </>
      )}

      {review.fotos.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Fotos do cliente citadas no briefing · {review.fotos.length}
          </h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {review.fotos.map((foto) => (
              <li key={foto.arquivo} className="overflow-hidden rounded-lg border bg-card">
                <div className="grid aspect-[4/3] place-items-center bg-muted/40">
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
        <fieldset className="space-y-4 rounded-lg border p-3" disabled={busy || semPermissao}>
          <legend className="px-1 text-xs font-medium text-muted-foreground">Opções do site</legend>

          {/* Quem escreve e quanto pensa: o que mais pesa no resultado e no consumo. */}
          <RunChoicesFields
            idPrefix="claude-opcoes"
            query={opcoesDoProjeto}
            value={atuais}
            disabled={busy || semPermissao}
            onChange={(next) => {
              setEscolhas(next);
              // O comando conferido era de outro modelo ou de outro esforço.
              setConferido(null);
            }}
          />

          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <OptionSelect
              id="claude-opcoes-rodadas"
              label="Rodadas de crítica e refino"
              value={opcoes.rodadas === null ? null : String(opcoes.rodadas)}
              onChange={(valor) => mudarOpcoes({ rodadas: valor === null ? null : Number(valor) })}
              defaultText={roundsLabel(padroes.rodadas)}
              options={RODADAS.map((numero) => ({ value: String(numero), label: roundsLabel(numero) }))}
              help={ROUNDS_HELP}
              disabled={busy || semPermissao}
            />
            <OptionSelect
              id="claude-opcoes-rota"
              label="Escolher a rota antes de gerar"
              value={routeChoiceValue(opcoes.escolher_rota)}
              onChange={(valor) => mudarOpcoes({ escolher_rota: valor === null ? null : valor === "sim" })}
              defaultText={padroes.escolher_rota ? "sim" : "não"}
              options={ROUTE_CHOICES}
              help={routeChoiceHelp(escolherRota)}
              disabled={busy || semPermissao}
            />
            <OptionSelect
              id="claude-opcoes-direcao"
              label="Direção de arte"
              value={opcoes.direcao_de_arte}
              onChange={(valor) => mudarOpcoes({ direcao_de_arte: valor })}
              defaultText={levelLabel(ART_DIRECTIONS, padroes.direcao_de_arte)}
              options={ART_DIRECTIONS}
              help={levelHelp(ART_DIRECTIONS, opcoes.direcao_de_arte, padroes.direcao_de_arte)}
              disabled={busy || semPermissao}
            />
            <OptionSelect
              id="claude-opcoes-movimento"
              label="Movimento"
              value={opcoes.movimento}
              onChange={(valor) => mudarOpcoes({ movimento: valor })}
              defaultText={levelLabel(MOTIONS, padroes.movimento)}
              options={MOTIONS}
              help={levelHelp(MOTIONS, opcoes.movimento, padroes.movimento)}
              disabled={busy || semPermissao}
            />
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={opcoes.multiplas_paginas}
                onCheckedChange={(valor) => mudarOpcoes({ multiplas_paginas: valor })}
              />
              Várias páginas
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              title={
                review.bancos.length > 0
                  ? `Bancos configurados: ${review.bancos.join(", ")}`
                  : "Nenhum banco de imagens configurado: o site sai só com as fotos do cliente."
              }
            >
              <Switch
                checked={opcoes.banco_de_imagens}
                onCheckedChange={(valor) => mudarOpcoes({ banco_de_imagens: valor })}
              />
              Completar com fotos de banco
            </label>
          </div>

          {review.skillsDisponiveis.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Skills · até {review.maxSkills} por site
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {review.skillsDisponiveis.map((skill) => {
                  const marcada = opcoes.skills.includes(skill);
                  return (
                    <label key={skill} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={marcada}
                        disabled={!marcada && opcoes.skills.length >= review.maxSkills}
                        onCheckedChange={(valor) => toggleSkill(skill, valor === true)}
                      />
                      {skill}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="claude-opcoes-referencias" className="text-xs">
                Referências · um endereço por linha, até {MAX_LINKS}
              </Label>
              <Textarea
                id="claude-opcoes-referencias"
                rows={3}
                value={opcoes.links}
                spellCheck={false}
                aria-invalid={siteOptionsPayload(opcoes).referencias.links.length > MAX_LINKS}
                onChange={(event) => mudarOpcoes({ links: event.target.value })}
                placeholder="https://site-que-o-cliente-admira.com.br"
                className="max-h-40 resize-y text-sm leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">{REFERENCES_HELP} Só entram sites públicos da internet.</p>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="claude-opcoes-notas" className="text-xs">
                O que olhar nas referências
              </Label>
              <Textarea
                id="claude-opcoes-notas"
                rows={3}
                value={opcoes.notas}
                aria-invalid={opcoes.notas.trim().length > MAX_NOTAS}
                onChange={(event) => mudarOpcoes({ notas: event.target.value })}
                placeholder="O que vale em cada uma, ou o que evitar: “a tipografia da primeira”, “nada do menu da segunda”."
                className="max-h-40 resize-y text-sm leading-relaxed"
              />
              <p
                className={cn(
                  "text-xs tabular-nums text-muted-foreground",
                  opcoes.notas.trim().length > MAX_NOTAS && "text-destructive",
                )}
              >
                {opcoes.notas.trim().length.toLocaleString("pt-BR")} de {MAX_NOTAS.toLocaleString("pt-BR")} caracteres
              </p>
            </div>
          </div>
          {problemaDasOpcoes && <p className="text-xs text-destructive">{problemaDasOpcoes}</p>}

          <div className="space-y-1">
            <Label htmlFor="claude-opcoes-observacoes" className="text-xs">
              Observações para a criação
            </Label>
            <Textarea
              id="claude-opcoes-observacoes"
              rows={2}
              value={opcoes.observacoes}
              onChange={(event) => mudarOpcoes({ observacoes: event.target.value })}
              placeholder="O que o briefing não diz: seções a destacar, o que evitar."
              className="max-h-40 resize-y text-sm leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HintWhenDisabled reason={mudou ? "Grave o briefing antes de gravar as opções." : problemaDasOpcoes}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!opcoesMudaram || mudou || Boolean(problemaDasOpcoes) || working !== null}
                onClick={() => void gravarOpcoes()}
                title="Guarda as opções no projeto. Não usa o Claude."
              >
                {working === "options" ? <Loader2 className="animate-spin" /> : <Save />}
                Gravar opções
              </Button>
            </HintWhenDisabled>
            {opcoesMudaram && <span className="text-xs text-muted-foreground">Opções ainda não gravadas.</span>}
          </div>
          <p className="max-w-prose text-xs text-muted-foreground">
            As opções seguem com o pedido de gerar; “Gravar opções” as guarda antes, sem usar o Claude. O modelo
            e o esforço valem para as próximas execuções do projeto, ajustes incluídos; as outras, para o próximo
            site gerado.
          </p>
        </fieldset>
      )}

      {conferido && (
        <div className="space-y-1.5 rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
          <p className="font-medium">Conferido — nada foi disparado</p>
          <p className="text-muted-foreground">
            Pedido que será digitado ao Claude: <span className="text-foreground">“{conferido.plan.phrase}”</span>
          </p>
          {conferido.escolhas && opcoesDoProjeto.data && (
            <p className="text-muted-foreground">{choicesLine(conferido.escolhas, opcoesDoProjeto.data.defaults)}</p>
          )}
          <details className="text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">Comando que será executado</summary>
            <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-2xs leading-relaxed break-all whitespace-pre-wrap">
              {conferido.command}
            </pre>
          </details>
        </div>
      )}

      {jaTemSite && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Este briefing já gerou {pluralize(review.projetos.length, "site")}</AlertTitle>
          <AlertDescription>
            Para mudar o site que existe, peça um ajuste nele. Gerar de novo cria outro site, do zero.
          </AlertDescription>
        </Alert>
      )}

      {review.existe && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {motivo && <p className="mr-auto text-xs text-muted-foreground">{motivo}</p>}
          <Button
            variant="outline"
            size="sm"
            disabled={!review.existe || semPermissao || working !== null}
            onClick={() => void conferir()}
            title="Mostra o pedido e o comando que rodaria. Não usa o Claude."
          >
            {working === "preview" ? <Loader2 className="animate-spin" /> : <FileSearch />}
            Conferir
          </Button>
          <HintWhenDisabled reason={motivo}>
            <Button size="sm" disabled={Boolean(motivo) || working !== null} onClick={() => setConfirming(true)}>
              {working === "generate" ? <Loader2 className="animate-spin" /> : <Bot />}
              {jaTemSite ? "Gerar outro site do zero" : "Gerar site"}
            </Button>
          </HintWhenDisabled>
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
