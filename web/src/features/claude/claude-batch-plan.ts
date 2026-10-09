import type { ClaudeMaterial, Project } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { isClaudeSite, latestGeneration } from "@/features/projects/project-status";

/**
 * O pedido que cada projeto de um lote faz ao Claude.
 *
 * O lote não pula a revisão: quem ainda não tem briefing pede o briefing, e
 * quem já tem um briefing aceito pede o site. O que precisa de uma decisão —
 * briefing com pendência, pedido já na fila, site que já existe — fica de
 * fora, com o motivo.
 */
export type ClaudeBatchPlan =
  | {
      ok: true;
      /** O que entra na fila para este projeto. */
      kind: "briefing" | "site";
      summary: string;
      /** Nada impede, mas vale saber antes de gastar. */
      warnings: string[];
    }
  | { ok: false; reason: string };

/** O que já dá para dizer sem ler o material: basta o que o card sabe. */
export function claudeBatchPlanFromProject(project: Project): ClaudeBatchPlan | null {
  const claude = project.claude ?? null;
  if (claude?.queue) {
    return {
      ok: false,
      reason:
        claude.queue.estado === "interrompida"
          ? "Tem uma execução interrompida — retome-a ou descarte-a no projeto."
          : "Já tem um pedido na fila do Claude.",
    };
  }
  if (isClaudeSite(latestGeneration(project))) {
    return { ok: false, reason: "Já tem site gerado pelo Claude — peça um ajuste nele, no projeto." };
  }
  if (claude?.site?.awaitingApproval) {
    return { ok: false, reason: "A direção criativa espera aprovação — aprove no projeto." };
  }
  if (claude?.site?.openStage) {
    return { ok: false, reason: "A geração parou com uma etapa aberta — continue ou encerre no projeto." };
  }
  if (claude?.briefing?.state === "refused") {
    return {
      ok: false,
      reason: `O briefing tem ${pluralize(claude.briefing.errors, "pendência")} — corrija no projeto antes de gerar.`,
    };
  }
  if (claude?.briefing?.state === "ok") {
    return {
      ok: true,
      kind: "site",
      summary: "Briefing aceito pela conferência — entra a geração do site.",
      warnings: project.generations.length > 0 ? ["Já tem site de outro motor — este será outro."] : [],
    };
  }
  return null;
}

/** O pedido de briefing padrão: o texto das informações e os arquivos recomendados. */
export function claudeBatchPlan(project: Project, material: ClaudeMaterial): ClaudeBatchPlan {
  const decidido = claudeBatchPlanFromProject(project);
  if (decidido) return decidido;

  const recomendados = material.files.filter((file) => file.recommended);
  const texto = material.prompt.text.trim();
  if (recomendados.length === 0 && !texto) {
    return {
      ok: false,
      reason: "Sem material para o Claude ler — abra o projeto para marcar arquivos ou citar o site do cliente.",
    };
  }
  if (recomendados.length > material.limits.maxArquivos) {
    return {
      ok: false,
      reason: `São ${recomendados.length} arquivos, acima do limite de ${material.limits.maxArquivos} — escolha no projeto.`,
    };
  }

  const warnings: string[] = [];
  if (project.generations.length > 0) warnings.push("Já tem site gerado — este será outro.");
  if (material.prompt.others > 0) warnings.push("Há mais de um briefing na pasta; vai o mais recente.");
  if (!texto) warnings.push("Sem o texto das informações do site: o briefing sai só dos arquivos.");
  if (recomendados.length === 0) warnings.push("Nenhum arquivo marcado: o briefing sai só do texto.");

  return {
    ok: true,
    kind: "briefing",
    summary: [
      pluralize(recomendados.length, "arquivo"),
      texto ? `${pluralize(texto.length, "caractere")} de informações` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    warnings,
  };
}
