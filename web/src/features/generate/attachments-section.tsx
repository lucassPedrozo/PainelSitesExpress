import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { BuildFile, BuildPackage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentRow } from "./attachment-row";
import { filterFiles, type SelectionSummary } from "./generation-prompt";

/** A coluna dos anexos: busca, seleção e as ressalvas de tipo e tamanho. */
export function AttachmentsSection({
  pkg,
  selected,
  summary,
  onToggle,
  onSelectAll,
  onSelectNone,
}: {
  pkg: BuildPackage;
  selected: Set<string>;
  summary: SelectionSummary;
  onToggle: (file: BuildFile) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterFiles(pkg.files, query), [pkg, query]);
  const selectableCount = useMemo(
    () => pkg.files.filter((file) => !file.blockedReason).length,
    [pkg],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2 p-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Arquivos para anexar
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {selected.size} de {selectableCount}
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSelectAll}>
            Todos
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSelectNone}>
            Nenhum
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar arquivo ou subpasta..."
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border p-1">
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum arquivo encontrado.
          </p>
        ) : (
          visible.map((file) => (
            <AttachmentRow
              key={file.id}
              file={file}
              checked={selected.has(file.id)}
              onToggle={() => onToggle(file)}
            />
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {summary.capped &&
          `Esta coleta tem ${summary.recommended} imagens — marcamos as ${pkg.limits.maxAttachments} primeiras, que é o teto por envio. `}
        {summary.blocked > 0 &&
          `${summary.blocked} arquivo(s) passam do limite de tamanho. `}
        Vídeo, áudio e compactados{" "}
        <b className="font-medium">podem ser anexados</b>, mas não vêm
        marcados: o upload é aceito pelo Lovable, e o aproveitamento do conteúdo
        é que não é garantido. As imagens continuam sendo o material mais
        confiável.
      </p>
    </section>
  );
}
