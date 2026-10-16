import { useState } from "react";
import { Loader2, Plus, Settings2, Tag as TagIcon, Trash2 } from "lucide-react";
import type { Tag, TagColor } from "@/lib/api";
import type { TagsController } from "@/features/tags/use-tags";
import { nextTagColor, TAG_PALETTE, tagColorLabels, tagDotClass } from "@/features/tags/tag-colors";
import { noPermission } from "@/features/projects/project-actions";
import { usePermissions } from "@/lib/permissions";
import { pluralize } from "@/lib/format";
import { DisabledHint, Reason } from "@/components/disabled-hint";
import { EmptyNotice, ErrorNotice } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ManageTagsDialog({
  controller,
  onTagRemoved,
  open: controlledOpen,
  onOpenChange,
  counts,
}: {
  controller: TagsController;
  /** Permite ao painel limpar a tag excluída dos projetos já carregados. */
  onTagRemoved: (tagId: string) => void;
  /** Aberto de fora (o menu da página): sem botão próprio. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Quantos projetos que existem têm cada tag — a conta do filtro. O número
   * do banco (`projectCount`) inclui projetos que já saíram do Drive e
   * divergia do filtro; sem o mapa, ele continua valendo. No mapa, uma tag
   * ausente conta zero.
   */
  counts?: Map<string, number>;
}) {
  const { can } = usePermissions();
  const podeOrganizar = can("organizar");
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = controlled ? (value: boolean) => onOpenChange?.(value) : setOwnOpen;
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
      setColor(nextTagColor(color));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* O diálogo inteiro cria, renomeia e exclui tags: sem `organizar` não
          há nada aqui dentro que a chave possa fazer. O botão desligado fica
          fora do gatilho — o clique no invólucro do motivo abriria o diálogo —,
          e o motivo vai escrito ao lado. */}
      {!controlled &&
        (podeOrganizar ? (
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <Settings2 />
              Gerenciar tags
            </Button>
          </DialogTrigger>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <DisabledHint reason={noPermission.organizar}>
              <Button variant="ghost" size="sm" disabled>
                <Settings2 />
                Gerenciar tags
              </Button>
            </DisabledHint>
            <Reason>{noPermission.organizar}</Reason>
          </span>
        ))}
      {/* Corpo rolável: a lista cresce com as tags, e o cabeçalho com o
          que elas são continua à vista. */}
      <DialogContent layout="sectioned" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar tags</DialogTitle>
          <DialogDescription>
            As tags são do painel e servem para as exceções — a etapa de cada
            projeto o selo já mostra. Nada no Google Drive é alterado.
            <strong> Finalizado</strong> tira o projeto da lista.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <ColorPicker value={color} onChange={setColor} />
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void create()}
                placeholder="Nome da nova tag"
                aria-label="Nome da nova tag"
              />
              <Button onClick={() => void create()} disabled={!name.trim() || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                Criar
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Carregando e falha têm cara própria: antes as duas apareciam
              como "Nenhuma tag criada", e quem lia achava que não havia. */}
          {controller.loading ? (
            <div className="space-y-1">
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-11 rounded-lg" />
            </div>
          ) : controller.error ? (
            <ErrorNotice
              title="Não foi possível carregar as tags"
              error={controller.error}
              onRetry={() => void controller.reload()}
            />
          ) : controller.tags.length === 0 ? (
            <EmptyNotice
              icon={<TagIcon />}
              title="Nenhuma tag criada ainda"
              description="Dê um nome e uma cor acima para criar a primeira."
            />
          ) : (
            <ul className="space-y-1">
              {controller.tags.map((tag) => (
                <li key={tag.id}>
                  <TagRow
                    tag={tag}
                    count={counts ? (counts.get(tag.id) ?? 0) : tag.projectCount}
                    controller={controller}
                    onRemoved={onTagRemoved}
                  />
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function TagRow({
  tag,
  count,
  controller,
  onRemoved,
}: {
  tag: Tag;
  count: number;
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
        aria-label={`Nome da tag ${tag.name}`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(tag.name);
        }}
        className="border-transparent bg-transparent px-2 shadow-none hover:border-input focus-visible:border-input focus-visible:bg-card"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {pluralize(count, "projeto")}
      </span>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy && <Loader2 className="animate-spin" />}
            Excluir
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
          aria-label={`Excluir a tag ${tag.name}`}
          title="Excluir tag"
        >
          <Trash2 />
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
          className="shrink-0"
          aria-label={`Cor: ${tagColorLabels[value]} — trocar`}
          title={`Cor: ${tagColorLabels[value]}`}
        >
          <span className={cn("size-3.5 rounded-full", tagDotClass[value])} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1">
          {TAG_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              title={tagColorLabels[color]}
              aria-label={tagColorLabels[color]}
              aria-pressed={color === value}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              className="grid size-7 place-items-center rounded-md transition hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {/* A cor marcada ganha um anel no tom do texto, e não um
                  "check" branco: o anel lê bem sobre qualquer cor e nos dois
                  temas. */}
              <span
                className={cn(
                  "size-4 rounded-full",
                  tagDotClass[color],
                  color === value && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
                )}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
