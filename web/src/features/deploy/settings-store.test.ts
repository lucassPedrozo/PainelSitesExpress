import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings-store";

const STORAGE_KEY = "sites-express-deploy-settings-v1";

describe("settings-store", () => {
  beforeEach(() => localStorage.clear());

  it("não grava as variáveis de build no navegador", () => {
    saveSettings("org/site", {
      domain: "site.com.br",
      ftpServer: "ftp.site.com.br",
      ftpLogin: "usuario",
      serverDir: "",
      protocol: "auto",
      port: "",
      autoDeploy: false,
      // Chega aqui por engano de tipo em código antigo: tem de ser descartado.
      ...({ buildEnv: "VITE_API_KEY=segredo" } as object),
    });

    expect(localStorage.getItem(STORAGE_KEY)).not.toContain("segredo");
    expect(loadSettings("org/site")).not.toHaveProperty("buildEnv");
  });

  it("apaga o buildEnv gravado por versões anteriores na primeira leitura", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastFtpServer: "ftp.antigo.com.br",
        repositories: {
          "org/site": {
            domain: "site.com.br",
            ftpServer: "ftp.site.com.br",
            buildEnv: "VITE_SUPABASE_ANON_KEY=chave-antiga",
          },
        },
      }),
    );

    const loaded = loadSettings("org/site");

    expect(loaded.domain).toBe("site.com.br");
    expect(loaded).not.toHaveProperty("buildEnv");
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain("chave-antiga");
    expect(localStorage.getItem(STORAGE_KEY)).toContain("ftp.antigo.com.br");
  });
});
