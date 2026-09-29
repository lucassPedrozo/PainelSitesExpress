import { useState } from "react";
import { Eye, EyeOff, Loader2, Save, Sparkles } from "lucide-react";
import type { PublicationSettings } from "@/lib/api/deploy";
import { AdvancedOptions } from "./advanced-options";
import type { ValidationErrors } from "./deploy-types";
import { Field } from "./field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StepBadge } from "./step-badge";
import { Switch } from "@/components/ui/switch";

type PublicationFormProps = {
  settings: PublicationSettings;
  errors: ValidationErrors;
  isSaving: boolean;
  disabled: boolean;
  /** Domínio herdado da coleta do Drive, quando a publicação veio de um projeto. */
  suggestedDomain?: string;
  /**
   * Controlado de fora porque a validação precisa abrir a seção quando o campo
   * recusado mora nela — um erro escondido atrás de um acordeão não é erro, é
   * um formulário que "não salva sem dizer por quê".
   */
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<PublicationSettings>) => void;
  /**
   * Dentro do diálogo de publicação do projeto, salvar já publica: o botão
   * diz isso, e o número do passo sai, porque não há passo 2 ao lado.
   */
  submitLabel?: string;
  showStep?: boolean;
};

/** Divide o formulário em blocos com significado, em vez de oito campos seguidos. */
function GroupLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export function PublicationForm({
  settings,
  errors,
  isSaving,
  disabled,
  suggestedDomain,
  advancedOpen,
  onAdvancedOpenChange,
  onChange,
  submitLabel = "Salvar configuração",
  showStep = true,
}: PublicationFormProps) {
  const [showPassword, setShowPassword] = useState(false);

  const canApplySuggestion =
    Boolean(suggestedDomain) && settings.domain.trim() !== suggestedDomain;

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          {showStep && <StepBadge>1</StepBadge>}
          <CardTitle>Configurar publicação</CardTitle>
        </div>
        <CardDescription>
          Os dados vão para a API local e viram GitHub Actions secrets. A senha
          não é salva no navegador.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <GroupLabel>Destino</GroupLabel>

        {/* `gap-y` é obrigatório: sem ele a mensagem de uma linha encosta no
            rótulo da linha seguinte e as duas se leem como um bloco só. */}
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field
            id="domain"
            label="Domínio"
            error={errors.domain}
            hint={
              canApplySuggestion ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                  onClick={() => onChange({ domain: suggestedDomain! })}
                >
                  <Sparkles className="size-3" />
                  Usar {suggestedDomain}, da coleta no Drive
                </button>
              ) : (
                "Sem https:// ou caminhos adicionais."
              )
            }
          >
            <Input
              id="domain"
              inputMode="url"
              autoComplete="off"
              placeholder="meusite.com.br"
              value={settings.domain}
              aria-invalid={Boolean(errors.domain)}
              aria-describedby="domain-message"
              onChange={(event) => onChange({ domain: event.target.value })}
            />
          </Field>

          <Field
            id="ftp-server"
            label="Servidor FTP"
            error={errors.ftpServer}
            hint="Host da hospedagem, sem ftp:// nem barra."
          >
            <Input
              id="ftp-server"
              autoComplete="off"
              placeholder="ftp.hospedagem.com.br"
              value={settings.ftpServer}
              aria-invalid={Boolean(errors.ftpServer)}
              aria-describedby="ftp-server-message"
              onChange={(event) => onChange({ ftpServer: event.target.value })}
            />
          </Field>
        </div>

        <GroupLabel>Acesso ao servidor</GroupLabel>

        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field
            id="ftp-login"
            label="Login FTP"
            error={errors.ftpLogin}
            hint="Usuário fornecido pelo servidor de hospedagem."
          >
            <Input
              id="ftp-login"
              autoComplete="username"
              placeholder="usuario@exemplo"
              value={settings.ftpLogin}
              aria-invalid={Boolean(errors.ftpLogin)}
              aria-describedby="ftp-login-message"
              onChange={(event) => onChange({ ftpLogin: event.target.value })}
            />
          </Field>

          <Field
            id="ftp-password"
            label="Senha FTP"
            error={errors.ftpPassword}
            hint="Fica só na memória desta aba, nunca no armazenamento."
          >
            <div className="relative">
              <Input
                id="ftp-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                // Bolinhas como placeholder fazem o campo parecer preenchido.
                placeholder="Senha do usuário FTP"
                className="pr-9"
                value={settings.ftpPassword}
                aria-invalid={Boolean(errors.ftpPassword)}
                aria-describedby="ftp-password-message"
                onChange={(event) =>
                  onChange({ ftpPassword: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </Field>
        </div>

        <Separator />

        <GroupLabel>Entrega</GroupLabel>

        <Label
          htmlFor="auto-deploy"
          className="flex items-start gap-3 rounded-lg border p-3"
        >
          <Switch
            id="auto-deploy"
            checked={settings.autoDeploy}
            onCheckedChange={(checked) => onChange({ autoDeploy: checked })}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">
              Publicar automaticamente a cada push
            </span>
            <span className="block text-xs font-normal text-muted-foreground">
              Adiciona o gatilho de push na branch padrão ao workflow de deploy.
            </span>
          </span>
        </Label>

        <AdvancedOptions
          settings={settings}
          errors={errors}
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
          onChange={onChange}
        />
      </CardContent>

      {/* A ação fica no rodapé do card que ela valida. Antes o botão morava no
          card ao lado, e o operador preenchia à esquerda procurando o "salvar"
          à direita. */}
      <CardFooter className="gap-3">
        <Button type="submit" size="lg" disabled={disabled || isSaving}>
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {isSaving ? "Gravando..." : submitLabel}
        </Button>
        <p className="text-xs text-muted-foreground">
          Grava os secrets e os workflows no repositório.
        </p>
      </CardFooter>
    </Card>
  );
}
