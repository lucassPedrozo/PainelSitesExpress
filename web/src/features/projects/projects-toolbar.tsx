import { useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  LayoutGrid,
  Link2,
  List,
  ListTodo,
} from "lucide-react";
import { toast } from "sonner";
import { checkAllSharePreviews } from "@/lib/api";
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
};

/** Ordenação, conferência dos links, finalizados e grade/lista. */
export function ProjectsToolbar({
  list,
  layout,
  onLayoutChange,
}: ProjectsToolbarProps) {
  const { sort, setSort, asc, toggleDirection, finishedCount, view } = list;

  return (
    <section className="flex flex-wrap items-center gap-2">
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
          <SelectTrigger className="w-48" aria-label="Ordenar por">
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
          title={asc ? "Crescente — clique para inverter" : "Decrescente — clique para inverter"}
        >
          {asc ? <ArrowUp /> : <ArrowDown />}
          {asc ? "Crescente" : "Decrescente"}
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-2">
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
        toast.error(`${summary.dead} link(s) de cliente não abrem`, {
          description:
            "Crie um novo Share preview nos projetos afetados e reaponte o link.",
        });
      } else {
        toast.success(`${checked} link(s) conferido(s)`, {
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
    <Button
      variant="outline"
      disabled={checking}
      onClick={() => void check()}
      title="Confere agora se os links enviados aos clientes abrem (o painel também confere sozinho a cada 30 min)"
    >
      <Link2 className={cn("size-4", checking && "animate-pulse")} />
      {checking ? "Verificando…" : "Verificar links"}
    </Button>
  );
}
