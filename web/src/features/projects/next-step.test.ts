import { describe, expect, it } from "vitest";
import type { Generation, Project, ProjectPublication } from "@/lib/api";
import { lovableEditorUrl, nextStep } from "@/features/projects/next-step";
import { projectStatus } from "@/features/projects/project-status";

/** Cada etapa pede uma ação — e o botão do card é essa ação. */

const geracao = (over: Partial<Generation> = {}): Generation =>
  ({
    id: "gen-1",
    url: null,
    sharePreviewUrl: null,
    shortUrl: null,
    deliveredAt: null,
    previewState: "unknown",
    agentState: "done",
    ...over,
  }) as unknown as Generation;

const projeto = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    name: "[04/09/2026] cliente.com.br",
    alias: null,
    fileCount: 3,
    folderCount: 0,
    generations: [],
    brief: null,
    publication: null,
    webViewLink: "https://drive/pasta",
    ...over,
  }) as unknown as Project;

const publicacao = (over: Partial<ProjectPublication> = {}): ProjectPublication => ({
  domain: "cliente.com.br",
  repoFullName: "org/cliente",
  configuredAt: null,
  lastDeployAt: null,
  lastAttempt: null,
  ...over,
});

describe("nextStep", () => {
  it("antes do site: gerar; pasta vazia: abrir o Drive", () => {
    expect(nextStep(projeto()).kind).toBe("generate");
    expect(nextStep(projeto({ fileCount: 0 }))).toEqual({
      kind: "link",
      label: "Abrir no Drive",
      href: "https://drive/pasta",
    });
  });

  it("site gerado sem link: criar o link no editor do Lovable", () => {
    expect(nextStep(projeto({ generations: [geracao()] }))).toEqual({
      kind: "create-link",
      label: "Criar link",
      href: "https://lovable.dev/projects/gen-1",
    });
  });

  it("link colado mas não conferido: verificar", () => {
    const g = geracao({ sharePreviewUrl: "https://lovable.dev/preview/x", shortUrl: "https://s/x" });
    expect(nextStep(projeto({ generations: [g] })).kind).toBe("verify-link");
  });

  it("link que abre: enviar ao cliente; entregue: publicar", () => {
    const aberto = geracao({ shortUrl: "https://s/x", previewState: "alive" });
    expect(nextStep(projeto({ generations: [aberto] })).kind).toBe("send");

    const entregue = { ...aberto, deliveredAt: "2026-09-10T00:00:00.000Z" };
    expect(nextStep(projeto({ generations: [entregue] })).kind).toBe("publish");
  });

  it("link que caiu, entregue ou não: criar outro", () => {
    const morto = geracao({ sharePreviewUrl: "https://lovable.dev/preview/x", previewState: "dead" });
    expect(nextStep(projeto({ generations: [morto] })).label).toBe("Novo link");
    expect(
      nextStep(projeto({ generations: [{ ...morto, deliveredAt: "2026-09-10T00:00:00.000Z" }] }))
        .label,
    ).toBe("Novo link");
  });

  it("agente parado: responder pelo painel", () => {
    const g = geracao({ agentState: "awaiting" });
    expect(nextStep(projeto({ generations: [g] }))).toEqual({
      kind: "reply",
      label: "Responder",
    });
  });

  it("publicação: acompanhar, ver erro ou abrir o site", () => {
    const pendente = publicacao({
      lastAttempt: { at: "t", status: "pending", runUrl: null },
    });
    expect(nextStep(projeto({ publication: pendente }))).toEqual({
      kind: "link",
      label: "Acompanhar",
      href: null,
    });

    const falhou = publicacao({
      lastAttempt: { at: "t", status: "failure", runUrl: "https://gh/run/1" },
    });
    expect(nextStep(projeto({ publication: falhou }))).toEqual({
      kind: "link",
      label: "Ver erro",
      href: "https://gh/run/1",
    });

    const noAr = publicacao({ lastDeployAt: "t" });
    expect(nextStep(projeto({ publication: noAr }))).toEqual({
      kind: "link",
      label: "Abrir site",
      href: "https://cliente.com.br",
    });
  });
});

describe("nextStep — área de desenvolvimento", () => {
  const comArea = (devArea: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    projeto({ generations: [geracao({ devArea, ...over } as never)] });

  it("sem repositório, leva ao editor do Lovable para conectar o GitHub", () => {
    expect(nextStep(comArea({ state: "waiting-repo", lastRun: null }))).toEqual({
      kind: "link",
      label: "Conectar GitHub",
      href: "https://lovable.dev/projects/gen-1",
    });
  });

  it("publicando ou com erro, leva à execução no GitHub", () => {
    const execucao = { at: "t", status: "failure", runUrl: "https://gh/run/7", sha: null };
    expect(nextStep(comArea({ state: "failed", lastRun: execucao }))).toEqual({
      kind: "link",
      label: "Ver erro",
      href: "https://gh/run/7",
    });
    expect(nextStep(comArea({ state: "publishing", lastRun: { ...execucao, status: "pending" } }))).toEqual({
      kind: "link",
      label: "Acompanhar",
      href: "https://gh/run/7",
    });
  });

  it("link da pasta caído pede conferência, não um Share preview novo", () => {
    const passo = nextStep(
      comArea(
        { state: "live", publishedSha: "abc", lastRun: null },
        { clientUrl: "https://area.dev/x/", previewState: "dead" },
      ),
    );
    expect(passo).toEqual({ kind: "verify-link", label: "Verificar link" });
  });
});

describe("site vinculado de fora do painel", () => {
  it("sem link, o próximo passo é publicar a prévia — não criar Share preview", () => {
    const externo = projeto({ generations: [geracao({ id: "ext-abc123", origin: "linked" })] });
    expect(nextStep(externo)).toEqual({ kind: "approval", label: "Publicar prévia" });
    expect(projectStatus(externo).label).toBe("Site vinculado");
    // Sem projeto no Lovable, não há editor a abrir.
    expect(lovableEditorUrl(externo)).toBeNull();
  });

  it("do Lovable, vinculado: o editor continua disponível", () => {
    const doLovable = projeto({
      generations: [geracao({ id: "00000000-0000-4000-8000-00000000abcd", origin: "linked" })],
    });
    expect(lovableEditorUrl(doLovable)).toBe("https://lovable.dev/projects/00000000-0000-4000-8000-00000000abcd");
    expect(nextStep(doLovable).kind).toBe("approval");
  });

  it("declarado como enviado ao cliente: o próximo passo é publicar no domínio", () => {
    const entregue = projeto({
      generations: [geracao({ id: "ext-abc123", origin: "linked", deliveredAt: "2026-09-28T10:00:00Z" })],
    });
    expect(projectStatus(entregue).stage).toBe("delivered");
    expect(nextStep(entregue)).toEqual({ kind: "publish", label: "Publicar" });
  });
});
