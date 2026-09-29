import type { BuildPackage, Project } from "@/lib/api";
import { initialSelection } from "./generation-prompt";

/**
 * O envio padrão de um projeto: o briefing como está e o que o painel já
 * recomenda anexar (compactados e imagens), até o teto. É o que o diálogo
 * completo abre marcado — e, na maior parte das vezes, o que se envia sem
 * mexer em nada.
 */

export type QuickPlan =
  | {
      ok: true;
      prompt: string;
      fileIds: string[];
      /** Anexos do projeto, sem contar a assinatura Joinvix. */
      attachments: number;
      promptChars: number;
      /** Nada impede, mas vale saber antes de gastar crédito. */
      warnings: string[];
    }
  | { ok: false; reason: string };

export function quickPlan(project: Project, pkg: BuildPackage): QuickPlan {
  const prompt = pkg.prompt.text.trim();
  if (!pkg.prompt.found || !prompt) {
    return {
      ok: false,
      reason: "Sem briefing no Drive — use “Revisar” para descrever o site.",
    };
  }
  if (prompt.length > pkg.limits.maxPromptChars) {
    return {
      ok: false,
      reason: `Briefing com ${prompt.length.toLocaleString("pt-BR")} caracteres, acima do limite de ${pkg.limits.maxPromptChars.toLocaleString("pt-BR")}.`,
    };
  }

  const fileIds = [...initialSelection(pkg.files, pkg.limits.maxAttachments)];
  const warnings: string[] = [];
  if (project.generations.length > 0) {
    warnings.push("Já tem site gerado — este será outro.");
  }
  if (pkg.prompt.others > 0) {
    warnings.push("Há mais de um briefing na pasta; vai o mais recente.");
  }
  const recomendados = pkg.files.filter((file) => file.recommended).length;
  if (recomendados > fileIds.length) {
    warnings.push(`Só ${fileIds.length} de ${recomendados} anexos recomendados cabem no envio.`);
  }
  if (fileIds.length === 0) {
    warnings.push("Nenhuma imagem nem compactado para anexar.");
  }

  return {
    ok: true,
    prompt,
    fileIds,
    attachments: fileIds.length,
    promptChars: prompt.length,
    warnings,
  };
}
