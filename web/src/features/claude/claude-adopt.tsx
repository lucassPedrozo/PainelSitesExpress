import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderInput, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adoptClaudeSite, fetchClaudeAdoptPlan, type Project } from "@/lib/api";
import { formatBytes, pluralize } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HintWhenDisabled } from "./claude-shared";
import { errorMessage, semPermissaoDeGerar } from "./claude-text";
import { useClaudeRefresh } from "./use-claude";

/**
 * O projeto tem, entre os arquivos enviados, a pasta de um site feito na
 * ferramenta antiga (o Joinvixable). Trazido para o motor, ele vai ao GitHub
 * com a configuração certa e aceita pedido de ajuste aqui. Trazer só copia:
 * não dispara o Claude.
 */
export function ClaudeAdoptNotice({ project }: { project: Project }) {
  const { can } = usePermissions();
  const refresh = useClaudeRefresh();
  const [working, setWorking] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: queryKeys.claudeAdoptPlan(project.id),
    queryFn: () => fetchClaudeAdoptPlan(project.id),
    enabled: project.source === "panel",
  });

  const sources = plan.data?.possible ? plan.data.sources : [];
  if (sources.length === 0) return null;

  const trazer = async (sourcePath: string) => {
    setWorking(sourcePath);
    try {
      const resultado = await adoptClaudeSite(project.id, sourcePath);
      await Promise.all([refresh(), plan.refetch()]);
      toast.success("Site trazido para o motor Claude", {
        description: `${pluralize(resultado.files, "arquivo")}. Agora dá para enviar ao GitHub e pedir ajustes.`,
      });
    } catch (err) {
      toast.error("O site não foi trazido", { description: errorMessage(err) });
    } finally {
      setWorking(null);
    }
  };

  const semPermissao = can("gerar") ? null : semPermissaoDeGerar;

  return (
    <Alert variant="info">
      <FolderInput />
      <AlertTitle>Este projeto tem um site feito no Joinvixable</AlertTitle>
      <AlertDescription>
        <p>
          Traga-o para o motor Claude para pedir ajustes pelo painel. O envio ao GitHub passa a levar a
          configuração do template, com as dependências que o build precisa. Trazer só copia os arquivos: não
          dispara o Claude.
        </p>
        <ul className="mt-2 space-y-1.5">
          {sources.map((source) => (
            <li key={source.path} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <HintWhenDisabled reason={semPermissao}>
                <Button
                  size="sm"
                  disabled={Boolean(semPermissao) || working !== null}
                  onClick={() => void trazer(source.path)}
                >
                  {working === source.path ? <Loader2 className="animate-spin" /> : <FolderInput />}
                  Trazer para o motor Claude
                </Button>
              </HintWhenDisabled>
              <span className="text-xs text-muted-foreground">
                {source.path ? `Pasta ${source.path}` : "Raiz do projeto"} · {pluralize(source.files, "arquivo")} ·{" "}
                {formatBytes(source.bytes)}
              </span>
            </li>
          ))}
        </ul>
        {semPermissao && <p className="mt-1 text-xs">{semPermissao}.</p>}
      </AlertDescription>
    </Alert>
  );
}
