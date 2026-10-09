import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  fetchClaudeDiagnostics,
  testClaudeLogin,
  type ClaudeDiagnostics,
  type ClaudeLoginTest,
} from "@/lib/api/settings";
import { queryKeys } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmClaudeDialog } from "@/features/claude/claude-shared";
import { errorMessage, formatEstimate } from "@/features/claude/claude-text";
import { FIELD_GRID } from "./settings-form";
import { Linha, TestFooter } from "./settings-tests";

/**
 * A seção do motor Claude: o que o painel encontrou nesta máquina e o teste do
 * login.
 *
 * O estado sai de conferências que não gastam nada (`claude --version` e o
 * próprio motor). "Testar Claude" é o contrário: dispara o Claude Code de
 * verdade. Por isso ele nunca roda sozinho — só no clique, depois de uma
 * confirmação que diz o que custa, e com a trava ligada.
 */

const useClaudeDiagnostics = () =>
  useQuery({ queryKey: queryKeys.claudeDiagnostics, queryFn: fetchClaudeDiagnostics, staleTime: 60_000 });

/** O estado do motor nesta máquina, como a primeira linha da seção. */
export function ClaudeStateRow() {
  const query = useClaudeDiagnostics();

  return (
    <div className={FIELD_GRID}>
      <div className="space-y-2 md:pt-0.5">
        <div>
          <p className="text-sm font-medium">Estado nesta máquina</p>
          <p className="text-2xs text-muted-foreground">Conferido sem disparar o Claude Code</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Conferir de novo
        </Button>
      </div>

      <div className="min-w-0">
        {query.isPending ? (
          <Skeleton className="h-24 max-w-md rounded-md" />
        ) : query.error || !query.data ? (
          <ul className="space-y-1 text-xs">
            <Linha ok={false}>{errorMessage(query.error, "Não foi possível conferir o motor.")}</Linha>
          </ul>
        ) : (
          <ClaudeState state={query.data} />
        )}
      </div>
    </div>
  );
}

function ClaudeState({ state }: { state: ClaudeDiagnostics }) {
  const { claude, browser, model, humanApproval } = state;

  if (!state.installed || !claude || !browser || !model || !humanApproval) {
    return (
      <ul className="space-y-1 text-xs">
        <Linha ok={false}>{state.reason ?? "O motor não respondeu à conferência."}</Linha>
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1 text-xs">
        <Linha ok>Pacote do motor instalado.</Linha>

        {claude.found ? (
          <Linha ok>
            Claude Code {claude.version}, {claude.custom ? "pelo caminho informado abaixo" : "achado no PATH"}.
          </Linha>
        ) : (
          <Linha ok={false}>
            {claude.custom
              ? "O programa informado em “Programa do Claude Code” não respondeu. Confira o caminho."
              : "O painel não achou o claude no PATH. Instale o Claude Code e faça login nele, ou informe o caminho em “Programa do Claude Code”."}
          </Linha>
        )}

        {browser.found ? (
          <Linha ok>Navegador das capturas: {browser.name}.</Linha>
        ) : (
          <Linha ok="warn">
            {browser.custom
              ? "O navegador informado não está nesse caminho."
              : "Nenhum Chrome, Edge ou Chromium no lugar de costume."}{" "}
            Sem navegador o site é revisado só pelo código, e não há telas nem filme.
          </Linha>
        )}

        {model.effective === model.expected ? (
          <Linha ok>Modelo: {model.effective}, o que o motor espera.</Linha>
        ) : (
          <Linha ok="warn">
            Modelo: {model.effective}. O motor espera {model.expected}: outro modelo muda o resultado e o consumo
            da assinatura.
          </Linha>
        )}

        <Linha ok>
          Direção criativa:{" "}
          {humanApproval.enabled
            ? "a geração para e espera a aprovação de uma pessoa"
            : "a geração segue sem parar"}
          {humanApproval.custom ? "." : " (padrão do motor)."}
        </Linha>
      </ul>

      {state.command && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Comando de uma geração</summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-2xs leading-relaxed break-all whitespace-pre-wrap">
            {state.command}
          </pre>
        </details>
      )}
    </div>
  );
}

/** "Testar Claude", no rodapé da seção. `unsaved`: há mudança na seção ainda não gravada. */
export function ClaudeTest({ unsaved }: { unsaved: boolean }) {
  const estado = useClaudeDiagnostics().data;
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ClaudeLoginTest | null>(null);

  const teste = useMutation({
    mutationFn: testClaudeLogin,
    onSuccess: setResultado,
    onError: (erro) => {
      setResultado(null);
      toast.error("O teste não rodou", { description: errorMessage(erro) });
    },
  });

  // O teste usa o que está gravado: a trava ligada só na tela não vale.
  const bloqueio = !estado
    ? "Aguardando a conferência do motor."
    : !estado.installed
      ? (estado.reason ?? "O motor não está instalado.")
      : unsaved
        ? "Salve a seção antes de testar: o teste usa o que está gravado."
        : !estado.generation.enabled
          ? "Ligue “Liberar o uso do Claude” e salve a seção: com a trava desligada o painel não dispara o Claude Code."
          : null;

  const estimativa = formatEstimate(resultado?.estimatedCostUsd);

  return (
    <>
      <TestFooter
        label="Testar Claude"
        hint="Faz uma pergunta mínima ao Claude Code de verdade, pelo login da assinatura. Consome um pouco dela."
        testing={teste.isPending}
        blockedBy={bloqueio}
        onTest={() => setConfirmando(true)}
      >
        {teste.isPending && (
          <p className="text-xs text-muted-foreground">Esperando a resposta do Claude Code. Pode levar até dois minutos.</p>
        )}
        {resultado && !teste.isPending && (
          <ul className="space-y-1 text-xs">
            <Linha ok={resultado.ok}>{resultado.message}</Linha>
            {(resultado.model ?? estimativa) && (
              <li className="text-muted-foreground">
                {[resultado.model && `Modelo: ${resultado.model}`, estimativa].filter(Boolean).join(" · ")}
              </li>
            )}
          </ul>
        )}
      </TestFooter>

      <ConfirmClaudeDialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Testar o Claude Code agora?"
        confirmLabel="Testar e usar a assinatura"
        onConfirm={() => teste.mutate()}
      >
        O painel faz uma pergunta mínima para conferir se o login da assinatura responde.
      </ConfirmClaudeDialog>
    </>
  );
}
