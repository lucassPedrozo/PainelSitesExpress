import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api";
import { clientMessage } from "@/features/projects/client-delivery";

describe("clientMessage", () => {
  it("leva o nome do projeto e o link curto, pronto para colar no WhatsApp", () => {
    const projeto = {
      name: "[04/09/2026] cliente.com.br",
      alias: null,
    } as unknown as Project;
    const texto = clientMessage(projeto, "https://formularios.joinvix.com.br/cliente");

    expect(texto).toContain("cliente.com.br");
    expect(texto.split("\n")[1]).toBe("https://formularios.joinvix.com.br/cliente");
  });
});
