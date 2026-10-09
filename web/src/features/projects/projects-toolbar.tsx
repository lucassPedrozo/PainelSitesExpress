import { useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  FolderPlus,
  LayoutGrid,
  Link2,
  List,
  ListTodo,
} from "lucide-react";
import { toast } from "sonner";
import { checkAllSharePreviews, type Project } from "@/lib/api";
import { ClaudeQueueButton } from "@/features/claude/claude-queue";
import { pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { sortLabels, type SortKey } from "./project-filters";
import type { ProjectList } from "./use-project-list";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ProjectsLayout = "grid" | "list";

type ProjectsToolbarProps = {
  list: ProjectList;
  layout: ProjectsLayout;
  onLayoutChange: (layout: ProjectsLayout) => void;
  /** Abre a criação de um projeto no painel (sem pasta no Drive). */
  onNewProject: () => void;
  /** Abre um projeto na aba do Claude — a partir da fila dele. */
  onOpenClaude: (project: Project) => void;
};

/** Ordenação, conferência dos links, finalizados e grade/lista. */
export function ProjectsToolbar({
  list,
  layout,
  onLayoutChange,
  onNewProject,
  onOpenClaude,
}: ProjectsToolbarProps) {
  const { sort, setSort, asc, toggleDirection, finishedCount, view } = list;
  const { can } = usePermissions();

  return (
    <section aria-label="Vista, ordenação e exibição" className="flex flex-wrap items-center gap-2">
      {/* A vista vem antes da ordenação: ela decide o que a ordenação ordena.
          Os finalizados são uma vista, não um botão à parte: combinados com
          "Fazer agora" eles sumiam (a fila esconde o que está no ar). */}
      <Segmented
        label="Vista"
        value={view}
        onChange={list.setView}
        options={[
          {
            value: "queue",
            icon: <ListTodo />,
            label: "Fazer agora",
            title: "Em andamento, agrupados pelo que falta fazer. Os que estão no ar e os finalizados ficam de fora.",
          },
          {
            value: "all",
            label: "Todos",
            title: "Todos os projetos em andamento, por data — inclusive os que estão no ar. Os finalizados ficam na vista ao lado.",
          },
          {
            value: "finished",
            icon: <Archive />,
            label: "Finalizados",
            count: finishedCount,
            title: "Só os projetos com a tag “Finalizado”, que saem das outras vistas.",
          },
        ]}
      />

      <div className="flex items-center gap-2">
        <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
          {/* Mais estreito no celular: com o botão de direção, a exibição e
              a conferência dos links, a barra cabe em duas linhas. */}
          <SelectTrigger className="w-40 sm:w-48" aria-label="Ordenar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(sortLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={toggleDirection}
          aria-label={asc ? "Ordem crescente — inverter" : "Ordem decrescente — inverter"}
          title={asc ? "Crescente — clique para inverter" : "Decrescente — clique para inverter"}
        >
          {asc ? <ArrowUp /> : <ArrowDown />}
          <span className="hidden lg:inline">{asc ? "Crescente" : "Decrescente"}</span>
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ClaudeQueueButton projects={list.projects} onOpenProject={onOpenClaude} />
        <Button
          variant="outline"
          onClick={onNewProject}
          disabled={!can("organizar")}
          aria-label="Novo projeto"
          title={
            can("organizar")
              ? "Cria um projeto aqui no painel, sem pasta no Drive — para um site já desenvolvido ou para guardar arquivos"
              : "Esta chave de acesso não tem permissão para criar projetos"
          }
        >
          <FolderPlus className="size-4" />
          <span className="hidden sm:inline">Novo projeto</span>
        </Button>
        <CheckLinksButton onChecked={() => list.load()} />
        <Segmented
          label="Exibição"
          value={layout}
          onChange={onLayoutChange}
          options={[
            { value: "grid", icon: <LayoutGrid />, title: "Grade" },
            { value: "list", icon: <List />, title: "Lista" },
          ]}
        />
      </div>
    </section>
  );
}

/** Confere todos os links de cliente de uma vez e recarrega a lista. */
function CheckLinksButton({ onChecked }: { onChecked: () => unknown }) {
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const { checked, summary } = await checkAllSharePreviews();
      if (!checked) {
        toast.info("Nenhum link de cliente registrado ainda");
      } else if (summary.dead) {
        // O que importa é o número de clientes com link quebrado.
        toast.error(`${pluralize(summary.dead, "link de cliente não abre", "links de cliente não abrem")}`, {
          description:
            "Crie um novo Share preview nos projetos afetados e reaponte o link.",
        });
      } else {
        toast.success(`${pluralize(checked, "link conferido", "links conferidos")}`, {
          description: summary.unknown
            ? `${summary.unknown} sem resposta do Lovable.`
            : "Todos abrem para o cliente.",
        });
      }
      await onChecked();
    } catch (err) {
      toast.error("Falha ao verificar os links", {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    // No celular fica só o ícone, como o "Atualizar" do cabeçalho; o nome
    // continua no `aria-label` e no `title`.
    <Button
      variant="outline"
      disabled={checking}
      onClick={() => void check()}
      aria-label={checking ? "Verificando os links" : "Verificar links"}
      title="Confere agora se os links enviados aos clientes abrem (o painel também confere sozinho a cada 30 min)"
    >
      <Link2 className={cn("size-4", checking && "animate-pulse")} />
      <span className="hidden sm:inline">{checking ? "Verificando…" : "Verificar links"}</span>
    </Button>
  );
}
