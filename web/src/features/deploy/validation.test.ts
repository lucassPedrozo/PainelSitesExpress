import { describe, expect, it } from "vitest";
import type { PublicationSettings } from "@/lib/api/deploy";
import {
  advancedFilledCount,
  hasAdvancedError,
  serverErrorField,
  validateSettings,
} from "./validation";

/**
 * Estas regras espelham os validadores da API. O que elas evitam é concreto:
 * sem elas, um erro de digitação só aparecia depois da ida ao servidor, num
 * toast que não dizia qual campo recusar.
 */

const validos: PublicationSettings = {
  domain: "meucliente.com.br",
  ftpServer: "ftp.hospedagem.com.br",
  ftpLogin: "usuario",
  ftpPassword: "senha",
  serverDir: "",
  protocol: "auto",
  port: "",
  autoDeploy: false,
  buildEnv: "",
  clearBuildEnv: false,
};

const validar = (over: Partial<PublicationSettings> = {}, hasRepo = true) =>
  validateSettings({ ...validos, ...over }, { hasRepo });

describe("validateSettings — campos obrigatórios", () => {
  it("aceita o conjunto mínimo", () => {
    expect(validar()).toEqual({});
  });

  it("exige repositório, domínio, servidor, login e senha", () => {
    expect(validar({}, false).repo).toBeTruthy();
    expect(validar({ domain: "  " }).domain).toBeTruthy();
    expect(validar({ ftpServer: "" }).ftpServer).toBeTruthy();
    expect(validar({ ftpLogin: "" }).ftpLogin).toBeTruthy();
    expect(validar({ ftpPassword: "" }).ftpPassword).toBeTruthy();
  });
});

describe("validateSettings — domínio e host", () => {
  it("recusa domínio com protocolo ou caminho", () => {
    expect(validar({ domain: "https://meucliente.com.br" }).domain).toBeTruthy();
    expect(validar({ domain: "meucliente.com.br/loja" }).domain).toBeTruthy();
    expect(validar({ domain: "semponto" }).domain).toBeTruthy();
  });

  it("recusa host FTP com esquema ou barra", () => {
    expect(validar({ ftpServer: "ftp://x.com.br" }).ftpServer).toBeTruthy();
    expect(validar({ ftpServer: "x.com.br/pasta" }).ftpServer).toBeTruthy();
  });

  it("aceita subdomínio e host simples", () => {
    expect(validar({ domain: "loja.meucliente.com.br" }).domain).toBeUndefined();
    expect(validar({ ftpServer: "haven.joinvix.com.br" }).ftpServer).toBeUndefined();
  });
});

describe("validateSettings — porta", () => {
  it("aceita vazio e a faixa válida", () => {
    expect(validar({ port: "" }).port).toBeUndefined();
    expect(validar({ port: "21" }).port).toBeUndefined();
    expect(validar({ port: "65535" }).port).toBeUndefined();
  });

  it("recusa fora da faixa — o que o regex de dígitos deixava passar", () => {
    expect(validar({ port: "0" }).port).toBeTruthy();
    expect(validar({ port: "99999" }).port).toBeTruthy();
  });

  it("recusa o que não é número", () => {
    expect(validar({ port: "21a" }).port).toBeTruthy();
    expect(validar({ port: "-1" }).port).toBeTruthy();
  });
});

describe("validateSettings — pasta remota", () => {
  it("aceita vazio, cPanel e o padrão da Hostinger", () => {
    expect(validar({ serverDir: "" }).serverDir).toBeUndefined();
    expect(validar({ serverDir: "public_html" }).serverDir).toBeUndefined();
    expect(
      validar({ serverDir: "domains/x.com.br/public_html" }).serverDir,
    ).toBeUndefined();
  });

  it("recusa travessia de diretório e caracteres que a API rejeita", () => {
    expect(validar({ serverDir: "../etc" }).serverDir).toBeTruthy();
    expect(validar({ serverDir: "pasta com espaço" }).serverDir).toBeTruthy();
    expect(validar({ serverDir: "pasta/ção" }).serverDir).toBeTruthy();
  });
});

describe("validateSettings — variáveis de build", () => {
  it("aceita CHAVE=valor, comentário e linha vazia", () => {
    expect(
      validar({ buildEnv: "# comentário\nVITE_A=1\n\nVITE_B=2" }).buildEnv,
    ).toBeUndefined();
  });

  it("recusa linha sem igual, e diz qual", () => {
    const erro = validar({ buildEnv: "VITE_A=1\nlinha invalida" }).buildEnv;
    expect(erro).toContain("linha invalida");
  });

  it("recusa chave que não começa por letra ou sublinhado", () => {
    expect(validar({ buildEnv: "1CHAVE=x" }).buildEnv).toBeTruthy();
  });
});

describe("hasAdvancedError", () => {
  it("reconhece erro escondido atrás do acordeão", () => {
    expect(hasAdvancedError(validar({ port: "0" }))).toBe(true);
    expect(hasAdvancedError(validar({ serverDir: "../x" }))).toBe(true);
    // Erro em campo visível não deve abrir a seção avançada.
    expect(hasAdvancedError(validar({ domain: "x" }))).toBe(false);
  });
});

describe("advancedFilledCount", () => {
  it("conta só o que foi preenchido", () => {
    expect(advancedFilledCount(validos)).toBe(0);
    expect(
      advancedFilledCount({ ...validos, serverDir: "public_html", port: "21" }),
    ).toBe(2);
    // `auto` é o padrão: não conta como escolha.
    expect(advancedFilledCount({ ...validos, protocol: "auto" })).toBe(0);
    expect(advancedFilledCount({ ...validos, protocol: "ftps" })).toBe(1);
  });
});

describe("serverErrorField", () => {
  it("devolve o erro da API ao campo de origem", () => {
    expect(serverErrorField("Domínio inválido.")).toBe("domain");
    expect(serverErrorField("Servidor FTP inválido.")).toBe("ftpServer");
    expect(serverErrorField("Login FTP é obrigatório.")).toBe("ftpLogin");
    expect(serverErrorField("Senha FTP é obrigatório.")).toBe("ftpPassword");
    expect(serverErrorField("Pasta remota inválida.")).toBe("serverDir");
    expect(serverErrorField("Porta FTP inválida.")).toBe("port");
    expect(serverErrorField('Variável de build inválida: "x".')).toBe("buildEnv");
  });

  it("não inventa campo para erro que não é de campo", () => {
    expect(serverErrorField("Token do GitHub inválido.")).toBeUndefined();
    expect(serverErrorField("Branch inválida.")).toBeUndefined();
  });
});
