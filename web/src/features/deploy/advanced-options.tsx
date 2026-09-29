import { ChevronDown, Settings2 } from "lucide-react";
import {
  ftpProtocolLabels,
  ftpProtocols,
  type PublicationSettings,
} from "@/lib/api/deploy";
import type { ValidationErrors } from "./deploy-types";
import { Field } from "./field";
import { advancedFilledCount, hasAdvancedError } from "./validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Pasta remota, porta, protocolo e variáveis de build: o que quase nunca muda
 * e, por isso, fica recolhido — com um selo quando há algo preenchido ou
 * recusado lá dentro.
 */
export function AdvancedOptions({
  settings,
  errors,
  open,
  onOpenChange,
  onChange,
}: {
  settings: PublicationSettings;
  errors: ValidationErrors;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<PublicationSettings>) => void;
}) {
  /**
   * Duas mensagens diferentes, porque as duas perguntas são diferentes.
   *
   * Preenchido: confirma o destino calculado — e diz que ele é relativo à home
   * do usuário FTP, que é o que faz alguém colar o caminho absoluto da
   * hospedagem por engano.
   *
   * Vazio: mostra o padrão do workflow, que segue a convenção da Hostinger.
   * Antes a dica dizia "Padrão: <o que você digitou>", então jamais revelava
   * que em cPanel o caminho é outro — e errar a pasta é justamente a falha
   * mais silenciosa desta tela.
   */
  const serverDir = settings.serverDir.trim().replace(/\/+$/, "");
  const serverDirHint = serverDir
    ? `Destino: ${serverDir}/ — relativo à home do usuário FTP.`
    : `Vazio usa domains/${settings.domain.trim() || "<domínio>"}/public_html, padrão da Hostinger. Em cPanel, use public_html.`;

  const advancedCount = advancedFilledCount(settings);
  const advancedInvalid = hasAdvancedError(errors);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start"
        >
          <Settings2 className="size-4" />
          Opções avançadas
          {advancedInvalid ? (
            <Badge variant="destructive" className="ml-1.5">
              revisar
            </Badge>
          ) : (
            advancedCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 tabular-nums">
                {advancedCount}
              </Badge>
            )
          )}
          <ChevronDown
            className={cn(
              "ml-auto size-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field
            id="server-dir"
            label="Pasta remota"
            error={errors.serverDir}
            hint={serverDirHint}
          >
            <Input
              id="server-dir"
              autoComplete="off"
              placeholder="domains/meusite.com.br/public_html"
              value={settings.serverDir}
              aria-invalid={Boolean(errors.serverDir)}
              aria-describedby="server-dir-message"
              onChange={(event) =>
                onChange({ serverDir: event.target.value })
              }
            />
          </Field>

          <Field
            id="ftp-port"
            label="Porta"
            error={errors.port}
            hint="Vazio usa a porta 21."
          >
            <Input
              id="ftp-port"
              inputMode="numeric"
              autoComplete="off"
              placeholder="21"
              value={settings.port}
              aria-invalid={Boolean(errors.port)}
              aria-describedby="ftp-port-message"
              onChange={(event) => onChange({ port: event.target.value })}
            />
          </Field>

          <Field
            id="ftp-protocol"
            label="Protocolo"
            className="sm:col-span-2"
            hint="Automático exige FTPS e interrompe a publicação se o servidor não aceitar. FTP simples envia a senha sem criptografia."
          >
            <Select
              value={settings.protocol}
              onValueChange={(value) =>
                onChange({
                  protocol: value as PublicationSettings["protocol"],
                })
              }
            >
              <SelectTrigger
                id="ftp-protocol"
                aria-describedby="ftp-protocol-message"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ftpProtocols.map((protocol) => (
                  <SelectItem key={protocol} value={protocol}>
                    {ftpProtocolLabels[protocol]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="build-env"
            label="Variáveis de build"
            className="sm:col-span-2"
            error={errors.buildEnv}
            hint="Uma por linha, no formato CHAVE=valor. Gravadas como secret e nunca guardadas no navegador — em branco, as já gravadas no repositório continuam valendo."
          >
            <Textarea
              id="build-env"
              rows={4}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={
                "VITE_SUPABASE_URL=https://xxx.supabase.co\nVITE_SUPABASE_ANON_KEY=..."
              }
              value={settings.buildEnv}
              aria-invalid={Boolean(errors.buildEnv)}
              aria-describedby="build-env-message"
              onChange={(event) =>
                onChange({
                  buildEnv: event.target.value,
                  // Digitar variáveis novas substitui as atuais; pedir
                  // para remover ao mesmo tempo não faria sentido.
                  ...(event.target.value.trim() ? { clearBuildEnv: false } : {}),
                })
              }
            />
            {!settings.buildEnv.trim() && (
              <Label
                htmlFor="clear-build-env"
                className="mt-2 flex items-center gap-2 text-xs font-normal text-muted-foreground"
              >
                <Checkbox
                  id="clear-build-env"
                  checked={settings.clearBuildEnv}
                  onCheckedChange={(checked) =>
                    onChange({ clearBuildEnv: checked === true })
                  }
                />
                Remover as variáveis de build gravadas no repositório
              </Label>
            )}
          </Field>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
