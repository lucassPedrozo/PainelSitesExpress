import { CheckCircle2, Circle, Loader2, Rocket, XCircle } from "lucide-react";
import type { DevArea, PreviewState } from "@/lib/api";
import { devAreaSteps, type StepStatus } from "@/features/projects/dev-area-steps";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ICONES: Record<StepStatus, { Icone: typeof Circle; classe: string }> = {
  done: { Icone: CheckCircle2, classe: "text-success" },
  active: { Icone: Loader2, classe: "animate-spin text-info" },
  error: { Icone: XCircle, classe: "text-destructive" },
  waiting: { Icone: Circle, classe: "text-muted-foreground/60" },
};

/**
 * As três etapas da área de aprovação no modal do projeto: repositório,
 * build e envio, link conferido — com o motivo quando algo falha e o atalho
 * para publicar de novo.
 */
export function DevAreaStepsView({
  area,
  previewState,
  editorUrl,
  canPublish,
  publishing,
  onPublish,
}: {
  area: DevArea;
  previewState: PreviewState;
  editorUrl: string | null;
  canPublish: boolean;
  publishing: boolean;
  onPublish: () => void;
}) {
  const etapas = devAreaSteps(area, previewState, editorUrl);
  const emAndamento = etapas.some((etapa) => etapa.key === "build" && etapa.status === "active");
  const semRepositorio = etapas[0].status === "active";

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium">Área de aprovação</p>
        {!emAndamento && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            disabled={publishing || !canPublish}
            title={
              canPublish
                ? "Grava o workflow no repositório e publica a versão atual na pasta."
                : "Sua chave não tem a permissão de publicar."
            }
            onClick={onPublish}>
            {publishing ? <Loader2 className="size-3 animate-spin" /> : <Rocket className="size-3" />}
            {semRepositorio ? "Já conectei" : "Publicar de novo"}
          </Button>
        )}
      </div>
      <ol className="space-y-1.5">
        {etapas.map((etapa) => {
          const { Icone, classe } = ICONES[etapa.status];
          return (
            <li key={etapa.key} className="flex gap-2 text-xs">
              <Icone className={cn("mt-0.5 size-3.5 shrink-0", classe)} />
              <div className="min-w-0">
                <p className={cn(etapa.status === "waiting" && "text-muted-foreground")}>
                  {etapa.label}
                  {etapa.href && (
                    <>
                      {" · "}
                      <a
                        href={etapa.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {etapa.hrefLabel ?? "abrir"}
                      </a>
                    </>
                  )}
                </p>
                {etapa.detail && (
                  <p
                    className={cn(
                      "text-muted-foreground",
                      etapa.status === "error" && "text-destructive",
                    )}
                  >
                    {etapa.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
