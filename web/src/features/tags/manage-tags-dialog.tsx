import { useState } from "react";
import { Check, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import type { Tag, TagColor } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import { tagColorLabels, tagDotClass } from "@/features/tags/tag-colors";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PALETTE: TagColor[] = [
  "slate",
  "blue",
  "cyan",
  "emerald",
  "amber",
  "orange",
  "red",
  "violet",
  "pink",
];

export function ManageTagsDialog({
  controller,
  onTagRemoved,
}: {
  controller: TagsController;
  /** Permite ao painel limpar a tag excluída dos projetos já carregados. */
  onTagRemoved: (tagId: string) => void;
}) {
  const { can } = usePermissions();
  const podeOrganizar = can("organizar");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true);
    setError(null);
    try {
      await controller.create(label, color);
      setName("");
      setColor(PALETTE[(PALETTE.indexOf(color) + 1) % PALETTE.length]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* O diálogo inteiro cria, renomeia e exclui tags: sem `organizar`
            não há nada aqui dentro que a chave possa fazer. */}
        <Button
          variant="ghost"
          size="sm"
          disabled={!podeOrganizar}
          title={
            podeOrganizar
              ? undefined
              : "Esta chave de acesso não tem permissão para organizar projetos"
          }
        >
          <Settings2 className="size-4" />
          Gerenciar tags
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar tags</DialogTitle>
          <DialogDescription>
            As tags são do painel e servem para as exceções — a etapa de cada
            projeto o selo já mostra. Nada no Google Drive é alterado.
            <strong> Finalizado</strong> tira o projeto da lista.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <ColorPicker value={color} onChange={setColor} />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void create()}
            placeholder="Nome da nova tag"
          />
          <Button onClick={() => void create()} disabled={!name.trim() || busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Criar
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-[45vh] space-y-1 overflow-y-auto">
          {controller.tags.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma tag criada ainda.
            </p>
          ) : (
            controller.tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                controller={controller}
                onRemoved={onTagRemoved}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TagRow({
  tag,
  controller,
  onRemoved,
}: {
  tag: Tag;
  controller: TagsController;
  onRemoved: (tagId: string) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    const label = name.trim();
    if (!label || label === tag.name) {
      setName(tag.name);
      return;
    }
    try {
      await controller.update(tag.id, { name: label });
    } catch (err) {
      setName(tag.name);
      toast.error(
        err instanceof Error ? err.message : "Não foi possível renomear a tag",
      );
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await controller.remove(tag.id);
      onRemoved(tag.id);
      toast.success(`Tag “${tag.name}” excluída`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Não foi possível excluir a tag",
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border p-1.5 pl-2">
      <ColorPicker
        value={tag.color}
        onChange={(color) => {
          controller.update(tag.id, { color }).catch(() => {
            toast.error("Não foi possível mudar a cor da tag");
          });
        }}
      />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(tag.name);
        }}
        className="border-transparent bg-transparent px-2 shadow-none hover:border-input focus-visible:border-input focus-visible:bg-card"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {tag.projectCount} {tag.projectCount === 1 ? "projeto" : "projetos"}
      </span>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Excluir"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
          title="Excluir tag"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          title={`Cor: ${tagColorLabels[value]}`}
        >
          <span className={cn("size-3.5 rounded-full", tagDotClass[value])} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              title={tagColorLabels[color]}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              className="grid size-7 place-items-center rounded-md transition hover:bg-muted"
            >
              <span
                className={cn(
                  "grid size-4 place-items-center rounded-full",
                  tagDotClass[color],
                )}
              >
                {color === value && <Check className="size-3 text-white" />}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
