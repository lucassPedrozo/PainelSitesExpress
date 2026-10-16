import { useEffect, useRef, useState, type FormEvent } from "react";
import { isExternalSite } from "@shared/external-site.js";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  HelpCircle,
  Link2,
  Loader2,
  RefreshCw,
  Rocket,
  Send,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Generation, PreviewState, Project } from "@/lib/api";
import {
  attachSharePreview,
  checkSharePreview,
  fetchDevAreaStatus,
  setGenerationDelivered,
} from "@/lib/api";
import {
  publishToApprovalArea,
  sendToClient,
} from "@/features/projects/client-delivery";
import { DevAreaStepsView } from "./dev-area-steps-view";
import { clientUrlOf, devAreaOf } from "@/features/projects/project-status";
import { usePermissions } from "@/lib/permissions";
import { SHARE_PREVIEW_INPUT_ID } from "./share-input-id";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { Reason } from "@/components/disabled-hint";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { NextStep } from "@/features/projects/next-step";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * O link que vai ao cliente.
 *
 * Duas coisas que a tela precisa deixar óbvias, porque as duas custaram para
 * ser descobertas:
 *
 * 1. O preview do Lovable (`id-preview--….lovable.app`) **não abre para o
 *    cliente** — devolve 401 mesmo com o projeto marcado como público. Só o
 *    link do botão "Share preview" abre, e o MCP do Lovable não sabe criá-lo.
 *    Por isso este campo existe: é colar à mão, uma vez por link.
 * 2. A validade não é de 7 dias. Os 7 dias são do token que o link reemite a
 *    cada visita. Medindo os links em uso havia um de 32 dias funcionando e
 *    três de 7 dias mortos. Só a sonda diz a verdade — daí "verificar agora".
 *
 * Com a área de aprovação configurada, o link é a pasta do site lá
 * (`https://sitexpress.../zezinho/`), publicada sozinha a cada push, e o campo
 * do Share preview sai de cena — fica só para os sites de antes dela.
 *
 * A ordem de leitura é fixa: (1) o que é e em que estado está; (2) as etapas
 * da área de aprovação, se o site está nela; (3) o endereço e a ação
 * principal; (4) os detalhes; (5) as ações secundárias. Antes tudo isso
 * dividia a mesma hierarquia e nada dizia o que fazer primeiro.
 */

const ESTADOS: Record<
  PreviewState,
  { rotulo: string; variant: "success" | "destructive" | "warning"; Icone: typeof CheckCircle2 }
> = {
  alive: { rotulo: "Aberto ao cliente", variant: "success", Icone: CheckCircle2 },
  dead: { rotulo: "Não abre", variant: "destructive", Icone: XCircle },
  unknown: { rotulo: "Não verificado", variant: "warning", Icone: HelpCircle },
};

type Props = {
  project: Project;
  generation: Generation;
  /** O passo que o cabeçalho do diálogo já oferece — a ação dele não se repete aqui. */
  stepKind?: NextStep["kind"];
  /** Aberto por "Criar link": foca o campo, e volta a focar quando a aba volta. */
  focusInput?: boolean;
  onUpdated: (generation: Generation) => void;
  className?: string;
};

