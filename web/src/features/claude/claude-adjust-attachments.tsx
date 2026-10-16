import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import type { ClaudeAdjustAttachments, ClaudeAttachment } from "@/lib/api";
import { removeClaudeAttachment, uploadClaudeAttachment } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errorMessage } from "./claude-text";
import {
  MAX_ADJUST_ATTACHMENT_BYTES as MAX_BYTES,
  MAX_ADJUST_ATTACHMENTS as MAX_ATTACHMENTS,
} from "@shared/claude-options.js";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type AdjustAttachment = {
  file: string;
  name: string;
  size: number;
  /** Miniatura feita do arquivo escolhido: a imagem não volta do painel. */
  preview: string;
  /** Marcada: o Claude põe a imagem no site. Desmarcada: é só referência. */
  use: boolean;
};

/** O que vai junto do pedido de ajuste. */
export const attachmentsPayload = (
  draft: string | null,
  items: AdjustAttachment[],
): ClaudeAdjustAttachments | undefined =>
  draft && items.length
    ? { draft, items: items.map(({ file, name, use }) => ({ file, name, use })) }
    : undefined;

/** Onde as imagens de um pedido sobem: o ajuste do motor, ou o de um site de repositório. */
export type AttachmentApi = {
  upload: (projectId: string, file: File, draft?: string | null) => Promise<ClaudeAttachment>;
  remove: (projectId: string, draft: string, file: string) => Promise<unknown>;
};

const doMotor: AttachmentApi = { upload: uploadClaudeAttachment, remove: removeClaudeAttachment };

/**
 * As imagens de um pedido de ajuste. Cada uma sobe ao painel assim que é
 * escolhida — ou colada no texto do pedido — e só segue para o Claude quando
 * o ajuste é pedido.
 */
export function useAdjustAttachments(projectId: string, api: AttachmentApi = doMotor) {
  const [draft, setDraft] = useState<string | null>(null);
  const [items, setItems] = useState<AdjustAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // O rascunho nasce na primeira imagem; as seguintes da mesma leva o reusam.
  const draftRef = useRef<string | null>(null);
  const countRef = useRef(0);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const add = async (files: File[]) => {
    const images = files.filter((file) => ACCEPTED.includes(file.type));
    if (images.length < files.length) {
      toast.error("Só imagens PNG, JPG, WebP ou GIF", {
        description: "Os outros arquivos ficaram de fora.",
      });
    }
    if (!images.length) return;
    setUploading(true);
    try {
      for (const file of images) {
        if (countRef.current >= MAX_ATTACHMENTS) {
          toast.error(`Um pedido leva até ${MAX_ATTACHMENTS} imagens`);
          break;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} passa de 8 MB`, { description: "Reduza a imagem e anexe de novo." });
          continue;
        }
        try {
          const saved = await api.upload(projectId, file, draftRef.current);
          draftRef.current = saved.draft;
          countRef.current += 1;
          const preview = URL.createObjectURL(file);
          previews.current.add(preview);
          setDraft(saved.draft);
          setItems((current) => [
            ...current,
            { file: saved.file, name: saved.name, size: saved.size, preview, use: false },
          ]);
        } catch (err) {
          toast.error(`${file.name} não foi anexada`, { description: errorMessage(err) });
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const remove = (item: AdjustAttachment) => {
    setItems((current) => current.filter((other) => other.file !== item.file));
    countRef.current = Math.max(0, countRef.current - 1);
    URL.revokeObjectURL(item.preview);
    previews.current.delete(item.preview);
    // A imagem sai da tela na hora; se o painel não a apagar, ela só não é usada.
    if (draftRef.current) void api.remove(projectId, draftRef.current, item.file).catch(() => {});
  };

  const setUse = (item: AdjustAttachment, use: boolean) =>
    setItems((current) => current.map((other) => (other.file === item.file ? { ...other, use } : other)));

  /** Depois do pedido aceito: as imagens já são dele, a tela começa outra leva. */
  const reset = () => {
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
    draftRef.current = null;
    countRef.current = 0;
    setDraft(null);
    setItems([]);
  };

  return { draft, items, uploading, add, remove, setUse, reset };
}

type Props = {
  attachments: ReturnType<typeof useAdjustAttachments>;
  disabled: boolean;
};

/** O botão de anexar e a lista das imagens do pedido. */
export function AdjustAttachments({ attachments, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const { items, uploading } = attachments;
  const full = items.length >= MAX_ATTACHMENTS;

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.file} className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
              <img
                src={item.preview}
                alt=""
                className="size-12 shrink-0 rounded border bg-background object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={item.name}>
                  {item.name}
                </p>
                <label className="mt-0.5 flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={item.use}
                    disabled={disabled}
                    onCheckedChange={(checked) => attachments.setUse(item, checked === true)}
                  />
                  Usar esta imagem no site
                  <span aria-hidden>·</span>
                  <span>{formatBytes(item.size)}</span>
                </label>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={`Tirar ${item.name}`}
                onClick={() => attachments.remove(item)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void attachments.add(files);
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || uploading || full}
          onClick={() => input.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
          Anexar imagens
        </Button>
        <p className="text-xs text-muted-foreground">
          {items.length > 0
            ? "Sem marcar, a imagem é só referência: o Claude olha, mas não a põe no site."
            : "Capturas de tela, exemplos ou a imagem nova. Também dá para colar no texto do pedido."}
        </p>
      </div>
    </div>
  );
}
