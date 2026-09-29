import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/api";

/**
 * A lista de projetos com o cache de consultas: uma busca só para vários
 * leitores, escrita otimista e desfazimento quando a API recusa. Sem isto,
 * a única prova da escrita otimista seria clicar na tela.
 */

const fetchProjects = vi.fn();
const setProjectTags = vi.fn();
const fetchTags = vi.fn();

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchProjects: (...args: unknown[]) => fetchProjects(...args),
  setProjectTags: (...args: unknown[]) => setProjectTags(...args),
  fetchTags: () => fetchTags(),
}));

const { createQueryClient } = await import("@/lib/query");
const { useProjectList } = await import("@/features/projects/use-project-list");
const { useTags } = await import("@/features/tags/use-tags");

const projeto = (id: string, tagIds: string[] = []): Project =>
  ({
    id,
    name: `[04/09/2026] ${id}.com.br`,
    alias: null,
    createdTime: "2026-09-04T00:00:00.000Z",
    modifiedTime: "2026-09-04T00:00:00.000Z",
    lastActivity: "2026-09-04T00:00:00.000Z",
    fileCount: 1,
    folderCount: 0,
    totalSize: 100,
    kinds: {},
    tagIds,
    generations: [],
    brief: null,
    webViewLink: "",
    description: null,
    owner: null,
    publication: null,
    domain: `${id}.com.br`,
    domainCollections: 1,
  }) as Project;

const resposta = (projects: Project[]) => ({
  projects,
  fetchedAt: "2026-09-17T12:00:00.000Z",
});

const tagsResposta = {
  tags: [
    { id: "t1", name: "A avaliar", color: "amber", createdAt: "", projectCount: 1 },
    { id: "t2", name: "Aprovado", color: "emerald", createdAt: "", projectCount: 0 },
  ],
  colors: [],
  finishedTagId: null,
};

/** Um cliente por teste: cache de um caso não pode vazar para o outro. */
const wrapper = () => {
  const client = createQueryClient();
  // Mantém os padrões do painel (inclusive o `staleTime`) e só tira a
  // repetição, para o teste de falha não esperar as tentativas.
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

const renderLista = () => {
  const Wrapper = wrapper();
  return renderHook(
    () => {
      const tags = useTags();
      return { lista: useProjectList(tags), tags };
    },
    { wrapper: Wrapper },
  );
};

describe("useProjectList com cache de consultas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTags.mockResolvedValue(tagsResposta);
    fetchProjects.mockResolvedValue(resposta([projeto("alfa", ["t1"])]));
    setProjectTags.mockResolvedValue({ tagIds: ["t2"] });
  });

  it("carrega os projetos uma vez, mesmo com dois leitores", async () => {
    const Wrapper = wrapper();
    const { result } = renderHook(
      () => {
        const tags = useTags();
        // Dois componentes pedindo a mesma lista — o caso real do painel.
        useProjectList(tags);
        return useProjectList(tags);
      },
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toHaveLength(1);
    expect(fetchProjects).toHaveBeenCalledTimes(1);
  });

  it("aplica a tag na hora e mantém quando a API confirma", async () => {
    const { result } = renderLista();
    await waitFor(() => expect(result.current.lista.loading).toBe(false));

    await act(async () => {
      await result.current.lista.applyTags(result.current.lista.projects[0], ["t2"]);
    });

    expect(setProjectTags).toHaveBeenCalledWith("alfa", ["t2"]);
    // O cache avisa os leitores no tique seguinte à escrita.
    await waitFor(() =>
      expect(result.current.lista.projects[0].tagIds).toEqual(["t2"]),
    );
    // O contador das tags acompanha a troca, sem recarregar a lista.
    expect(result.current.tags.byId.get("t1")?.projectCount).toBe(0);
    expect(result.current.tags.byId.get("t2")?.projectCount).toBe(1);
  });

  it("desfaz a aplicação quando a API recusa", async () => {
    setProjectTags.mockRejectedValue(new Error("sem permissão"));
    const { result } = renderLista();
    await waitFor(() => expect(result.current.lista.loading).toBe(false));

    await act(async () => {
      await result.current.lista.applyTags(result.current.lista.projects[0], ["t2"]);
    });

    await waitFor(() =>
      expect(result.current.lista.projects[0].tagIds).toEqual(["t1"]),
    );
    expect(result.current.tags.byId.get("t1")?.projectCount).toBe(1);
    expect(result.current.tags.byId.get("t2")?.projectCount).toBe(0);
  });

  it("atualizar relê o Drive e troca a lista em cache", async () => {
    const { result } = renderLista();
    await waitFor(() => expect(result.current.lista.loading).toBe(false));

    fetchProjects.mockResolvedValue(
      resposta([projeto("alfa", ["t1"]), projeto("beta", ["t1"])]),
    );
    await act(async () => {
      await result.current.lista.load(true);
    });

    expect(fetchProjects).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(result.current.lista.projects).toHaveLength(2));
  });

  it("uma tag excluída some dos projetos já carregados", async () => {
    const { result } = renderLista();
    await waitFor(() => expect(result.current.lista.loading).toBe(false));

    act(() => result.current.lista.forgetTag("t1"));
    await waitFor(() =>
      expect(result.current.lista.projects[0].tagIds).toEqual([]),
    );
  });

  it("erro na carga aparece na tela em vez de lista vazia silenciosa", async () => {
    fetchProjects.mockRejectedValue(new Error("API local não respondeu"));
    const { result } = renderLista();

    await waitFor(() => expect(result.current.lista.error).toBeTruthy());
    expect(result.current.lista.error).toMatch(/não respondeu/);
  });
});
