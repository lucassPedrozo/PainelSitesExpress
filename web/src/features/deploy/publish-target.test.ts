import { describe, expect, it } from "vitest";
import type { Publication, RepoOption } from "@/lib/api/deploy";
import {
  readyToPublish,
  repoNameOf,
  suggestRepository,
  type PublishTarget,
} from "@/features/deploy/publish-target";

const repo = (name: string): RepoOption => ({
  id: name,
  name,
  owner: "org",
  fullName: `org/${name}`,
  createdAt: "",
  updatedAt: "",
  private: true,
  defaultBranch: "main",
});

const publicacao = (over: Partial<Publication> = {}): Publication => ({
  repoFullName: "org/green-ground-glow",
  domain: "montanhas.com.br",
  branch: "main",
  configuredAt: "2026-09-15T00:00:00Z",
  configuredBy: null,
  deploys: [],
  ...over,
});

const alvo: PublishTarget = {
  projectId: "p",
  projectLabel: "montanhas.com.br",
  domain: "montanhas.com.br",
  repoHints: ["montanhas"],
  boundRepo: null,
  lovableRepoNames: [],
};

describe("repoNameOf", () => {
  it("segue o nome que o GitHub deu aos repositórios do Lovable", () => {
    expect(repoNameOf("SBC Cobranças: Smart Recovery")).toBe("sbc-cobran-as-smart-recovery");
    expect(repoNameOf("Local Manutenção de Elevadores Automotivos")).toBe(
      "local-manuten-o-de-elevadores-automotivos",
    );
    expect(repoNameOf("Pergolado: Crafted Spaces")).toBe("pergolado-crafted-spaces");
    expect(repoNameOf("D&A Precise Logistics")).toBe("d-a-precise-logistics");
  });
});

describe("suggestRepository", () => {
  const repos = [repo("montanhas"), repo("green-ground-glow"), repo("greenspace-pro-2")];

  it("do mais certo para o menos: ligado, publicou o domínio, nome do Lovable, palpite", () => {
    const porDominio = new Map([["montanhas.com.br", publicacao()]]);

    expect(
      suggestRepository(repos, porDominio, { ...alvo, boundRepo: "org/greenspace-pro-2" }),
    ).toEqual({ repo: repos[2], reason: "bound" });
    expect(suggestRepository(repos, porDominio, alvo)).toEqual({
      repo: repos[1],
      reason: "published",
    });
    expect(
      suggestRepository(repos, new Map(), { ...alvo, lovableRepoNames: ["greenspace-pro"] }),
    ).toEqual({ repo: repos[2], reason: "lovable-name" });
    expect(suggestRepository(repos, new Map(), alvo)).toEqual({
      repo: repos[0],
      reason: "guess",
    });
  });

  it("repositório ligado que sumiu da organização não conta", () => {
    expect(
      suggestRepository(repos, new Map(), { ...alvo, boundRepo: "org/apagado" })?.reason,
    ).toBe("guess");
  });
});

describe("readyToPublish", () => {
  const base = {
    canDeploy: true,
    publication: publicacao(),
    domain: "www.montanhas.com.br",
  };

  it("workflow no repositório e o mesmo domínio já configurado: é só disparar, mesmo com versão antiga", () => {
    expect(readyToPublish(base)).toBe(true);
  });

  it("qualquer outra situação pede o formulário", () => {
    expect(readyToPublish({ ...base, canDeploy: false })).toBe(false);
    expect(readyToPublish({ ...base, publication: undefined })).toBe(false);
    expect(readyToPublish({ ...base, domain: "outro.com.br" })).toBe(false);
  });
});
