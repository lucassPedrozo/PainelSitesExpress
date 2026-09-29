import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Eye,
  Link2,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Generation, Project } from "@/lib/api";
import { checkSharePreview, publishToDevArea } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import type { TagsController } from "@/features/tags/use-tags";
import { tagDotClass } from "@/features/tags/tag-colors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { latestGeneration } from "./project-status";
import type { ProjectList } from "./use-project-list";

const semPermissao = "Esta chave de acesso não tem permissão para isto";

/**
 * Ações sobre vários projetos de uma vez: tags, finalizar, gerar em lote,
 * publicar na área de aprovação e conferir links. Aparece quando há projeto
 * marcado, fixa no rodapé, e diz a cada ação quantos ela vai alcançar.
 */
export function BulkActionsBar({
  list,
  tags,
  visible,
  approvalAreaReady,
  onGenerate,
}: {
  list: ProjectList;
  tags: TagsController;
  /** Os projetos na tela — "selecionar todos" marca estes. */
  visible: Project[];
  approvalAreaReady: boolean;
  onGenerate: (projects: Project[]) => void;
}) {
  const { can } = usePermissions();
  const [busy, setBusy] = useState<string | null>(null);

  const selecionados = list.projects.filter((project) => list.selectedIds.has(project.id));
  if (selecionados.length === 0) return null;

  const comSite = selecionados.filter((project) => latestGeneration(project)?.id);
  const semSite = selecionados.filter((project) => !latestGeneration(project)?.id);
  const finalizado = tags.finishedTagId;
  const finalizados = finalizado
    ? selecionados.filter((project) => project.tagIds.includes(finalizado))
    : [];
  const todosVisiveis = visible.length > 0 && visible.every((project) => list.selectedIds.has(project.id));
  // Tags que algum selecionado tem — as únicas que dá para remover.
  const tagsPresentes = tags.tags.filter((tag) =>
    selecionados.some((project) => project.tagIds.includes(tag.id)),
  );

  const run = async (chave: string, action: () => Promise<void>) => {
    setBusy(chave);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const plural = (n: number) => `${n} ${n === 1 ? "projeto" : "projetos"}`;

  const aplicarTags = (rotulo: string, alvos: Project[], update: (ids: string[]) => string[]) =>
    run("tags", async () => {
      const falhas = await list.applyTagsMany(alvos, update);
      if (falhas) toast.error(`${rotulo}: ${falhas} de ${alvos.length} falharam`, { description: "Os que falharam voltaram ao que eram." });
      else toast.success(`${rotulo} — ${plural(alvos.length)}`);
    });

  const publicarArea = () =>
    run("area", async () => {
      let ok = 0;
      const erros: string[] = [];
      for (const project of comSite) {
        const site = latestGeneration(project)!;
        try {
          const { generation } = await publishToDevArea(project.id, site.id!);
          list.patchGeneration(project, generation);
          ok += 1;
        } catch (err) {
          erros.push(err instanceof Error ? err.message : "falhou");
        }
      }
      if (ok) {
        toast.success(`Publicação iniciada na área de aprovação — ${plural(ok)}`, {
          description: "O andamento de cada um aparece no card. O painel avisa quando os links ficarem prontos.",
          duration: 10_000,
        });
      }
      if (erros.length) {
        toast.error(`${erros.length} não foram publicados`, { description: [...new Set(erros)].slice(0, 2).join(" ") });
      }
    });

  const verificarLinks = () =>
    run("links", async () => {
      const contagem = { alive: 0, dead: 0, unknown: 0 };
      for (const project of comSite) {
        const site = latestGeneration(project) as Generation;
        if (!site.sharePreviewUrl && !site.devArea?.repoFullName) continue;
        try {
          const { generation } = await checkSharePreview(project.id, site.id!);
          list.patchGeneration(project, generation);
          contagem[generation.previewState] += 1;
        } catch {
          contagem.unknown += 1;
        }
      }
      const total = contagem.alive + contagem.dead + contagem.unknown;
      if (!total) toast.info("Nenhum dos selecionados tem link de cliente ainda");
      else if (contagem.dead) toast.error(`${contagem.dead} de ${total} links não abrem`);
      else toast.success(`${total} link(s) conferido(s)`, { description: contagem.unknown ? `${contagem.unknown} sem resposta.` : "Todos abrem para o cliente." });
    });

  return (
    <div className="sticky bottom-3 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-xl border bg-popover/95 px-3 py-2 shadow-xl backdrop-blur">
      <span className="px-1 text-sm font-medium tabular-nums">
        {selecionados.length} {selecionados.length === 1 ? "selecionado" : "selecionados"}
      </span>
      {!todosVisiveis && (
        <Button variant="ghost" size="sm" onClick={() => list.setSelected(visible.map((p) => p.id))}>
          Selecionar os {visible.length} da tela
        </Button>
      )}

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!can("organizar") || busy !== null} title={can("organizar") ? "Coloca a tag em todos os selecionados" : semPermissao}>
            <Plus className="size-3.5" />
            Adicionar tag
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs">Em {plural(selecionados.length)}</DropdownMenuLabel>
          {tags.tags
            .filter((tag) => tag.id !== finalizado)
            .map((tag) => (
              <DropdownMenuItem
                key={tag.id}
                onSelect={() =>
                  void aplicarTags(`Tag “${tag.name}” adicionada`, selecionados, (ids) =>
                    ids.includes(tag.id) ? ids : [...ids, tag.id],
                  )
                }
              >
                <span className={cn("size-2 rounded-full", tagDotClass[tag.color])} />
                {tag.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {tagsPresentes.some((tag) => tag.id !== finalizado) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!can("organizar") || busy !== null} title={can("organizar") ? "Tira a tag de todos os selecionados" : semPermissao}>
              <Minus className="size-3.5" />
              Remover tag
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {tagsPresentes
              .filter((tag) => tag.id !== finalizado)
              .map((tag) => {
                const n = selecionados.filter((project) => project.tagIds.includes(tag.id)).length;
                return (
                  <DropdownMenuItem
                    key={tag.id}
                    onSelect={() =>
                      void aplicarTags(`Tag “${tag.name}” removida`, selecionados, (ids) =>
                        ids.filter((id) => id !== tag.id),
                      )
                    }
                  >
                    <span className={cn("size-2 rounded-full", tagDotClass[tag.color])} />
                    {tag.name}
                    <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{n}</span>
                  </DropdownMenuItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {finalizado && finalizados.length < selecionados.length && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("organizar") || busy !== null}
          title={can("organizar") ? "Marca como finalizados: saem de “Fazer agora” e “Todos” e vão para a vista Finalizados" : semPermissao}
          onClick={() =>
            void aplicarTags("Finalizados", selecionados, (ids) =>
              ids.includes(finalizado) ? ids : [...ids, finalizado],
            ).then(() => list.clearSelection())
          }
        >
          <Archive className="size-3.5" />
          Finalizar
        </Button>
      )}
      {finalizado && finalizados.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("organizar") || busy !== null}
          title={can("organizar") ? "Tira a tag “Finalizado”: voltam para as vistas de trabalho" : semPermissao}
          onClick={() =>
            void aplicarTags("Reabertos", finalizados, (ids) => ids.filter((id) => id !== finalizado)).then(() =>
              list.clearSelection(),
            )
          }
        >
          <ArchiveRestore className="size-3.5" />
          Reabrir {finalizados.length < selecionados.length ? `(${finalizados.length})` : ""}
        </Button>
      )}

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Button
        variant="outline"
        size="sm"
        disabled={!can("gerar") || busy !== null}
        title={
          can("gerar")
            ? "Abre a geração em lote com os selecionados. Nada é enviado antes da confirmação."
            : semPermissao
        }
        onClick={() => onGenerate(selecionados)}
      >
        <Sparkles className="size-3.5" />
        Gerar em lote
        {semSite.length > 0 && semSite.length < selecionados.length ? ` (${semSite.length} sem site)` : ""}
      </Button>

      {approvalAreaReady && comSite.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("publicar") || busy !== null}
          title={can("publicar") ? `Publica na área de aprovação os ${comSite.length} que têm site gerado` : semPermissao}
          onClick={() => void publicarArea()}
        >
          {busy === "area" ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          Publicar na área ({comSite.length})
        </Button>
      )}

      {comSite.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          title="Confere agora se o link de cliente de cada selecionado abre"
          onClick={() => void verificarLinks()}
        >
          {busy === "links" ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          Verificar links
        </Button>
      )}

      {busy === "tags" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

      <Button variant="ghost" size="icon" className="size-7" onClick={list.clearSelection} aria-label="Limpar seleção" title="Limpar seleção">
        <X className="size-4" />
      </Button>
    </div>
  );
}
