import { Settings2 } from "lucide-react";
import { ftpProtocolLabels, type Publication } from "@/lib/api/deploy";
import { SectionCard } from "@/components/section-card";
import { When } from "@/components/when";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * O aviso de workflows gerados por uma versão anterior do painel — um texto
 * só, com uma instrução só. Antes ele aparecia em três lugares (resumo,
 * cartão de workflows e diálogo de publicar), cada um mandando fazer uma
 * coisa diferente.
 */
export function OutdatedWorkflowsAlert() {
  return (
    <Alert variant="warning">
      <Settings2 />
      <AlertTitle>Workflows de uma versão antiga do painel</AlertTitle>
      <AlertDescription>
        Publicar continua funcionando, mas sem a conferência da assinatura Joinvix no build. Para
        atualizar, salve a configuração de novo em <b>Alterar configuração</b> (a senha FTP é
        pedida outra vez).
      </AlertDescription>
    </Alert>
  );
}

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
  const protocolo = settings
    ? // Um protocolo fora do mapa (gravado por outra versão) sai como veio,
      // nunca como "undefined".
      (ftpProtocolLabels[settings.protocol] ?? settings.protocol ?? "—")
    : "—";
  const linhas: Array<[string, string]> = [
    ["Domínio", publication.domain ?? "—"],
    ["Servidor FTP", settings?.ftpServer || "—"],
    ["Login FTP", settings?.ftpLogin || "—"],
    // Campo vazio: vale o padrão do workflow do painel. O painel não sabe para
    // onde o envio de fato foi, então não afirma um caminho.
    ["Pasta remota", settings ? settings.serverDir || "padrão do painel" : "—"],
    ["Protocolo", `${protocolo}${settings?.port ? ` · porta ${settings.port}` : ""}`],
    ["A cada push", settings ? (settings.autoDeploy ? "publica sozinho" : "não publica") : "—"],
  ];

  return (
    <SectionCard
      title="Publicação configurada"
      description={
        <>
          Secrets e workflows gravados no repositório
          {publication.configuredAt && (
            <>
              {" "}
              <When at={publication.configuredAt} />
            </>
          )}
          {publication.configuredBy ? ` por ${publication.configuredBy}` : ""}. A senha FTP já está
          lá.
        </>
      }
      actions={
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
          <Settings2 />
          Alterar configuração
        </Button>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-lead gap-x-4 gap-y-1 text-xs">
          {linhas.map(([rotulo, valor]) => (
            <div key={rotulo} className="contents">
              <dt className="text-muted-foreground">{rotulo}</dt>
              <dd className="truncate" title={valor}>
                {valor}
              </dd>
            </div>
          ))}
        </dl>
        {outdatedWorkflows.length > 0 && <OutdatedWorkflowsAlert />}
      </div>
    </SectionCard>
  );
}
