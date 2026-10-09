import { CheckCircle2, Settings2 } from "lucide-react";
import { ftpProtocolLabels, type Publication } from "@/lib/api/deploy";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * A configuração já gravada, em vez do formulário.
 *
 * Republicar um site já configurado é o caso de todos os dias, e a tela
 * mostrava sempre os seis campos — com a senha vazia — antes do botão de
 * publicar. Aqui a configuração vira leitura, e o formulário fica a um
 * clique, para quando algo precisa mudar (ele pede a senha de novo).
 */
export function PublicationSummary({
  publication,
  outdatedWorkflows,
  disabled,
  onEdit,
}: {
  publication: Publication;
  outdatedWorkflows: string[];
  disabled: boolean;
  onEdit: () => void;
}) {
  const settings = publication.settings;
  const linhas: Array<[string, string]> = [
    ["Domínio", publication.domain ?? "—"],
    ["Servidor FTP", settings?.ftpServer ?? "—"],
    ["Login FTP", settings?.ftpLogin ?? "—"],
    [
      "Pasta remota",
      settings?.serverDir || `domains/${publication.domain ?? "<domínio>"}/public_html (padrão)`,
    ],
    [
      "Protocolo",
      `${settings ? ftpProtocolLabels[settings.protocol] : "—"}${settings?.port ? ` · porta ${settings.port}` : ""}`,
    ],
    ["A cada push", settings?.autoDeploy ? "publica sozinho" : "não publica"],
  ];

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-success" />
          Publicação configurada
        </CardTitle>
        <CardDescription>
          Secrets e workflows gravados no repositório
          {publication.configuredAt && (
            <>
              {" "}
              <span title={formatDateTime(publication.configuredAt)}>
                {relativeTime(publication.configuredAt)}
              </span>
            </>
          )}
          {publication.configuredBy ? ` por ${publication.configuredBy}` : ""}. A senha FTP já
          está lá.
        </CardDescription>
        <CardAction>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
            <Settings2 />
            Alterar configuração
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {linhas.map(([rotulo, valor]) => (
            <div key={rotulo} className="contents">
              <dt className="text-muted-foreground">{rotulo}</dt>
              <dd className="truncate" title={valor}>
                {valor}
              </dd>
            </div>
          ))}
        </dl>
        {outdatedWorkflows.length > 0 && (
          <Alert variant="warning">
            <Settings2 />
            <AlertTitle>Workflows de uma versão antiga do painel</AlertTitle>
            <AlertDescription>
              Publicar continua funcionando, mas sem a conferência da assinatura Joinvix no
              build. <b>Alterar configuração</b> e salvar de novo atualiza.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
