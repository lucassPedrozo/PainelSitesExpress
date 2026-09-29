import type { DevArea, PreviewState } from "@/lib/api";

/**
 * O caminho de um site até o link de aprovação, em três etapas. Antes o modal
 * dizia só "publicando" ou "falhou", e o aviso "o link libera quando a pasta
 * for conferida" não explicava o que faltava nem quem fazia. Aqui cada etapa
 * diz em que pé está e o que acontece em seguida.
 */

export type StepStatus = "done" | "active" | "error" | "waiting";

export type DevAreaStep = {
  key: "repo" | "build" | "check";
  status: StepStatus;
  label: string;
  detail?: string;
  /** Onde acompanhar ou corrigir: o editor do Lovable ou a execução no GitHub. */
  href?: string | null;
  hrefLabel?: string;
};

export function devAreaSteps(
  area: DevArea,
  previewState: PreviewState,
  editorUrl: string | null,
): DevAreaStep[] {
  const run = area.lastRun;
  const semRepositorio = area.state === "waiting-repo" || !area.repoFullName;

  const repo: DevAreaStep = semRepositorio
    ? {
        key: "repo",
        status: "active",
        label: "Conectar o projeto ao GitHub no Lovable",
        detail:
          "O repositório nasce dessa conexão, feita no editor do Lovable. O painel percebe em até 3 minutos e publica sozinho — ou clique em “Já conectei”.",
        href: editorUrl,
        hrefLabel: "abrir no Lovable",
      }
    : {
        key: "repo",
        status: "done",
        label: `Repositório ${area.repoFullName}`,
      };

  let build: DevAreaStep;
  if (semRepositorio) {
    build = { key: "build", status: "waiting", label: "Build e envio para a pasta" };
  } else if (run?.status === "failure") {
    build = {
      key: "build",
      status: "error",
      label: "O build ou o envio falhou",
      detail: area.detail ?? undefined,
      href: run.runUrl,
      hrefLabel: "ver no GitHub",
    };
  } else if (run?.status === "unknown") {
    build = {
      key: "build",
      status: "error",
      label: "O GitHub não iniciou a publicação",
      detail: area.detail ?? undefined,
    };
  } else if (run?.status === "success") {
    build = {
      key: "build",
      status: "done",
      label: "Build e envio concluídos",
      href: run.runUrl,
      hrefLabel: "ver no GitHub",
    };
  } else {
    build = {
      key: "build",
      status: "active",
      label: "Gerando o site e enviando para a pasta",
      detail: "No GitHub, leva de 1 a 5 minutos.",
      href: run?.runUrl ?? null,
      hrefLabel: "acompanhar",
    };
  }

  let check: DevAreaStep;
  if (area.state === "live" && previewState === "alive") {
    check = {
      key: "check",
      status: "done",
      label: "Link conferido — pronto para enviar ao cliente",
    };
  } else if (area.publishedSha && previewState === "dead") {
    check = {
      key: "check",
      status: "error",
      label: "A pasta não abre",
      detail: "Verifique o link; se continuar fora, publique de novo.",
    };
  } else if (run?.status === "success") {
    check = {
      key: "check",
      status: "active",
      label: "Conferindo se a pasta tem esta versão",
      detail: area.detail ?? "O painel lê a pasta a cada 15 segundos até a versão nova aparecer.",
    };
  } else {
    check = {
      key: "check",
      status: "waiting",
      label: "Conferir o link",
      detail: area.publishedSha
        ? "Enquanto isso, o link segue com a versão anterior."
        : "O painel abre a pasta ao fim do envio e só então libera o envio ao cliente.",
    };
  }

  return [repo, build, check];
}
