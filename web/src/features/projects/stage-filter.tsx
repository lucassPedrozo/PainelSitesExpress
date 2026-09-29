import { CircleDot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip, FilterRow } from "@/components/filter-chip";
import {
  stageClass,
  stageLabels,
  stageOrder,
  type ProjectStage,
} from "./project-status";

/**
 * Filtro pelo selo de estado — o mesmo que aparece no card.
 *
 * As tags são a classificação livre de quem opera o painel; o estado é o que
 * o painel sabe sozinho. Antes só as tags filtravam, e "quais links de
 * cliente caíram?" não tinha como ser perguntado. Só aparecem os estados que
 * existem na lista aberta.
 */
export function StageFilter({
  counts,
  value,
  onChange,
}: {
  counts: Map<ProjectStage, number>;
  value: ProjectStage | null;
  onChange: (stage: ProjectStage | null) => void;
}) {
  const stages = stageOrder.filter(
    (stage) => (counts.get(stage) ?? 0) > 0 || stage === value,
  );
  if (stages.length === 0) return null;

  return (
    <FilterRow
      icon={<CircleDot aria-hidden />}
      label="Etapa"
      aside={
        value && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X />
            Todas as etapas
          </Button>
        )
      }
    >
      {stages.map((stage) => {
        const on = value === stage;
        return (
          <FilterChip
            key={stage}
            active={on}
            activeClassName={stageClass[stage]}
            count={counts.get(stage) ?? 0}
            onClick={() => onChange(on ? null : stage)}
          >
            {stageLabels[stage]}
          </FilterChip>
        );
      })}
    </FilterRow>
  );
}
