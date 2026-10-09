import { useState } from "react";
import {
  Camera,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  ImageOff,
  Loader2,
  PencilLine,
  Play,
  ShieldCheck,
  Square,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { ClaudeProjectDetail, ClaudeSite, Project } from "@/lib/api";
import {
  abortClaudeStage,
  adjustClaudeSite,
  approveClaudeDirection,
  captureClaudeSite,
  claudeImageUrl,
  continueClaudeSite,
  refuseClaudeStockPhoto,
  validateClaudeSite,
} from "@/lib/api";
import { formatDateTime, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyNotice } from "@/components/page-header";
import { claudeStageLabel, isClaudeSite } from "@/features/projects/project-status";
import { requestNotificationPermission } from "@/features/projects/use-stage-alerts";
import { cn } from "@/lib/utils";
import { AdjustAttachments, attachmentsPayload, useAdjustAttachments } from "./claude-adjust-attachments";
import { ConfirmClaudeDialog, HintWhenDisabled } from "./claude-shared";
import { errorMessage, semPermissaoDeGerar } from "./claude-text";
import { useClaudeRefresh } from "./use-claude";

type Props = {
  project: Project;
  detail: ClaudeProjectDetail;
  /** Há um pedido deste projeto na fila: nada mais mexe no site no meio dele. */
  busy: boolean;
};

/** Por que o botão que gasta está fora de alcance, se está. */
function useSpendBlock(detail: ClaudeProjectDetail, busy: boolean) {
  const { can } = usePermissions();
  if (!can("gerar")) return semPermissaoDeGerar;
  if (busy) return "Há um pedido deste projeto na fila do Claude.";
  if (!detail.generation.enabled) return "A geração pelo Claude está desligada neste painel.";
  return null;
}

/* ------------------------------------------------------------------ *
 * A direção criativa esperando aprovação
 * ------------------------------------------------------------------ */

/**
 * A direção criativa que o Claude propôs. O site só é escrito depois de
 * alguém aprovar — e, antes disso, dá para recusar as fotos de banco que ele
 * escolheu.
 */
export function ClaudeApprovalCard({ project, detail, busy }: Props) {
  const refresh = useClaudeRefresh();
  const site = detail.site!;
  const bloqueio = useSpendBlock(detail, busy);
  const { can } = usePermissions();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const aprovar = async () => {
    requestNotificationPermission();
    setWorking("approve");
    try {
      await approveClaudeDirection(project.id);
      await refresh();
      toast.success("Direção aprovada", { description: "A geração do site entrou na fila do Claude." });
    } catch (err) {
      toast.error("A direção não foi aprovada", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const recusar = async (ref: string) => {
    setWorking(ref);
    try {
      await refuseClaudeStockPhoto(project.id, ref);
      await refresh();
    } catch (err) {
      toast.error("Não foi possível recusar a foto", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  return (
    <section aria-labelledby="claude-direcao" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="claude-direcao" className="text-sm font-medium">
          Direção criativa
        </h3>
        <Badge variant="warning">Esperando a sua aprovação</Badge>
      </div>

      <pre className="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap">
        {site.brief ?? "O motor não devolveu o resumo da direção criativa."}
      </pre>

      {site.fotosPropostas.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Fotos de banco propostas · {site.fotosPropostas.length}
          </h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {site.fotosPropostas.map((foto) => (
              <li key={foto.ref} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                <div className="grid aspect-[4/3] place-items-center bg-muted/40">
                  {foto.miniatura ? (
                    <img
                      src={claudeImageUrl(project.id, "miniatura", foto.miniatura)}
                      alt={foto.alt}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImageOff className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
                  <p className="font-medium">{foto.uso}</p>
                  <p className="line-clamp-2 text-muted-foreground" title={foto.alt}>
                    {foto.alt}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    {foto.pagina ? (
                      <a
                        href={foto.pagina}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        <span className="truncate">{foto.autor || "ver no banco"}</span>
                      </a>
                    ) : (
                      <span />
                    )}
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={!can("gerar") || busy || working !== null}
                      onClick={() => void recusar(foto.ref)}
                      title="Tira esta foto da direção criativa. O site sai sem ela."
                    >
                      {working === foto.ref ? <Loader2 className="animate-spin" /> : <X />}
                      Recusar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {bloqueio && <p className="mr-auto text-xs text-muted-foreground">{bloqueio}</p>}
        <HintWhenDisabled reason={bloqueio}>
          <Button size="sm" disabled={Boolean(bloqueio) || working !== null} onClick={() => setConfirming(true)}>
            {working === "approve" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
            Aprovar e gerar o site
          </Button>
        </HintWhenDisabled>
      </div>

      <ConfirmClaudeDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Aprovar a direção e gerar o site?"
        confirmLabel="Aprovar e usar a assinatura"
        onConfirm={() => void aprovar()}
      >
        A direção criativa fica aprovada e o Claude escreve o site a partir dela.
      </ConfirmClaudeDialog>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * A execução que terminou com a etapa aberta
 * ------------------------------------------------------------------ */

/**
 * O Claude saiu sem fechar a etapa: não é sucesso, mesmo com código de saída
 * zero. Ou ele continua de onde parou, ou a etapa é encerrada como falha.
 */
export function ClaudeOpenStageCard({ project, detail, busy }: Props) {
  const refresh = useClaudeRefresh();
  const { can } = usePermissions();
  const site = detail.site!;
  const bloqueio = useSpendBlock(detail, busy);
  const [confirming, setConfirming] = useState<"continue" | "abort" | null>(null);
  const [working, setWorking] = useState<"continue" | "abort" | null>(null);
  const etapa = claudeStageLabel(site.etapaAberta) ?? "etapa";

  const continuar = async () => {
    requestNotificationPermission();
    setWorking("continue");
    try {
      await continueClaudeSite(project.id);
      await refresh();
      toast.success("Continuação na fila do Claude");
    } catch (err) {
      toast.error("Não foi possível continuar", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const encerrar = async () => {
    setWorking("abort");
    try {
      await abortClaudeStage(project.id, "encerrada pelo painel");
      await refresh();
      toast.success("Etapa encerrada");
    } catch (err) {
      toast.error("Não foi possível encerrar a etapa", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  return (
    <section aria-label="Etapa aberta" className="space-y-3">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>A execução terminou com a etapa de {etapa} aberta</AlertTitle>
        <AlertDescription>
          O Claude parou antes de fechar a etapa, então o site não foi validado. Continue de onde parou,
          ou encerre a etapa para poder pedir de novo.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {bloqueio && <p className="mr-auto text-xs text-muted-foreground">{bloqueio}</p>}
        <HintWhenDisabled reason={!can("gerar") ? semPermissaoDeGerar : busy ? "Há um pedido deste projeto na fila do Claude." : null}>
          <Button
            variant="outline"
            size="sm"
            disabled={!can("gerar") || busy || working !== null}
            onClick={() => setConfirming("abort")}
          >
            {working === "abort" ? <Loader2 className="animate-spin" /> : <Square />}
            Encerrar etapa
          </Button>
        </HintWhenDisabled>
        <HintWhenDisabled reason={bloqueio}>
          <Button size="sm" disabled={Boolean(bloqueio) || working !== null} onClick={() => setConfirming("continue")}>
            {working === "continue" ? <Loader2 className="animate-spin" /> : <Play />}
            Continuar de onde parou
          </Button>
        </HintWhenDisabled>
      </div>

      <ConfirmClaudeDialog
        open={confirming === "continue"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Continuar a geração?"
        confirmLabel="Continuar e usar a assinatura"
        onConfirm={() => void continuar()}
      >
        O Claude retoma a sessão do site e segue da etapa de {etapa}.
      </ConfirmClaudeDialog>

      <AlertDialog open={confirming === "abort"} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar a etapa de {etapa}?</AlertDialogTitle>
            <AlertDialogDescription>
              A etapa é fechada como falha e não dá mais para continuá-la. O que já foi escrito fica no site.
              Isto não usa o Claude.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void encerrar()}>
              Encerrar etapa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * O site: etapas, ajuste, validação, telas e filme
 * ------------------------------------------------------------------ */

const stageVariant = { aberta: "warning", concluida: "success", falhou: "destructive" } as const;
const stageStatus = { aberta: "Aberta", concluida: "Concluída", falhou: "Falhou" } as const;

/** O site no motor: o que já foi feito nele e o que dá para pedir agora. */
export function ClaudeSiteCard({ project, detail, busy, onPush }: Props & { onPush: () => void }) {
  const refresh = useClaudeRefresh();
  const { can } = usePermissions();
  const site = detail.site!;
  const bloqueio = useSpendBlock(detail, busy);
  const [pedido, setPedido] = useState("");
  const anexos = useAdjustAttachments(project.id);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState<"adjust" | "validate" | "telas" | "filme" | null>(null);
  const [validacao, setValidacao] = useState<{ ok: boolean; texto: string } | null>(null);
  /** Muda a cada captura: o navegador busca a imagem nova, com o mesmo nome. */
  const [versao, setVersao] = useState(0);

  const semPermissao = !can("gerar");
  const localBloqueado = semPermissao
    ? semPermissaoDeGerar
    : busy
      ? "Há um pedido deste projeto na fila do Claude."
      : null;
  // O ajuste só vale num site já gerado: com etapa aberta ou esperando
  // aprovação, o motor o recusa — e a tela nem oferece.
  const ajustavel = site.entregue && !site.etapaAberta && !site.aguardandoAprovacao;

  const ajustar = async () => {
    requestNotificationPermission();
    setWorking("adjust");
    try {
      await adjustClaudeSite(project.id, pedido.trim(), attachmentsPayload(anexos.draft, anexos.items));
      setPedido("");
      anexos.reset();
      await refresh();
      toast.success("Ajuste na fila do Claude", { description: "O card mostra o andamento." });
    } catch (err) {
      toast.error("O ajuste não entrou na fila", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const validar = async () => {
    setWorking("validate");
    try {
      const resultado = await validateClaudeSite(project.id);
      setValidacao(resultado);
      await refresh();
    } catch (err) {
      toast.error("Não foi possível validar o site", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const capturar = async (tipo: "telas" | "filme") => {
    setWorking(tipo);
    try {
      await captureClaudeSite(project.id, tipo);
      setVersao(Date.now());
      await refresh();
      toast.success(tipo === "telas" ? "Telas fotografadas" : "Abertura filmada");
    } catch (err) {
      toast.error(tipo === "telas" ? "Não foi possível fotografar o site" : "Não foi possível filmar o site", {
        description: errorMessage(err),
      });
    } finally {
      setWorking(null);
    }
  };

  return (
    <section aria-labelledby="claude-site" className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="claude-site" className="text-sm font-medium">
          Site
        </h3>
        <Badge variant={site.entregue ? "success" : "outline"}>{site.situacao}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{site.slug}</span>
      </div>

      {site.etapas.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[32rem] text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Etapa</th>
                <th className="px-3 py-1.5 font-medium">Situação</th>
                <th className="px-3 py-1.5 font-medium">Chamadas</th>
                <th className="px-3 py-1.5 font-medium">Builds</th>
                <th className="px-3 py-1.5 font-medium">Início</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {site.etapas.map((etapa) => (
                <tr key={etapa.n}>
                  <td className="px-3 py-1.5 first-letter:uppercase">
                    {claudeStageLabel(etapa.etapa)}
                    {etapa.pedido && (
                      <span className="block max-w-xs truncate text-muted-foreground normal-case" title={etapa.pedido}>
                        {etapa.pedido}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={stageVariant[etapa.status]}>{stageStatus[etapa.status]}</Badge>
                    {etapa.motivoFalha && (
                      <span className="mt-0.5 block max-w-xs truncate text-muted-foreground" title={etapa.motivoFalha}>
                        {etapa.motivoFalha}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {etapa.chamadas} de {etapa.limite}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {etapa.builds}
                    {etapa.errosBuild > 0 && ` · ${pluralize(etapa.errosBuild, "erro")}`}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{formatDateTime(etapa.inicio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GitHubRow project={project} detail={detail} busy={busy} onPush={onPush} />

      {ajustavel && (
        <div className="space-y-1.5">
          <Label htmlFor="claude-ajuste" className="text-sm font-medium">
            Pedir um ajuste
          </Label>
          <Textarea
            id="claude-ajuste"
            rows={3}
            value={pedido}
            disabled={semPermissao || busy}
            onChange={(event) => setPedido(event.target.value)}
            onPaste={(event) => {
              // Uma captura de tela colada vira anexo; texto colado segue normal.
              const imagens = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
              if (!imagens.length) return;
              event.preventDefault();
              void anexos.add(imagens);
            }}
            placeholder="O que deve mudar no site: “troque a foto do topo pela fachada” ou “deixe o texto dos serviços mais curto”."
            className="max-h-48 resize-y text-sm leading-relaxed"
          />
          <AdjustAttachments attachments={anexos} disabled={semPermissao || busy || working !== null} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {bloqueio && <p className="mr-auto text-xs text-muted-foreground">{bloqueio}</p>}
            <HintWhenDisabled reason={bloqueio}>
              <Button
                size="sm"
                disabled={Boolean(bloqueio) || !pedido.trim() || working !== null || anexos.uploading}
                onClick={() => setConfirming(true)}
              >
                {working === "adjust" ? <Loader2 className="animate-spin" /> : <PencilLine />}
                Pedir ajuste
              </Button>
            </HintWhenDisabled>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="mr-auto text-xs font-medium text-muted-foreground">
            Conferir nesta máquina · não usa o Claude
          </h4>
          <HintWhenDisabled reason={localBloqueado}>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(localBloqueado) || working !== null}
              onClick={() => void validar()}
              title="Roda o build e a validação do motor — os mesmos que fecham uma etapa."
            >
              {working === "validate" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Validar
            </Button>
          </HintWhenDisabled>
          <HintWhenDisabled reason={localBloqueado}>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(localBloqueado) || working !== null}
              onClick={() => void capturar("telas")}
              title="Fotografa o site no desktop e no celular, como o Claude o vê na revisão."
            >
              {working === "telas" ? <Loader2 className="animate-spin" /> : <Camera />}
              Fotografar telas
            </Button>
          </HintWhenDisabled>
          <HintWhenDisabled reason={localBloqueado}>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(localBloqueado) || working !== null}
              onClick={() => void capturar("filme")}
              title="Filma a abertura da página numa tira de quadros, para ver o movimento."
            >
              {working === "filme" ? <Loader2 className="animate-spin" /> : <Film />}
              Filmar abertura
            </Button>
          </HintWhenDisabled>
        </div>

        {validacao && (
          <Alert variant={validacao.ok ? "success" : "destructive"}>
            {validacao.ok ? <ShieldCheck /> : <TriangleAlert />}
            <AlertTitle>{validacao.ok ? "Build e validação passaram" : "A validação apontou problemas"}</AlertTitle>
            <AlertDescription>
              <pre className="max-h-48 overflow-y-auto font-mono text-xs whitespace-pre-wrap">{validacao.texto}</pre>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <Gallery
        title="Telas"
        empty="Nenhuma tela fotografada ainda."
        project={project}
        tipo="telas"
        arquivos={site.telas}
        versao={versao}
      />
      <Gallery
        title="Filme da abertura"
        empty="A abertura ainda não foi filmada."
        project={project}
        tipo="filme"
        arquivos={site.filme}
        versao={versao}
      />

      <ConfirmClaudeDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Pedir o ajuste ao Claude?"
        confirmLabel="Ajustar e usar a assinatura"
        onConfirm={() => void ajustar()}
      >
        O Claude retoma a sessão do site e aplica o que foi pedido
        {anexos.items.length > 0 && `, olhando ${pluralize(anexos.items.length, "imagem anexada", "imagens anexadas")}`}. O
        resultado só vale depois de validado.
      </ConfirmClaudeDialog>
    </section>
  );
}

/**
 * O site no GitHub: se a versão validada já foi, quando, e o botão para
 * mandar a que falta. O envio automático só acontece quando quem pediu a
 * geração também pode publicar; senão o site espera aqui.
 */
function GitHubRow({ project, detail, busy, onPush }: Props & { onPush: () => void }) {
  const { can } = usePermissions();
  const site = [...project.generations].reverse().find((item) => isClaudeSite(item));
  // Sem o registro do site, ele ainda não foi gerado e validado: não há o que enviar.
  if (!site) return null;

  const push = detail.project?.push ?? null;
  const pendente =
    !site.repoFullName ||
    Boolean(site.claudeValidatedAt && (!site.claudePushedAt || site.claudeValidatedAt > site.claudePushedAt));
  const motivo = !can("publicar")
    ? "Esta chave de acesso não tem permissão para publicar sites"
    : busy
      ? "Há um pedido deste projeto na fila do Claude."
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            GitHub
            {site.repoFullName && (
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{site.repoFullName}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {!site.repoFullName
              ? "O site foi gerado e validado, e ainda não está no GitHub."
              : pendente
                ? "Há uma versão validada depois do último envio: o link do cliente segue com a anterior."
                : `Versão validada enviada em ${formatDateTime(site.claudePushedAt)}${push?.automatic ? ", pelo painel" : push?.by ? `, por ${push.by}` : ""}.`}
          </p>
        </div>
        <HintWhenDisabled reason={motivo}>
          <Button size="sm" variant={pendente ? "default" : "outline"} disabled={Boolean(motivo)} onClick={onPush}>
            <Upload />
            {site.repoFullName ? (pendente ? "Enviar ao GitHub" : "Enviar de novo") : "Enviar ao GitHub"}
          </Button>
        </HintWhenDisabled>
      </div>
      {push?.state === "failed" && push.message && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{push.automatic ? "O envio automático ao GitHub falhou" : "O último envio ao GitHub falhou"}</AlertTitle>
          <AlertDescription>
            <pre className="max-h-40 overflow-y-auto font-sans text-sm whitespace-pre-wrap">{push.message}</pre>
          </AlertDescription>
        </Alert>
      )}
      {push?.state === "sent" && push.message && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>O site foi ao GitHub, mas a prévia não foi publicada</AlertTitle>
          <AlertDescription>{push.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** As capturas do site: miniaturas que abrem em tamanho real. */
function Gallery({
  title,
  empty,
  project,
  tipo,
  arquivos,
  versao,
}: {
  title: string;
  empty: string;
  project: Project;
  tipo: "telas" | "filme";
  arquivos: ClaudeSite["telas"];
  versao: number;
}) {
  const [aberta, setAberta] = useState<number | null>(null);
  const url = (arquivo: string) => claudeImageUrl(project.id, tipo, arquivo, versao || undefined);
  const nome = (arquivo: string) => arquivo.replace(/\.png$/i, "").replace(/[-_]+/g, " ");

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">
        {title}
        {arquivos.length > 0 && ` · ${arquivos.length}`}
      </h4>
      {arquivos.length === 0 ? (
        <EmptyNotice icon={tipo === "telas" ? <Camera /> : <Film />} title={empty} className="rounded-lg border py-6" />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
          {arquivos.map((arquivo, indice) => (
            <li key={arquivo}>
              <button
                type="button"
                onClick={() => setAberta(indice)}
                className="group block w-full overflow-hidden rounded-lg border bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label={`Abrir ${nome(arquivo)} em tamanho real`}
              >
                <img
                  src={url(arquivo)}
                  alt=""
                  loading="lazy"
                  className="aspect-[4/3] w-full bg-muted/40 object-cover object-top transition group-hover:opacity-90"
                />
                <span className="block truncate px-2 py-1 text-2xs text-muted-foreground">{nome(arquivo)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={aberta !== null} onOpenChange={(open) => !open && setAberta(null)}>
        <DialogContent layout="sectioned" className="h-[92vh] sm:max-w-[min(1280px,96vw)]">
          {aberta !== null && arquivos[aberta] && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base first-letter:uppercase">{nome(arquivos[aberta])}</DialogTitle>
                <DialogDescription>
                  {title} · {aberta + 1} de {arquivos.length}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
                <img
                  src={url(arquivos[aberta])}
                  alt={`${title}: ${nome(arquivos[aberta])}`}
                  className="mx-auto h-auto max-w-full rounded-md border shadow-sm"
                />
              </div>
              <div className={cn("flex shrink-0 items-center justify-between gap-2 border-t px-6 py-3", arquivos.length < 2 && "hidden")}>
                <Button variant="outline" size="sm" disabled={aberta === 0} onClick={() => setAberta(aberta - 1)}>
                  <ChevronLeft />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={aberta === arquivos.length - 1}
                  onClick={() => setAberta(aberta + 1)}
                >
                  Próxima
                  <ChevronRight />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
