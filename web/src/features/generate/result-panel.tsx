import { Check, ExternalLink } from "lucide-react";
import type { GenerationResult, LovableStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ConnectionBadge({ status }: { status: LovableStatus | null }) {
  if (!status) return null;
  return status.connected ? (
    <Badge variant="secondary" className="gap-1">
      <Check className="size-3" />
      Lovable conectado
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      Desconectado
    </Badge>
  );
}

/** O formato do retorno do Lovable não é documentado: lemos com tolerância. */
export function ResultPanel({ result }: { result: GenerationResult }) {
  const data = result.project ?? {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "string" && value) return value;
    }
    return null;
  };

  const url = pick("url", "project_url", "preview_url", "app_url");
  const id = pick("id", "project_id");

  return (
    <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs">
      <p className="font-medium">Site criado no Lovable</p>
      <p className="mt-1 text-muted-foreground">
        {result.attachments.length} anexo(s) enviados ·{" "}
        {result.promptChars.toLocaleString("pt-BR")} caracteres de prompt
        {id && ` · projeto ${id}`}
      </p>
      {url && (
        <Button asChild size="sm" variant="outline" className="mt-2">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            Abrir no Lovable
          </a>
        </Button>
      )}
      {!url && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">
            Ver resposta completa
          </summary>
          <pre className="mt-1 overflow-x-auto text-2xs">
            {JSON.stringify(result.project, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
