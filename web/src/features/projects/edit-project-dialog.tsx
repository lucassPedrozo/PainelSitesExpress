import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { ManualEtapa, Project, ProjectDetailsPatch } from "@/lib/api";
import { formatDate, projectIdentity } from "@/lib/format";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { manualStageOf, projectStatus } from "./project-status";
import { ETAPAS, STAGES } from "./stage";
import { MANUAL_STAGES, MAX_NOTE, MAX_PROJECT_NAME, MAX_RESPONSIBLE } from "@shared/project-fields.js";

const AUTOMATICA = "auto";

/** "2026-09-29" para o campo de data; `""` sem data. */
const paraCampoDeData = (iso: string | null | undefined) => {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return "";
  const data = new Date(time);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
};

/** O dia do campo, ao meio-dia local: longe da meia-noite, o fuso não troca a data. */
const doCampoDeData = (valor: string) => {
  const [ano, mes, dia] = valor.split("-").map(Number);
  return new Date(ano, mes - 1, dia, 12).toISOString();
};

/**
 * Editar o projeto: o que o painel calcula (domínio, data de recebimento,
 * etapa) e o que é só da equipe (nome, responsável, observação). Cada campo
 * vazio volta ao cálculo. A pasta no Drive não é tocada — o acesso é só de
 * leitura.
 */