export function ClientLink({
  project,
  generation,
  stepKind,
  focusInput = false,
  onUpdated,
  className,
}: Props) {
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [entregando, setEntregando] = useState(false);
  /** Com o link abrindo, trocar o preview é exceção: fica atrás de um clique. */
  const [trocando, setTrocando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const { can } = usePermissions();
  const areaDev = useQuery({
    queryKey: ["dev-area-status"],
    queryFn: fetchDevAreaStatus,
    staleTime: 5 * 60_000,
  });

  /**
   * "Criar link" abre o Lovable em outra aba. Quem volta ao painel volta com
   * o link copiado — o campo já está esperando, é só colar. (O primeiro foco,
   * na abertura, é do diálogo: o foco automático dele passaria por cima.)
   */
  useEffect(() => {
    if (!focusInput) return;
    const focar = () => {
      if (campo.current && !campo.current.value) campo.current.focus();
    };
    window.addEventListener("focus", focar);
    return () => window.removeEventListener("focus", focar);
  }, [focusInput]);

  if (!generation.id) return null;

  // O `create_project` não devolve `url`; o editor segue o formato fixo do
  // Lovable a partir do id do projeto, que sempre vem.
  const editorUrl =
    generation.url ?? `https://lovable.dev/projects/${generation.id}`;

  const estado = ESTADOS[generation.previewState] ?? ESTADOS.unknown;
  const { Icone } = estado;
  const area = devAreaOf(generation);
  const clienteUrl = clientUrlOf(generation);
  // Na primeira publicação a pasta ainda não foi conferida: o endereço já
  // aparece, mas o envio só libera quando ela abre.
  const endereco = clienteUrl ?? area?.url ?? null;
  // Site vinculado de fora do Lovable: não existe Share preview a colar — o
  // link do cliente é a pasta na área de aprovação.
  const externo = isExternalSite(generation);
  const podePublicar = can("publicar");

  const falhar = (erro: unknown, titulo: string) =>
    toast.error(titulo, {
      description:
        erro instanceof Error ? erro.message : "Tente novamente em instantes.",
    });

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    const valor = rascunho.trim();
    if (!valor || !generation.id) return;

    setSalvando(true);
    try {
      const { generation: atualizada, shortLink } = await attachSharePreview(
        project.id,
        generation.id,
        valor,
      );
      onUpdated(atualizada);
      setRascunho("");
      setTrocando(false);
      toast.success(
        shortLink.action === "created"
          ? "Link do cliente criado"
          : shortLink.action === "repointed"
            ? "Link do cliente reapontado — o endereço continua o mesmo"
            : "Link já apontava para este preview",
        { description: shortLink.url ?? undefined },
      );
    } catch (erro) {
      falhar(erro, "Não foi possível usar este link");
    } finally {
      setSalvando(false);
    }
  };

  const verificar = async () => {
    if (!generation.id) return;
    setVerificando(true);
    try {
      const { generation: atualizada } = await checkSharePreview(
        project.id,
        generation.id,
      );
      onUpdated(atualizada);
      if (atualizada.previewState === "alive") {
        toast.success("O link abre para o cliente");
      } else if (atualizada.previewState === "dead") {
        toast.error("O link não abre", {
          description: atualizada.previewDetail ?? undefined,
        });
      } else {
        toast.warning("Não foi possível confirmar", {
          description: atualizada.previewDetail ?? undefined,
        });
      }
    } catch (erro) {
      falhar(erro, "Falha ao verificar o link");
    } finally {
      setVerificando(false);
    }
  };

  /** Copia a mensagem com o link e registra a entrega, num gesto só. */
  const enviar = async () => {
    setEntregando(true);
    try {
      await sendToClient(project, generation, (_projeto, atualizada) =>
        onUpdated(atualizada),
      );
    } finally {
      setEntregando(false);
    }
  };

  const desfazerEntrega = async () => {
    if (!generation.id) return;
    setEntregando(true);
    try {
      const { generation: atualizada } = await setGenerationDelivered(
        project.id,
        generation.id,
        false,
      );
      onUpdated(atualizada);
      toast.success("Registro de entrega desfeito");
    } catch (erro) {
      falhar(erro, "Não foi possível desfazer a entrega");
    } finally {
      setEntregando(false);
    }
  };

  const copiar = async () => {
    if (!endereco) return;
    const ok = await copyToClipboard(endereco);
    if (ok) toast.success("Link copiado");
    else toast.error("Não foi possível copiar", { description: endereco });
  };

  const publicarNaArea = async () => {
    setPublicando(true);
    try {
      await publishToApprovalArea(project, generation, (_projeto, atualizada) =>
        onUpdated(atualizada),
      );
    } finally {
      setPublicando(false);
    }
  };

  /** O formulário do Share preview aparece aberto ou atrás de "Trocar o preview". */
  const formularioRecolhido =
    !area &&
    !externo &&
    generation.previewState === "alive" &&
    Boolean(generation.sharePreviewUrl) &&
    !trocando &&
    !focusInput;
  const mostraFormulario = !area && !externo && !formularioRecolhido;

  // O passo do cabeçalho já oferece estas ações: aqui elas não se repetem.
  const enviarNoCabecalho = stepKind === "send";
  const verificarNoCabecalho = stepKind === "verify-link";
  const publicarNoCabecalho = stepKind === "approval";
  const temLink = Boolean(generation.sharePreviewUrl || area?.repoFullName || endereco);
  const podeGerar = can("gerar");

  return (
    <div className={cn("space-y-3", className)}>
      {/* ---- 1. O que é, em que estado está, e a conferência ------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">Link do cliente</h3>
        {temLink ? (
          <Badge variant={estado.variant}>
            <Icone />
            {estado.rotulo}
          </Badge>
        ) : (
          <Badge variant="secondary">Ainda sem link</Badge>
        )}
        {(generation.sharePreviewUrl || area?.repoFullName) && !verificarNoCabecalho && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={verificando}
            onClick={verificar}
            title="Sonda o link agora — é ela que decide se ele pode ir ao cliente"
          >
            <RefreshCw className={cn(verificando && "animate-spin")} />
            Verificar agora
          </Button>
        )}
      </div>

      {/* ---- 2. As etapas da área de aprovação --------------------------- */}
      {area && (
        <DevAreaStepsView
          area={area}
          previewState={generation.previewState}
          editorUrl={editorUrl}
          canPublish={podePublicar}
          publishing={publicando}
          onPublish={() => void publicarNaArea()}
          delivered={Boolean(generation.deliveredAt)}
        />
      )}

      {/* ---- 3. O endereço e o envio -------------------------------------- */}
      {endereco ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg bg-muted px-3 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs" title={endereco}>
                {endereco}
              </code>
              <Button type="button" variant="ghost" size="icon-sm" onClick={copiar} aria-label="Copiar link do cliente" title="Copiar">
                <Copy />
              </Button>
              <Button asChild variant="ghost" size="icon-sm">
                <a href={endereco} target="_blank" rel="noreferrer" aria-label="Abrir link do cliente" title="Abrir">
                  <ExternalLink />
                </a>
              </Button>
            </div>
            {!generation.deliveredAt && clienteUrl && !enviarNoCabecalho && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={entregando || generation.previewState !== "alive" || !podeGerar}
                onClick={() => void enviar()}
              >
                {entregando ? <Loader2 className="animate-spin" /> : <Send />}
                Enviar ao cliente
              </Button>
            )}
          </div>
          {!generation.deliveredAt && clienteUrl && !enviarNoCabecalho && generation.previewState !== "alive" && (
            <Reason>Só dá para enviar um link que abre: verifique antes.</Reason>
          )}
          {!generation.deliveredAt && clienteUrl && !podeGerar && <Reason>Sua chave de acesso não pode enviar ao cliente.</Reason>}
        </div>
      ) : area ? null : externo ? (
        <p className="text-xs text-muted-foreground">
          {generation.engine === "claude" && !generation.repoFullName
            ? "O link nasce na área de aprovação, depois que o código do site vai ao GitHub."
            : "O link nasce quando a prévia é publicada na área de aprovação."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Cole abaixo o link do <b className="font-medium">Share preview</b> e o painel cria o endereço curto.
        </p>
      )}

      {generation.deliveredAt && (
        <Alert variant="success">
          <Send />
          <AlertTitle>
            Enviado ao cliente em {formatDateTime(generation.deliveredAt)}
            {generation.deliveredBy ? ` por ${generation.deliveredBy}` : ""}
          </AlertTitle>
          <AlertAction>
            <Button type="button" variant="ghost" size="sm" disabled={entregando || !podeGerar} onClick={desfazerEntrega}>
              <Undo2 />
              Desfazer
            </Button>
          </AlertAction>
        </Alert>
      )}

      {/* ---- 4. Os detalhes ------------------------------------------------ */}
      {/* O motivo de um link que não abre é o que importa: fica à vista. */}
      {generation.previewState === "dead" && generation.previewDetail && (
        <p className="text-xs text-destructive">{generation.previewDetail}</p>
      )}
      {/* A assinatura é conferida quando o agente termina; faltando, o painel
          pede uma vez ao agente e, se ainda faltar, o build da publicação
          insere no fim da página. */}
      {generation.signatureFound === false && (
        <p className="text-xs text-warning">
          {generation.signatureFixSent
            ? "A assinatura Joinvix ainda não está no código, mesmo depois do pedido ao agente. A publicação insere no fim da página; confira o rodapé no Lovable."
            : "Assinatura Joinvix não encontrada no código. A publicação insere no fim da página."}
        </p>
      )}
      {((generation.previewDetail && generation.previewState !== "dead") ||
        generation.previewCheckedAt ||
        generation.screenshotUrl) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            Detalhes da verificação
          </summary>
          <div className="mt-1.5 space-y-1 pl-3">
            {generation.previewDetail && generation.previewState !== "dead" && <p>{generation.previewDetail}</p>}
            {generation.previewCheckedAt && <p>Verificado em {formatDateTime(generation.previewCheckedAt)}.</p>}
            {/* Captura que o Lovable tira quando o agente termina. Abre em outra
                aba: a política de segurança do painel só carrega imagens dele. */}
            {generation.screenshotUrl && (
              <a
                href={generation.screenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              >
                <ExternalLink className="size-3" />
                Ver a captura do site
              </a>
            )}
          </div>
        </details>
      )}

      {/* ---- 5. Ações secundárias ------------------------------------------ */}
      {!area && areaDev.data?.configured && !publicarNoCabecalho && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <p className="min-w-48 flex-1 text-xs text-muted-foreground">
            {generation.shortUrl || generation.sharePreviewUrl
              ? "Publicar na área de aprovação troca o link do cliente pela pasta do site, assim que ela for conferida."
              : generation.origin === "linked"
                ? "Site vinculado de fora do painel: publique a prévia para ter o link do cliente."
                : generation.engine === "claude"
                  ? generation.repoFullName
                    ? "Site gerado pelo Claude, já no GitHub: publique a prévia para ter o link do cliente."
                    : "Site gerado pelo Claude: envie o código ao GitHub, e a prévia é publicada em seguida."
                  : "O painel publica sozinho na área de aprovação assim que o projeto é conectado ao GitHub no Lovable."}
          </p>
          <Button type="button" size="sm" variant="outline" disabled={publicando || !podePublicar} onClick={() => void publicarNaArea()}>
            {publicando ? <Loader2 className="animate-spin" /> : <Rocket />}
            Publicar na área de aprovação
          </Button>
          {!podePublicar && <Reason className="basis-full">Sua chave de acesso não pode publicar.</Reason>}
        </div>
      )}

      {formularioRecolhido && (
        <Button type="button" variant="link" size="xs" className="px-0 text-muted-foreground" onClick={() => setTrocando(true)}>
          Trocar o preview (o endereço curto não muda)
        </Button>
      )}

      {mostraFormulario && (
        <form onSubmit={salvar} className="space-y-1.5">
          <Label htmlFor={SHARE_PREVIEW_INPUT_ID} className="text-xs">
            {generation.sharePreviewUrl ? "Trocar o preview (o endereço curto não muda)" : "Link do Share preview, no Lovable"}
          </Label>
          <div className="flex gap-2">
            <Input
              ref={campo}
              id={SHARE_PREVIEW_INPUT_ID}
              inputMode="url"
              autoComplete="off"
              placeholder="https://lovable.dev/preview/…"
              value={rascunho}
              disabled={!podeGerar}
              onChange={(event) => setRascunho(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!rascunho.trim() || salvando || !podeGerar}>
              {salvando ? <Loader2 className="animate-spin" /> : <Link2 />}
              {generation.sharePreviewUrl ? "Reapontar" : "Encurtar"}
            </Button>
          </div>
          {podeGerar ? (
            <p className="text-xs text-muted-foreground">
              No Lovable
              {editorUrl && (
                <>
                  {" "}(
                  <a href={editorUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">
                    abrir o projeto
                  </a>
                  )
                </>
              )}
              : <b className="font-medium">Share</b> → <b className="font-medium">Create new preview link</b>. O preview do
              editor não serve — ele pede login.
            </p>
          ) : (
            <Reason>Sua chave de acesso não pode criar nem trocar o link do cliente.</Reason>
          )}
        </form>
      )}
    </div>
  );
}
