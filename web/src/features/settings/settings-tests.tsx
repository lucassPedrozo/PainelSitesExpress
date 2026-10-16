import { useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { checkGeminiKey, checkGithubAccess, type GeminiKeyCheck } from "@/lib/api/settings";
import type { AccessCheckResult } from "@/lib/api/deploy";
import { pluralize } from "@/lib/format";
import { useMinute } from "@/lib/use-now";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import { tokenValidity, type Drafts } from "./settings-form";

/**
 * Os testes sem efeito colateral de cada seção: GitHub (só lê) e chave do
 * Gemini (lista os modelos — não gera nada e não custa nada). Cada um usa o
 * valor digitado na seção ou, vazio, o gravado.
 */

const valorDe = (drafts: Drafts, key: string) => {
  const draft = drafts[key];
  if (!draft) return undefined;
  if (draft.kind === "secret") return draft.replacement.trim() || undefined;
  return draft.value.trim() || undefined;
};

/**
 * O que testa, o botão, e o resultado embaixo. Com `blockedBy` o botão fica
 * desligado e o motivo toma o lugar da dica — escrito na tela, não só no hover.
 */
export function TestFooter({
  label,
  hint,
  testing,
  blockedBy,
  onTest,
  children,
}: {
  label: string;
  hint: string;
  testing: boolean;
  blockedBy?: string | null;
  onTest: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t bg-muted/30 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DisabledHint reason={blockedBy}>
          <Button variant="outline" size="sm" onClick={onTest} disabled={testing || Boolean(blockedBy)}>
            {testing ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {label}
          </Button>
        </DisabledHint>
        {blockedBy ? <Reason>{blockedBy}</Reason> : <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export const Linha = ({ ok, children }: { ok: boolean | "warn"; children: ReactNode }) => (
  <li className="flex items-start gap-1.5">
    {ok === true ? (
      <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" />
    ) : ok === "warn" ? (
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
    ) : (
      <XCircle className="mt-px size-3.5 shrink-0 text-destructive" />
    )}
    <span>{children}</span>
  </li>
);

/**
 * A validade do token que o GitHub informa. Um fine-grained vence; sem esta
 * linha, a publicação parava de um dia para o outro sem aviso.
 */
function TokenValidity({ expiresAt }: { expiresAt: string | null }) {
  const now = useMinute();
  const { ok, text } = tokenValidity(expiresAt, now);
  return <Linha ok={ok}>{text}</Linha>;
}

export function GithubTest({ drafts }: { drafts: Drafts }) {
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<AccessCheckResult | null>(null);

  const testar = async () => {
    setTestando(true);
    try {
      setResultado(
        await checkGithubAccess({ token: valorDe(drafts, "GITHUB_TOKEN"), organization: valorDe(drafts, "GITHUB_ORG") }),
      );
    } catch (erro) {
      toast.error("Falha ao testar", { description: erro instanceof Error ? erro.message : undefined });
    } finally {
      setTestando(false);
    }
  };

  return (
    <TestFooter
      label="Testar o acesso ao GitHub"
      hint="Usa o token digitado acima ou, vazio, o gravado. Só lê."
      testing={testando}
      onTest={() => void testar()}
    >
      {resultado && (
        <ul className="space-y-1 text-xs">
          {resultado.identity && (
            <>
              <li className="text-muted-foreground">Conta: {resultado.identity.login}</li>
              <TokenValidity expiresAt={resultado.identity.tokenExpiresAt} />
            </>
          )}
          {resultado.checks.map((check) => (
            <Linha key={check.id} ok={check.ok}>
              <b className="font-medium">{check.label}:</b> {check.detail}
            </Linha>
          ))}
        </ul>
      )}
    </TestFooter>
  );
}

export function GeminiTest({ drafts }: { drafts: Drafts }) {
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<GeminiKeyCheck | null>(null);

  const testar = async () => {
    setTestando(true);
    try {
      setResultado(
        await checkGeminiKey({ apiKey: valorDe(drafts, "GEMINI_API_KEY"), model: valorDe(drafts, "GEMINI_MODEL") }),
      );
    } catch (erro) {
      toast.error("Falha ao testar", { description: erro instanceof Error ? erro.message : undefined });
    } finally {
      setTestando(false);
    }
  };

  return (
    <TestFooter
      label="Testar a chave"
      hint="Lista os modelos que a chave alcança — não gera nada e não gasta a cota."
      testing={testando}
      onTest={() => void testar()}
    >
      {resultado && (
        <ul className="space-y-1 text-xs">
          {resultado.ok ? (
            <>
              <Linha ok={resultado.available.length > 0 ? true : "warn"}>
                Chave válida · {pluralize(resultado.models.length, "modelo")} ·{" "}
                {resultado.available.length > 0
                  ? `o painel vai usar ${resultado.available.join(" e, se faltar cota, ")}.`
                  : "nenhum dos modelos padrão aparece para esta chave; o painel vai procurar outro Flash no catálogo."}
              </Linha>
              {resultado.preferredModel && resultado.preferredAvailable === false && (
                <Linha ok="warn">
                  O modelo preferido {resultado.preferredModel} não aparece para esta chave — o painel
                  passa para os apelidos.
                </Linha>
              )}
              {/* O catálogo inteiro só interessa a quem vai escolher o modelo
                  preferido: fica recolhido. */}
              {resultado.flash.length > 0 && (
                <li>
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer select-none hover:text-foreground">
                      {pluralize(resultado.flash.length, "modelo Flash", "modelos Flash")} de texto no catálogo
                    </summary>
                    <p className="mt-1 break-words">{resultado.flash.join(", ")}.</p>
                  </details>
                </li>
              )}
            </>
          ) : (
            <Linha ok={false}>{resultado.reason}</Linha>
          )}
        </ul>
      )}
    </TestFooter>
  );
}
