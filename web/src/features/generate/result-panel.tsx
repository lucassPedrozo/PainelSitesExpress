import { Check, CircleCheck, ExternalLink } from "lucide-react";
import type { GenerationResult, LovableStatus } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TechnicalCode, TechnicalDetails } from "@/components/technical-details";

/**
 * O painel conectado ao Lovable, no cabeçalho de quem gera. Desconectado não
 * vira selo: o aviso de conexão, logo abaixo, já diz e oferece o que fazer.
 */
export function ConnectionBadge({ status }: { status: LovableStatus | null }) {
  if (!status?.connected) return null;
  return (
    <Badge variant="success">
      <Check />
      Lovable conectado
    </Badge>
  );
}

/** O formato do retorno do Lovable não é documentado: lemos com tolerância. */
const pick = (result: GenerationResult, ...keys: string[]) => {
  const data = result.project ?? {};
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
};

/** O endereço do projeto criado no Lovable. */
const lovableResultUrl = (result: GenerationResult) =>
  pick(result, "url", "project_url", "preview_url", "app_url");

/**
 * "Abrir no Lovable", a ação principal do rodapé depois de gerar. Sem o
 * endereço na resposta, não há o que abrir — e o botão não aparece.
 */
export function OpenInLovable({ result }: { result: GenerationResult }) {
  const url = lovableResultUrl(result);
  if (!url) return null;
  return (
    <Button asChild>
      <a href={url} target="_blank" rel="noreferrer">
        <ExternalLink />
        Abrir no Lovable
      </a>
    </Button>
  );
}

/**
 * O site criado: o que foi enviado, em uma linha. "Abrir no Lovable" fica no
 * rodapé do diálogo, como ação principal; o id do projeto e a resposta crua
 * ficam em "Detalhes técnicos".
 */
export function ResultPanel({ result }: { result: GenerationResult }) {
  const url = lovableResultUrl(result);
  const id = pick(result, "id", "project_id");

  return (
    <Alert variant="success">
      <CircleCheck />
      <AlertTitle>Site criado no Lovable</AlertTitle>
      <AlertDescription className="space-y-1.5">
        <p>
          {pluralize(result.attachments.length, "anexo enviado", "anexos enviados")} e{" "}
          {pluralize(result.promptChars, "caractere")} de prompt.{" "}
          {url
            ? "O link ficou salvo no card do projeto."
            : "O Lovable não devolveu o link do projeto: confira na sua conta do Lovable."}
        </p>
        <TechnicalDetails>
          {id && <p>Projeto no Lovable: {id}</p>}
          <TechnicalCode>{JSON.stringify(result.project, null, 2)}</TechnicalCode>
        </TechnicalDetails>
      </AlertDescription>
    </Alert>
  );
}
