import { toast } from "sonner";
import type { Generation, Project } from "@/lib/api";
import { checkSharePreview, publishToDevArea, setGenerationDelivered } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { projectIdentity } from "@/lib/format";
import { clientUrlOf } from "./project-status";

/**
 * Levar o link ao cliente.
 *
 * Eram três gestos em dois lugares: marcar "pronto" no card, copiar o link e,
 * depois do WhatsApp, voltar ao projeto para "Marcar como entregue". Agora é
 * um: "Enviar ao cliente" copia a mensagem pronta e registra a entrega — com
 * "Desfazer" no aviso, para o envio que acabou não acontecendo.
 */

/** A mensagem que vai para o WhatsApp do cliente. */
export function clientMessage(project: Project, clientUrl: string): string {
  const { label } = projectIdentity(project);
  return [
    `Olá! A prévia do site ${label} está pronta:`,
    clientUrl,
    "",
    "Dê uma olhada com calma e me conte o que achou. Se quiser ajustar alguma coisa, é só responder por aqui.",
  ].join("\n");
}

type Patch = (project: Project, generation: Generation) => void;

const motivo = (erro: unknown) =>
  erro instanceof Error ? erro.message : "Tente novamente em instantes.";

export async function sendToClient(
  project: Project,
  generation: Generation,
  onUpdated: Patch,
) {
  const link = clientUrlOf(generation);
  if (!generation.id || !link) return;
  const lovableId = generation.id;

  const copiado = await copyToClipboard(clientMessage(project, link));
  if (!copiado) {
    // Sem a mensagem na área de transferência não houve envio: registrar a
    // entrega aqui seria gravar algo que não aconteceu.
    toast.error("Não foi possível copiar a mensagem", {
      description: link,
    });
    return;
  }

  try {
    const { generation: entregue } = await setGenerationDelivered(
      project.id,
      lovableId,
      true,
    );
    onUpdated(project, entregue);
    toast.success("Mensagem copiada — cole no WhatsApp do cliente", {
      description: "A entrega ficou registrada.",
      duration: 8000,
      action: {
        label: "Desfazer",
        onClick: () => {
          void setGenerationDelivered(project.id, lovableId, false)
            .then(({ generation: desfeita }) => onUpdated(project, desfeita))
            .catch((erro) =>
              toast.error("Não foi possível desfazer", { description: motivo(erro) }),
            );
        },
      },
    });
  } catch (erro) {
    toast.error("A mensagem foi copiada, mas a entrega não foi registrada", {
      description: motivo(erro),
    });
  }
}

/** Confere o link pelo que o cliente recebe e avisa o resultado. */
export async function verifyClientLink(
  project: Project,
  generation: Generation,
  onUpdated: Patch,
) {
  if (!generation.id) return;
  try {
    const { generation: atualizada } = await checkSharePreview(
      project.id,
      generation.id,
    );
    onUpdated(project, atualizada);
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
    toast.error("Falha ao verificar o link", { description: motivo(erro) });
  }
}

/**
 * Publica o site na área de aprovação agora — inclusive o que já tem link de
 * visualização (Share preview ou link curto): depois de conferida, a pasta
 * passa a ser o link do cliente. Com a área já configurada, publica de novo.
 */
export async function publishToApprovalArea(
  project: Project,
  generation: Generation,
  onUpdated: Patch,
) {
  if (!generation.id) return;
  try {
    const { generation: atualizada } = await publishToDevArea(project.id, generation.id);
    onUpdated(project, atualizada);
    const endereco = atualizada.devArea?.url;
    toast.success("Publicação iniciada na área de aprovação", {
      description: endereco
        ? `O GitHub gera o site e o envia para ${endereco} — leva de 1 a 5 minutos. O painel confere a pasta e avisa quando o link estiver pronto para enviar ao cliente; até lá, vale o link anterior.`
        : "O GitHub gera o site e o envia para a pasta — leva de 1 a 5 minutos. O painel avisa quando o link estiver pronto.",
      duration: 10_000,
    });
  } catch (erro) {
    toast.error("Não foi possível publicar na área de aprovação", {
      description: motivo(erro),
    });
  }
}
