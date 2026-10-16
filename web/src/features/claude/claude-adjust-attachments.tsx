import { useRef } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_ADJUST_ATTACHMENTS as MAX_ATTACHMENTS } from "@shared/claude-options.js";
import { ACCEPTED, type useAdjustAttachments } from "./use-adjust-attachments";

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
