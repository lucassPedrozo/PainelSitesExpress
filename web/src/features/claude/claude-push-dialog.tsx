import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleAlert, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { ClaudePushPlan, Project } from "@/lib/api";
import { fetchClaudePushPlan, pushClaudeSite } from "@/lib/api";
import { formatBytes, formatDateTime, pluralize, projectIdentity } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { ErrorNotice } from "@/components/page-header";
import { claudeBlock, errorMessage } from "./claude-text";
import { useClaudeRefresh } from "./use-claude";
import { REPO_NAME_PATTERN } from "@shared/lovable-repo.js";

/**
 * O site que o Claude gerou, a caminho do GitHub.
 *
 * Vai o código-fonte: a configuração do build é a do template do motor, e do
 * projeto saem só o código, os arquivos públicos e o conteúdo. Antes do clique
 * a tela já diz para onde vai e o que impede — pacote que o template não tem,
 * credencial dentro do site. No envio o site é validado de novo.
 */
export function ClaudePushDialog({
  project,
  onOpenChange,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {project && <PushForm key={project.id} project={project} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PushForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const plano = useQuery({
    queryKey: queryKeys.claudePushPlan(project.id),
    queryFn: () => fetchClaudePushPlan(project.id),
    // Sempre relido: o site pode ter mudado desde a última vez.
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar ao GitHub — {projectIdentity(project).label}</DialogTitle>
        <DialogDescription>
          O código do site vai para um repositório da organização. A área de aprovação constrói a partir
          dele e publica o link do cliente.
        </DialogDescription>
      </DialogHeader>

      {plano.isPending ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : plano.error || !plano.data ? (
        <ErrorNotice
          title="Não foi possível preparar o envio"
          error={plano.error}
          onRetry={() => void plano.refetch()}
          className="rounded-lg border"
        />
      ) : (
        <PushBody project={project} plan={plano.data} onDone={onDone} />
      )}
    </>
  );
}

function PushBody({ project, plan, onDone }: { project: Project; plan: ClaudePushPlan; onDone: () => void }) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const [repoName, setRepoName] = useState(plan.suggestedRepoName);
  const [privado, setPrivado] = useState(true);
  const [sending, setSending] = useState(false);

  const novo = !plan.repoFullName;
  const nomeValido = !novo || (REPO_NAME_PATTERN.test(repoName.trim()) && !repoName.trim().endsWith(".git"));

  const motivo = !can("publicar")
    ? claudeBlock.semPublicar
    : !plan.configured
      ? "O token e a organização do GitHub ainda não estão nas Configurações."
      : plan.problems.length > 0
        ? "Há algo no site que impede o envio."
        : !nomeValido
          ? "Nome de repositório inválido."
          : null;

  const enviar = async () => {
    setSending(true);
    try {
      const resultado = await pushClaudeSite(project.id, novo ? { repoName: repoName.trim(), private: privado } : {});
      await refresh();
      const titulo = resultado.repository.created
        ? `Repositório ${resultado.repository.fullName} criado`
        : resultado.commit.changed
          ? `Site atualizado em ${resultado.repository.fullName}`
          : "O repositório já estava com esta versão";
      if (resultado.warning) toast.warning(titulo, { description: resultado.warning });
      else toast.success(titulo, { description: "A área de aprovação publica em seguida; o card mostra o andamento." });
      onDone();
    } catch (err) {
      toast.error("O site não foi enviado", { description: errorMessage(err) });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {!plan.configured && (
          <Alert variant="warning">
            <CircleAlert />
            <AlertTitle>O GitHub ainda não foi configurado</AlertTitle>
            <AlertDescription>
              Preencha o token e a organização em Configurações → GitHub e publicação.
            </AlertDescription>
          </Alert>
        )}

        {plan.problems.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>O site não pode ir como está</AlertTitle>
            <AlertDescription>
              <ul className="space-y-1">
                {plan.problems.map((problema) => (
                  <li key={problema}>{problema}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {novo ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="claude-repo">Repositório novo</Label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm text-muted-foreground">{plan.organization ?? "organização"} /</span>
                <Input
                  id="claude-repo"
                  value={repoName}
                  aria-invalid={!nomeValido}
                  onChange={(event) => setRepoName(event.target.value)}
                  spellCheck={false}
                />
              </div>
              <p className="text-xs text-muted-foreground">Letras, números, hífen, ponto e sublinhado.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={privado} onCheckedChange={setPrivado} />
              Repositório privado
            </label>
          </div>
        ) : (
          <p className="text-sm">
            Atualiza <span className="font-medium">{plan.repoFullName}</span> com a versão validada
            {plan.validatedAt && ` em ${formatDateTime(plan.validatedAt)}`}.
            {plan.pushedAt && (
              <span className="text-muted-foreground"> Último envio: {formatDateTime(plan.pushedAt)}.</span>
            )}
          </p>
        )}

        <dl className="grid grid-lead gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
          <dt className="text-muted-foreground">Vai</dt>
          <dd>
            {pluralize(plan.files, "arquivo")}
            {plan.totalBytes > 0 && ` · ${formatBytes(plan.totalBytes)}`} — o código, os arquivos públicos e o
            conteúdo do site, com a configuração do template.
          </dd>
          <dt className="text-muted-foreground">Não vai</dt>
          <dd>O briefing, a direção criativa, o histórico das etapas e o build local.</dd>
          <dt className="text-muted-foreground">Depois</dt>
          <dd>
            {plan.approvalArea
              ? "A área de aprovação constrói o site e publica o link do cliente."
              : "A área de aprovação não está configurada: o site fica no GitHub, ainda sem link para o cliente."}
          </dd>
        </dl>

        {plan.outdated.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {pluralize(plan.outdated.length, "arquivo de configuração", "arquivos de configuração")} do projeto{" "}
            {plan.outdated.length === 1 ? "é" : "são"} de uma versão anterior do template (
            {plan.outdated.join(", ")}); vão os atuais.
          </p>
        )}
      </div>

      <DialogFooter>
        {motivo && <Reason className="sm:mr-auto">{motivo}</Reason>}
        <Button variant="outline" onClick={onDone} disabled={sending}>
          Cancelar
        </Button>
        <DisabledHint reason={motivo}>
          <Button disabled={Boolean(motivo) || sending} onClick={() => void enviar()}>
            {sending ? <Loader2 className="animate-spin" /> : <Upload />}
            {sending ? "Validando e enviando…" : novo ? "Criar repositório e enviar" : "Enviar ao GitHub"}
          </Button>
        </DisabledHint>
      </DialogFooter>
    </>
  );
}
