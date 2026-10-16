import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { BuildFile, BuildPackage } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  className,
}: {
  className?: string;
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
    // Em duas colunas a seção rola por dentro, e a lista nunca fica abaixo
    // de uma altura mínima — o mesmo desenho da aba do banco de imagens.
    <section className={cn("flex min-h-0 min-w-0 flex-col gap-2 p-6 lg:overflow-y-auto", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Arquivos para anexar
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {selected.size} de {selectableCount}
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            Todos
          </Button>
          <Button variant="ghost" size="sm" onClick={onSelectNone}>
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
          aria-label="Buscar arquivo ou subpasta"
          className="pl-8"
        />
      </div>

      <div className="min-h-40 flex-1 space-y-1 overflow-y-auto rounded-lg border p-1">
        {visible.length === 0 ? (
          // Pasta vazia e busca sem resultado pedem coisas diferentes: subir
          // material, ou trocar o termo.
          <p className="p-6 text-center text-sm text-muted-foreground">
            {pkg.files.length === 0
              ? "A pasta do projeto ainda não tem arquivos para anexar."
              : `Nenhum arquivo com “${query.trim()}” no nome ou na subpasta.`}
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
          `Esta coleta tem ${pluralize(summary.recommended, "imagem ou compactado", "imagens e compactados")}; vêm marcados os ${pkg.limits.maxAttachments} primeiros, o teto por envio. `}
        {summary.blocked > 0 &&
          `${pluralize(summary.blocked, "arquivo passa", "arquivos passam")} do limite de tamanho. `}
        Imagens e compactados vêm marcados; vídeo e áudio podem ir, mas o Lovable
        não garante aproveitar o conteúdo.
      </p>
    </section>
  );
}
