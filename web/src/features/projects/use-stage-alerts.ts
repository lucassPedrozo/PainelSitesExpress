import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Project } from "@/lib/api";
import { projectIdentity } from "@/lib/format";
import { projectStatus, type ProjectStage } from "./project-status";

/**
 * Avisa quando um site termina ou para no Lovable, e quando uma publicação
 * termina — para ninguém precisar ficar olhando o card.
 *
 * Com o painel à vista, o aviso é um toast. Em outra aba, é uma notificação
 * do navegador (se permitida) e um contador no título da aba, que zera quando
 * se volta ao painel.
 */

export type StageAlert = {
  projectId: string;
  title: string;
  body: string;
  tone: "success" | "warning" | "error";
};

/** O que mudou de uma leitura para a outra e merece aviso. */
export function stageAlerts(
  before: ReadonlyMap<string, ProjectStage>,
  projects: Project[],
): StageAlert[] {
  const alerts: StageAlert[] = [];
  for (const project of projects) {
    const anterior = before.get(project.id);
    if (!anterior) continue;
    const { stage, detail } = projectStatus(project);
    if (stage === anterior) continue;
    const nome = projectIdentity(project).label;

    if (anterior === "building") {
      alerts.push(
        stage === "awaiting-input"
          ? { projectId: project.id, title: `Parado no Lovable: ${nome}`, body: detail, tone: "warning" }
          : {
              projectId: project.id,
              title: `Site pronto: ${nome}`,
              body:
                stage === "connect-github"
                  ? "Conecte ao GitHub no Lovable; o painel publica sozinho."
                  : stage === "generated"
                    ? "Falta criar o link do cliente."
                    : detail,
              tone: "success",
            },
      );
    } else if (anterior === "dev-publishing") {
      if (stage === "dev-failed") {
        alerts.push({ projectId: project.id, title: `Prévia falhou: ${nome}`, body: detail, tone: "error" });
      } else if (stage === "ready") {
        alerts.push({ projectId: project.id, title: `Prévia no ar: ${nome}`, body: "O link abre — falta enviar ao cliente.", tone: "success" });
      }
    } else if (anterior === "deploying") {
      if (stage === "live") {
        alerts.push({ projectId: project.id, title: `No ar: ${nome}`, body: `Publicado em ${project.publication?.domain}.`, tone: "success" });
      } else if (stage === "deploy-failed") {
        alerts.push({ projectId: project.id, title: `Publicação falhou: ${nome}`, body: detail, tone: "error" });
      }
    }
  }
  return alerts;
}

/**
 * Pede permissão de notificação. Só funciona dentro de um clique — por isso é
 * chamada ao gerar e ao publicar, os dois momentos em que um aviso depois
 * faz sentido.
 */
export function requestNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // Navegador sem suporte: o toast e o título da aba continuam avisando.
  }
}

function notify(alert: StageAlert) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(alert.title, { body: alert.body, tag: alert.projectId });
    }
  } catch {
    // Idem: sem notificação, sobra o título da aba.
  }
}

export function useStageAlerts(projects: Project[]) {
  const stages = useRef<Map<string, ProjectStage> | null>(null);
  const unseen = useRef(0);
  const baseTitle = useRef(document.title);

  useEffect(() => {
    const atual = new Map(projects.map((p) => [p.id, projectStatus(p).stage]));
    // A primeira leitura só registra: o que já estava assim não é novidade.
    const alerts = stages.current ? stageAlerts(stages.current, projects) : [];
    stages.current = atual;
    if (!alerts.length) return;

    for (const alert of alerts) {
      toast[alert.tone](alert.title, { description: alert.body });
      if (document.hidden) notify(alert);
    }
    if (document.hidden) {
      unseen.current += alerts.length;
      document.title = `(${unseen.current}) ${baseTitle.current}`;
    }
  }, [projects]);

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      unseen.current = 0;
      document.title = baseTitle.current;
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
