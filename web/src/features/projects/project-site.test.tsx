import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Generation, Project } from "@/lib/api";
import { ProjectSite } from "@/features/projects/project-site";

/** O endereço que o card mostra: domínio, link do cliente ou editor. */

const geracao = (over: Partial<Generation> = {}): Generation => ({
  id: "gen-1",
  url: null,
  previewUrl: "https://id-preview--abc.lovable.app",
  displayName: "Site do cliente",
  workspaceId: null,
  workspaceName: null,
  attachments: 0,
  promptChars: 0,
  createdAt: "2026-09-04T00:00:00.000Z",
  sharePreviewUrl: null,
  deliveredAt: null,
  deliveredBy: null,
  previewState: "unknown",
  previewDetail: null,
  previewCheckedAt: null,
  shortLinkId: null,
  shortSlug: null,
  shortUrl: null,
  agentState: "done",
  agentCheckedAt: null,
  screenshotUrl: null,
  styleRegistered: false,
  signatureFound: true,
  signatureFixSent: false,
  agentQuestion: null,
  lovableName: null,
  repoFullName: null,
  devArea: null,
  clientUrl: null,
  ...over,
});

const projeto = (g: Generation, over: Partial<Project> = {}): Project =>
  ({
    id: "proj-1",
    name: "[04/09/2026] cliente.com.br",
    alias: null,
    createdTime: "2026-09-04T00:00:00.000Z",
    lastActivity: "2026-09-04T00:00:00.000Z",
    fileCount: 1,
    folderCount: 0,
    totalSize: 10,
    kinds: {},
    tagIds: [],
    generations: [g],
    brief: null,
    webViewLink: "",
    publication: null,
    ...over,
  }) as unknown as Project;

describe("ProjectSite", () => {
  it("mostra o link do cliente quando existe, não o preview interno", () => {
    const g = geracao({
      sharePreviewUrl: "https://lovable.dev/preview/abc12345",
      previewState: "alive",
      shortUrl: "https://formularios.joinvix.com.br/cliente-com-br",
    });
    render(<ProjectSite project={projeto(g)} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://formularios.joinvix.com.br/cliente-com-br",
    );
    // Sem o esquema: o que importa no card é reconhecer o endereço.
    expect(link).toHaveTextContent("formularios.joinvix.com.br/cliente-com-br");
  });

  it("sem link do cliente não mostra nada — o “Criar link” do card cobre", () => {
    const { container } = render(<ProjectSite project={projeto(geracao())} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("no ar, mostra o domínio", () => {
    const p = projeto(geracao(), {
      publication: {
        domain: "cliente.com.br",
        repoFullName: "org/cliente",
        configuredAt: null,
        lastDeployAt: "2026-09-10T00:00:00.000Z",
        lastAttempt: null,
      },
    });
    render(<ProjectSite project={p} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://cliente.com.br");
  });

  it("não renderiza nada quando o projeto não tem site gerado", () => {
    const semSite = { ...projeto(geracao()), generations: [] } as Project;
    const { container } = render(<ProjectSite project={semSite} />);
    expect(container).toBeEmptyDOMElement();
  });
});
