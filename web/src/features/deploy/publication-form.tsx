import { useState, type ReactNode } from "react";
import { Eye, EyeOff, Loader2, Save, Sparkles } from "lucide-react";
import type { PublicationSettings } from "@/lib/api/deploy";
import { usePermissions } from "@/lib/permissions";
import { noPermission } from "@/features/projects/project-actions";
import { AdvancedOptions } from "./advanced-options";
import type { ValidationErrors } from "./deploy-types";
import { Reason } from "@/components/disabled-hint";
import { Field } from "@/components/field";
import { SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StepBadge } from "./step-badge";
import { Switch } from "@/components/ui/switch";

type PublicationFieldsProps = {
  settings: PublicationSettings;
  errors: ValidationErrors;
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
};

/**
 * Divide o formulário em blocos com significado, em vez de oito campos
 * seguidos. Título pequeno, sem caixa alta: o mesmo peso de um subtítulo em
 * qualquer cartão do painel.
 */
function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold text-muted-foreground">{children}</h3>;
}

/**
 * Os campos da publicação, sem moldura: o cartão da tela de Deploy e o
 * diálogo de publicar põem cada um a sua volta — e o botão de salvar no
 * lugar certo de cada molde (rodapé do cartão, rodapé do diálogo).
 */
export function PublicationFields({
  settings,
  errors,
  suggestedDomain,
  advancedOpen,
  onAdvancedOpenChange,
  onChange,
}: PublicationFieldsProps) {
  const [showPassword, setShowPassword] = useState(false);

  const canApplySuggestion =
    Boolean(suggestedDomain) && settings.domain.trim() !== suggestedDomain;

  return (
    <div className="space-y-5">
      <GroupTitle>Destino</GroupTitle>

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

      <GroupTitle>Acesso ao servidor</GroupTitle>

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
          {/* O olho mora no próprio campo (InputGroup), em vez de um botão
              posicionado à mão por cima do input. `bg-card shadow-xs` deixa o
              grupo igual aos inputs vizinhos. */}
          <InputGroup className="bg-card shadow-xs">
            <InputGroupInput
              id="ftp-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              // Bolinhas como placeholder fazem o campo parecer preenchido.
              placeholder="Senha do usuário FTP"
              value={settings.ftpPassword}
              aria-invalid={Boolean(errors.ftpPassword)}
              aria-describedby="ftp-password-message"
              onChange={(event) => onChange({ ftpPassword: event.target.value })}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                title={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </div>

      <Separator />

      <GroupTitle>Entrega</GroupTitle>

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
    </div>
  );
}

type PublicationFormProps = PublicationFieldsProps & {
  isSaving: boolean;
  disabled: boolean;
  /**
   * O número do passo, só quando o cartão de publicar está ao lado como passo
   * 2 — sem ele, um "1" sozinho não guia nada.
   */
  step?: number;
  /** Ao alterar uma configuração já gravada, dá para voltar sem salvar. */
  onCancel?: () => void;
};

/** O formulário no cartão da tela de Deploy, com o salvar no rodapé. */
export function PublicationForm({
  isSaving,
  disabled,
  step,
  onCancel,
  ...fields
}: PublicationFormProps) {
  // O servidor recusa gravar sem a permissão de publicar; a tela diz antes.
  const podePublicar = usePermissions().can("publicar");

  return (
    <SectionCard
      icon={step ? <StepBadge>{step}</StepBadge> : undefined}
      title="Configurar publicação"
      description="Destino e acesso FTP gravados como secrets no repositório do site. A senha não fica no navegador."
    >
      <div className="space-y-5">
        <PublicationFields {...fields} />

        {/* A ação fica no rodapé do card que ela valida. Antes o botão morava
            no card ao lado, e o operador preenchia à esquerda procurando o
            "salvar" à direita. */}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="submit" disabled={disabled || isSaving || !podePublicar}>
            {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
            {isSaving ? "Gravando..." : "Salvar configuração"}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" disabled={isSaving} onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Grava os secrets e os workflows no repositório.
          </p>
          {!podePublicar && <Reason className="basis-full">{noPermission.publicar}</Reason>}
        </div>
      </div>
    </SectionCard>
  );
}