export function EditProjectDialog({
  project,
  responsibles,
  onOpenChange,
  onSubmit,
}: {
  project: Project | null;
  /** Os responsáveis já usados em outros projetos — sugestões do campo. */
  responsibles: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (project: Project, patch: ProjectDetailsPatch) => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="sm:max-w-xl">
        {/* A chave recomeça o formulário a cada projeto. */}
        {project && (
          <EditForm
            key={project.id}
            project={project}
            responsibles={responsibles}
            onOpenChange={onOpenChange}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  project,
  responsibles,
  onOpenChange,
  onSubmit,
}: {
  project: Project;
  responsibles: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (project: Project, patch: ProjectDetailsPatch) => Promise<void>;
}) {
  const detalhes = project.details ?? null;
  const manual = manualStageOf(project);
  // O que o painel calcularia sem as correções: o que fica quando o campo esvazia.
  const automatico = projectIdentity({ name: project.name, alias: project.alias, details: null });
  const etapaAutomatica = ETAPAS[STAGES[projectStatus({ ...project, details: { ...(detalhes ?? emptyDetails), stage: null } }).stage].etapa];

  const inicial = {
    domain: detalhes?.domain ?? "",
    name: project.alias ?? "",
    stage: manual?.etapa ?? AUTOMATICA,
    receivedAt: paraCampoDeData(detalhes?.receivedAt),
    responsible: detalhes?.responsible ?? "",
    note: detalhes?.note ?? "",
  };
  const [form, setForm] = useState(inicial);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudar = <K extends keyof typeof inicial>(campo: K, valor: (typeof inicial)[K]) =>
    setForm((atual) => ({ ...atual, [campo]: valor }));

  const patch: ProjectDetailsPatch = {};
  if (form.domain.trim() !== inicial.domain) patch.domain = form.domain.trim() || null;
  if (form.name.trim() !== inicial.name) patch.name = form.name.trim();
  if (form.stage !== inicial.stage) patch.stage = form.stage === AUTOMATICA ? null : (form.stage as ManualEtapa);
  if (form.receivedAt !== inicial.receivedAt) patch.receivedAt = form.receivedAt ? doCampoDeData(form.receivedAt) : null;
  if (form.responsible.trim() !== inicial.responsible) patch.responsible = form.responsible.trim() || null;
  if (form.note.trim() !== inicial.note) patch.note = form.note.trim() || null;
  const mudou = Object.keys(patch).length > 0;

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    if (!mudou) return;
    setSaving(true);
    setErro(null);
    try {
      await onSubmit(project, patch);
      onOpenChange(false);
    } catch (err) {
      setErro(err instanceof Error && err.message ? err.message : "Não foi possível salvar. Confira se o painel está no ar.");
    } finally {
      setSaving(false);
    }
  };

  // A escolha anterior que perdeu a validade: algo aconteceu depois dela.
  const vencida = detalhes?.stage && !manual ? ETAPAS[detalhes.stage.etapa].label : null;

  return (
    <form onSubmit={(event) => void salvar(event)} className="contents">
      <DialogHeader>
        <DialogTitle>Editar projeto</DialogTitle>
        <DialogDescription>
          O que o painel calcula e o que é só da equipe. Campo vazio volta ao cálculo; a pasta no Drive não muda.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            id="editar-dominio"
            label="Domínio"
            hint={
              automatico.domain
                ? `Vazio: ${automatico.domain}, do nome da pasta. A publicação é achada por ele.`
                : "A pasta não tem domínio no nome. A publicação é achada por ele."
            }
          >
            <Input
              id="editar-dominio"
              value={form.domain}
              onChange={(event) => mudar("domain", event.target.value)}
              placeholder={automatico.domain ?? "cliente.com.br"}
              aria-describedby="editar-dominio-message"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field id="editar-nome" label="Nome no painel" hint="Vazio: o nome da pasta no Drive.">
            <Input
              id="editar-nome"
              value={form.name}
              onChange={(event) => mudar("name", event.target.value)}
              placeholder={automatico.label}
              maxLength={MAX_PROJECT_NAME}
              aria-describedby="editar-nome-message"
            />
          </Field>
        </div>

        <Field
          id="editar-etapa"
          label="Etapa"
          hint={
            vencida
              ? `A etapa escolhida antes (${vencida}) perdeu a validade: algo aconteceu no projeto depois dela.`
              : "A escolhida vale até o próximo passo registrado — gerar, enviar ao cliente, publicar. Depois o painel volta a calcular."
          }
        >
          <Select value={form.stage} onValueChange={(valor) => mudar("stage", valor)}>
            <SelectTrigger id="editar-etapa" className="w-full sm:w-80" aria-describedby="editar-etapa-message">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTOMATICA}>Automática — hoje, {etapaAutomatica.label}</SelectItem>
              {MANUAL_STAGES.map((etapa) => (
                <SelectItem key={etapa} value={etapa}>
                  {ETAPAS[etapa].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field
            id="editar-recebido"
            label="Recebido em"
            hint={`Vazio: ${detalhes?.receivedAt ? "a data da pasta no Drive" : formatDate(automatico.collectedAt ?? project.createdTime)}. Muda a ordem e as faixas de data.`}
          >
            <Input
              id="editar-recebido"
              type="date"
              value={form.receivedAt}
              max={paraCampoDeData(new Date().toISOString())}
              onChange={(event) => mudar("receivedAt", event.target.value)}
              aria-describedby="editar-recebido-message"
            />
          </Field>
          <Field id="editar-responsavel" label="Responsável" hint="Quem cuida do projeto. Aparece no card e no Dashboard.">
            <Input
              id="editar-responsavel"
              value={form.responsible}
              onChange={(event) => mudar("responsible", event.target.value)}
              list="editar-responsaveis"
              maxLength={MAX_RESPONSIBLE}
              aria-describedby="editar-responsavel-message"
              autoComplete="off"
            />
            <datalist id="editar-responsaveis">
              {responsibles.map((nome) => (
                <option key={nome} value={nome} />
              ))}
            </datalist>
          </Field>
        </div>

        <Field
          id="editar-nota"
          label="Observação interna"
          hint={`Só a equipe vê. ${form.note.length.toLocaleString("pt-BR")} de ${MAX_NOTE.toLocaleString("pt-BR")} caracteres.`}
        >
          <Textarea
            id="editar-nota"
            rows={3}
            value={form.note}
            onChange={(event) => mudar("note", event.target.value)}
            maxLength={MAX_NOTE}
            placeholder="O que a equipe precisa lembrar: “cliente pediu para esperar a logo nova”."
            aria-describedby="editar-nota-message"
          />
        </Field>
      </DialogBody>

      <DialogFooter>
        {erro && (
          <p role="alert" className="text-xs text-destructive sm:mr-auto">
            {erro}
          </p>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!mudou || saving}>
          {saving && <Loader2 className="animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

const emptyDetails = { domain: null, receivedAt: null, responsible: null, note: null, stage: null };
