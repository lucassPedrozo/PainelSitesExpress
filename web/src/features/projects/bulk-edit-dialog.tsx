import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { ManualEtapa, Project, ProjectDetailsPatch } from "@/lib/api";
import { pluralize } from "@/lib/format";
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
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ETAPAS } from "./stage";
import { MANUAL_STAGES, MAX_RESPONSIBLE } from "@shared/project-fields.js";

/** O campo fica como está em cada projeto. */
const MANTER = "manter";

type ResponsavelAcao = typeof MANTER | "definir" | "tirar";

/**
 * Editar vários projetos de uma vez: o responsável e a etapa. Cada campo
 * começa em "Não mudar" — só o que for escolhido vai a todos os marcados, e
 * o resto de cada projeto fica como está.
 */
export function BulkEditDialog({
  projects,
  responsibles,
  onOpenChange,
  onSubmit,
}: {
  /** Os marcados; `null` com o diálogo fechado. */
  projects: Project[] | null;
  responsibles: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (projects: Project[], patch: ProjectDetailsPatch) => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(projects)} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="sm:max-w-lg">
        {projects && (
          <BulkForm projects={projects} responsibles={responsibles} onOpenChange={onOpenChange} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkForm({
  projects,
  responsibles,
  onOpenChange,
  onSubmit,
}: {
  projects: Project[];
  responsibles: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (projects: Project[], patch: ProjectDetailsPatch) => Promise<void>;
}) {
  const [acao, setAcao] = useState<ResponsavelAcao>("definir");
  const [nome, setNome] = useState("");
  const [etapa, setEtapa] = useState<string>(MANTER);
  const [saving, setSaving] = useState(false);

  // O que os marcados têm hoje: ajuda a decidir sem abrir um por um.
  const atuais = [...new Set(projects.map((project) => project.details?.responsible ?? "sem responsável"))];

  const patch: ProjectDetailsPatch = {};
  if (acao === "definir" && nome.trim()) patch.responsible = nome.trim();
  if (acao === "tirar") patch.responsible = null;
  if (etapa !== MANTER) patch.stage = etapa === "auto" ? null : (etapa as ManualEtapa);
  const mudou = Object.keys(patch).length > 0;

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    if (!mudou) return;
    setSaving(true);
    try {
      await onSubmit(projects, patch);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void salvar(event)} className="contents">
      <DialogHeader>
        <DialogTitle>Editar {pluralize(projects.length, "projeto")}</DialogTitle>
        <DialogDescription>
          Só o que você escolher muda, igual em todos os marcados. O resto de cada projeto fica como está.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <Field
          id="massa-responsavel"
          label="Responsável"
          hint={`Hoje: ${atuais.slice(0, 4).join(", ")}${atuais.length > 4 ? ` e mais ${atuais.length - 4}` : ""}.`}
        >
          <div className="flex flex-wrap gap-2">
            <Select value={acao} onValueChange={(valor) => setAcao(valor as ResponsavelAcao)}>
              <SelectTrigger className="w-40" aria-label="O que fazer com o responsável">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MANTER}>Não mudar</SelectItem>
                <SelectItem value="definir">Definir como</SelectItem>
                <SelectItem value="tirar">Tirar o responsável</SelectItem>
              </SelectContent>
            </Select>
            {acao === "definir" && (
              <Input
                id="massa-responsavel"
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                list="massa-responsaveis"
                maxLength={MAX_RESPONSIBLE}
                placeholder="Nome de quem cuida"
                className="min-w-0 flex-1 basis-40"
                aria-describedby="massa-responsavel-message"
                autoComplete="off"
              />
            )}
            <datalist id="massa-responsaveis">
              {responsibles.map((responsavel) => (
                <option key={responsavel} value={responsavel} />
              ))}
            </datalist>
          </div>
        </Field>

        <Field
          id="massa-etapa"
          label="Etapa"
          hint="A escolhida vale até o próximo passo registrado em cada projeto; “Automática” devolve ao cálculo do painel."
        >
          <Select value={etapa} onValueChange={setEtapa}>
            <SelectTrigger id="massa-etapa" className="w-full sm:w-64" aria-describedby="massa-etapa-message">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MANTER}>Não mudar</SelectItem>
              <SelectItem value="auto">Automática (calculada)</SelectItem>
              <SelectSeparator />
              {MANUAL_STAGES.map((item) => (
                <SelectItem key={item} value={item}>
                  {ETAPAS[item].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!mudou || saving}>
          {saving && <Loader2 className="animate-spin" />}
          Aplicar em {pluralize(projects.length, "projeto")}
        </Button>
      </DialogFooter>
    </form>
  );
}
