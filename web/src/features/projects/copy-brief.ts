import { toast } from "sonner";
import type { Project } from "@/lib/api";
import { fetchProjectBrief } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";

/** Copiar o prompt sem botão próprio — é o que o menu "…" do card usa. */
export async function copyBrief(project: Project) {
  try {
    const data = await fetchProjectBrief(project.id);
    const ok = await copyToClipboard(data.text);
    if (!ok) throw new Error("O navegador bloqueou o acesso à área de transferência");
    toast.success("Prompt copiado", {
      description: `${data.text.length.toLocaleString("pt-BR")} caracteres de “${data.file.name}”`,
    });
  } catch (err) {
    toast.error("Não foi possível copiar o prompt", {
      description: err instanceof Error ? err.message : undefined,
    });
  }
}
