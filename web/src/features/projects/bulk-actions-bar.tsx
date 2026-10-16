import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  Pencil,
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
import { plural, pluralize } from "@/lib/format";
import { Reason } from "@/components/disabled-hint";
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
import { BulkEditDialog } from "./bulk-edit-dialog";
import { latestGeneration } from "./project-status";
import type { ProjectList } from "./use-project-list";

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
  responsibles,
}: {
  list: ProjectList;
  tags: TagsController;
  /** Os projetos na tela — "selecionar todos" marca estes. */
  visible: Project[];
  approvalAreaReady: boolean;
  onGenerate: (projects: Project[]) => void;
  /** Os responsáveis já usados — sugestões da edição em massa. */
  responsibles: string[];
}) {
  const { can } = usePermissions();
  const [busy, setBusy] = useState<string | null>(null);
  const [editando, setEditando] = useState<Project[] | null>(null);

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

  const ocultos = selecionados.filter((project) => project.details?.hidden);
  const visiveisSel = selecionados.filter((project) => !project.details?.hidden);

  /** Ocultar ou mostrar de uma vez; a seleção some porque os projetos mudam de aba. */
  const alternarOcultos = (alvos: Project[], ocultar: boolean) =>
    run("ocultar", async () => {
      const falhas = await list.applyDetailsMany(alvos, { hidden: ocultar });
      const feitos = alvos.length - falhas;
      if (feitos) toast.success(`${projetos(feitos)} ${ocultar ? plural(feitos, "ocultado", "ocultados") : plural(feitos, "voltou à lista", "voltaram à lista")}`);
      if (falhas) toast.error(`${falhas} de ${projetos(alvos.length)} ${plural(falhas, "falhou", "falharam")}`);
      list.clearSelection();
    });

  const editarVarios = async (alvos: Project[], patch: Parameters<ProjectList["applyDetailsMany"]>[1]) => {
    const falhas = await list.applyDetailsMany(alvos, patch);
    if (falhas) toast.error(`${falhas} de ${projetos(alvos.length)} não ${plural(falhas, "foi atualizado", "foram atualizados")}`, { description: "Os outros ficaram com a mudança." });
    else toast.success(`${projetos(alvos.length)} ${plural(alvos.length, "atualizado", "atualizados")}`);
  };

  const run = async (chave: string, action: () => Promise<void>) => {
    setBusy(chave);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const projetos = (n: number) => pluralize(n, "projeto");

  const aplicarTags = (rotulo: string, alvos: Project[], update: (ids: string[]) => string[]) =>
    run("tags", async () => {
      const falhas = await list.applyTagsMany(alvos, update);
      if (falhas) toast.error(`${rotulo}: ${falhas} de ${projetos(alvos.length)} ${plural(falhas, "falhou", "falharam")}`, { description: "O que falhou voltou ao que era." });
      else toast.success(`${rotulo} — ${projetos(alvos.length)}`);
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
        toast.success(`Publicação iniciada na área de aprovação — ${projetos(ok)}`, {
          description: "O andamento de cada um aparece no card. O painel avisa quando os links ficarem prontos.",
          duration: 10_000,
        });
      }
      if (erros.length) {
        toast.error(pluralize(erros.length, "projeto não foi publicado", "projetos não foram publicados"), { description: [...new Set(erros)].slice(0, 2).join(" ") });
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
      else if (contagem.dead) toast.error(`${contagem.dead} de ${pluralize(total, "link")} ${plural(contagem.dead, "não abre", "não abrem")}`);
      else toast.success(`${pluralize(total, "link conferido", "links conferidos")}`, { description: contagem.unknown ? `${pluralize(contagem.unknown, "link")} sem resposta.` : "Todos abrem para o cliente." });
    });

  const naoPode = [
    !can("organizar") && "editar, ocultar, mexer em tags e finalizar",
    !can("gerar") && "gerar",
    !can("publicar") && approvalAreaReady && comSite.length > 0 && "publicar",
  ].filter(Boolean) as string[];

  return (
    <div
      role="region"
      aria-label="Ações nos projetos selecionados"
      className="sticky bottom-3 z-30 mx-auto flex w-fit max-w-full animate-rise flex-wrap items-center gap-1.5 rounded-xl border bg-popover/95 px-3 py-2 shadow-xl backdrop-blur [--rise-from:16px]"
    >
      <span className="pl-1 text-sm font-medium tabular-nums sm:pr-1">
        {selecionados.length} {selecionados.length === 1 ? "selecionado" : "selecionados"}
      </span>
      {!todosVisiveis && (
        <Button variant="ghost" size="sm" onClick={() => list.setSelected(visible.map((p) => p.id))}>
          {visible.length === 1 ? "Selecionar o da lista" : `Selecionar os ${visible.length} da lista`}
        </Button>
      )}

      {/* No celular o "fechar" fica na primeira linha, ao lado da contagem; a
          partir de `sm` volta para o fim da barra. */}
      <Button variant="ghost" size="icon-sm" className="ml-auto sm:order-last sm:ml-0" onClick={list.clearSelection} aria-label="Limpar seleção" title="Limpar seleção">
        <X />
      </Button>
      {/* Quebra de linha só no celular: as ações começam na linha de baixo. */}
      <span className="basis-full sm:hidden" aria-hidden />

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!can("organizar") || busy !== null} title="Coloca a tag em todos os selecionados">
            <Plus />
            Adicionar tag
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs">Em {projetos(selecionados.length)}</DropdownMenuLabel>
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
            <Button variant="outline" size="sm" disabled={!can("organizar") || busy !== null} title="Tira a tag de todos os selecionados">
              <Minus />
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

      <Button
        variant="outline"
        size="sm"
        disabled={!can("organizar") || busy !== null}
        title="Muda o responsável e a etapa de todos os selecionados"
        onClick={() => setEditando(selecionados)}
      >
        <Pencil />
        Editar
      </Button>

      {visiveisSel.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("organizar") || busy !== null}
          title="Tira da lista, dos contadores, do Dashboard e do relatório; voltam pela aba Ocultos"
          onClick={() => void alternarOcultos(visiveisSel, true)}
        >
          {busy === "ocultar" ? <Loader2 className="animate-spin" /> : <EyeOff />}
          Ocultar {visiveisSel.length < selecionados.length ? `(${visiveisSel.length})` : ""}
        </Button>
      )}
      {ocultos.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("organizar") || busy !== null}
          title="Volta os ocultos para a lista de trabalho"
          onClick={() => void alternarOcultos(ocultos, false)}
        >
          <Eye />
          Mostrar {ocultos.length < selecionados.length ? `(${ocultos.length})` : ""}
        </Button>
      )}

      {finalizado && finalizados.length < selecionados.length && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("organizar") || busy !== null}
          title="Marca como finalizados: saem dos ativos e vão para a aba Finalizados"
          onClick={() =>
            void aplicarTags("Finalizados", selecionados, (ids) =>
              ids.includes(finalizado) ? ids : [...ids, finalizado],
            ).then(() => list.clearSelection())
          }
        >
          <Archive />
          Finalizar
        </Button>
      )}
      {finalizado && finalizados.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("organizar") || busy !== null}
          title="Tira a tag “Finalizado”: voltam para a lista de trabalho"
          onClick={() =>
            void aplicarTags("Reabertos", finalizados, (ids) => ids.filter((id) => id !== finalizado)).then(() =>
              list.clearSelection(),
            )
          }
        >
          <ArchiveRestore />
          Reabrir {finalizados.length < selecionados.length ? `(${finalizados.length})` : ""}
        </Button>
      )}

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

      <Button
        variant="outline"
        size="sm"
        disabled={!can("gerar") || busy !== null}
        title={
          semSite.length < selecionados.length
            ? `Abre a geração em lote; ${pluralize(selecionados.length - semSite.length, "já tem", "já têm")} site e o diálogo avisa. Nada é enviado antes da confirmação.`
            : "Abre a geração em lote com os selecionados. Nada é enviado antes da confirmação."
        }
        onClick={() => onGenerate(selecionados)}
      >
        <Sparkles />
        Gerar em lote ({selecionados.length})
      </Button>

      {approvalAreaReady && comSite.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={!can("publicar") || busy !== null}
          title={`Publica na área de aprovação ${comSite.length === 1 ? "o que tem" : `os ${comSite.length} que têm`} site gerado`}
          onClick={() => void publicarArea()}
        >
          {busy === "area" ? <Loader2 className="animate-spin" /> : <Eye />}
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
          {busy === "links" ? <Loader2 className="animate-spin" /> : <Link2 />}
          Verificar links
        </Button>
      )}

      {busy === "tags" && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Aplicando as tags" />}
      {naoPode.length > 0 && <Reason className="basis-full px-1">Sua chave de acesso não pode {naoPode.join(", nem ")}.</Reason>}

      <BulkEditDialog
        projects={editando}
        responsibles={responsibles}
        onOpenChange={(aberto) => !aberto && setEditando(null)}
        onSubmit={editarVarios}
      />

    </div>
  );
}
