import { describe, expect, it } from "vitest";
import {
  describeMaterial,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDay,
  formatElapsed,
  formatUsd,
  formatWhen,
  plural,
  pluralize,
  projectIdentity,
  timeOf,
} from "./format";

// Datas montadas no fuso local: o teste vale em qualquer máquina.
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const AGORA = local(2026, 10, 14, 10, 0);

describe("formatWhen — a regra única de data", () => {
  it("relativa até 7 dias", () => {
    expect(formatWhen(AGORA - 20_000, AGORA)).toBe("agora");
    expect(formatWhen(AGORA - 12 * 60_000, AGORA)).toBe("há 12 min");
    expect(formatWhen(AGORA - 4 * 3_600_000, AGORA)).toBe("há 4 h");
    expect(formatWhen(local(2026, 10, 14, 1, 5), AGORA)).toBe("hoje, 01:05");
    expect(formatWhen(local(2026, 10, 13, 18, 20), AGORA)).toBe("ontem, 18:20");
    expect(formatWhen(local(2026, 10, 11, 9, 0), AGORA)).toBe("há 3 dias");
    expect(formatWhen(local(2026, 10, 7, 9, 0), AGORA)).toBe("há 7 dias");
  });

  it("absoluta depois de 7 dias, com o ano só quando é outro", () => {
    expect(formatWhen(local(2026, 10, 6, 9, 0), AGORA)).toBe("06/10");
    expect(formatWhen(local(2025, 12, 30, 9, 0), AGORA)).toBe("30/12/2025");
  });

  it("só o dia, para marcos (o caminho do projeto): sem hora e sem relativo", () => {
    expect(formatDay(local(2026, 10, 13, 18, 20), AGORA)).toBe("13/10");
    expect(formatDay(local(2025, 9, 29, 9, 0), AGORA)).toBe("29/09/2025");
    expect(formatDay(null, AGORA)).toBe("—");
    expect(formatDay("não é data", AGORA)).toBe("—");
  });

  it("conta dias de calendário: logo depois da meia-noite, a noite anterior é ontem", () => {
    const madrugada = local(2026, 10, 14, 0, 30);
    // Até 6 h vale a conta curta, mesmo virando o dia…
    expect(formatWhen(local(2026, 10, 13, 23, 0), madrugada)).toBe("há 1 h");
    // …e depois disso, o dia do calendário: a tarde de ontem é ontem.
    expect(formatWhen(local(2026, 10, 13, 17, 0), madrugada)).toBe("ontem, 17:00");
    expect(formatWhen(local(2026, 10, 12, 23, 0), madrugada)).toBe("há 2 dias");
  });

  it("relógio adiantado: poucos minutos valem como agora; mais que isso, a data", () => {
    expect(formatWhen(AGORA + 2 * 60_000, AGORA)).toBe("agora");
    expect(formatWhen(local(2026, 11, 2, 9, 0), AGORA)).toBe("02/11");
  });

  it("dado ausente ou inválido vira travessão, nunca NaN nem Invalid Date", () => {
    for (const valor of [null, undefined, "", "não é data"]) {
      expect(formatWhen(valor, AGORA)).toBe("—");
      expect(formatDate(valor)).toBe("—");
      expect(formatDateTime(valor)).toBe("—");
    }
    expect(timeOf("2026-13-45")).toBeNull();
  });

  it("formato completo, para o tooltip", () => {
    expect(formatDate(local(2026, 10, 14))).toBe("14/10/2026");
    expect(formatDateTime(local(2026, 10, 14, 9, 5))).toBe("14/10/2026, 09:05");
  });
});

describe("durações, tamanhos e plurais", () => {
  it("duração com horas, e travessão sem número", () => {
    expect(formatElapsed(45_000)).toBe("45 s");
    expect(formatElapsed(192_000)).toBe("3 min 12 s");
    expect(formatElapsed(3_900_000)).toBe("1 h 05 min");
    expect(formatElapsed(Number.NaN)).toBe("—");
    expect(formatElapsed(-5_000)).toBe("0 s");
  });

  it("tamanho com vírgula; zero não vira 0 B", () => {
    expect(formatBytes(1536 * 1024)).toBe("1,5 MB");
    expect(formatBytes(640 * 1024)).toBe("640 KB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("moeda no formato daqui", () => {
    expect(formatUsd(0.42).replace(/\s/g, " ")).toBe("US$ 0,42");
  });

  it("plural sem '(s)', com número e só a palavra", () => {
    expect(pluralize(1, "projeto")).toBe("1 projeto");
    expect(pluralize(1240, "arquivo")).toBe("1.240 arquivos");
    expect(pluralize(2, "sessão", "sessões")).toBe("2 sessões");
    expect(plural(1, "tem", "têm")).toBe("tem");
    expect(plural(3, "tem", "têm")).toBe("têm");
  });

  it("o material numa linha: pasta vazia, volume só quando há, subpastas só quando existem", () => {
    expect(describeMaterial({ fileCount: 0, folderCount: 0, totalSize: 0 })).toBe("Pasta vazia");
    expect(describeMaterial({ fileCount: 3, folderCount: 0, totalSize: 0 })).toBe("3 arquivos");
    expect(describeMaterial({ fileCount: 1, folderCount: 2, totalSize: 2048 })).toBe("1 arquivo · 2,0 KB · 2 subpastas");
  });
});

describe("projectIdentity — o que a equipe corrigiu vence o nome da pasta", () => {
  const pasta = { name: "[29/09/2026] Aurora Engenharia", alias: null };

  it("sem correção, domínio e data vêm do nome da pasta", () => {
    const id = projectIdentity(pasta);
    expect([id.label, id.domain]).toEqual(["Aurora Engenharia", null]);
    expect(id.collectedAt?.getDate()).toBe(29);
  });

  it("o domínio corrigido vira o título, e a data corrigida vence a do nome", () => {
    const id = projectIdentity({ ...pasta, details: { domain: "aurora.eng.br", receivedAt: "2026-10-01T15:00:00.000Z" } });
    expect([id.label, id.domain]).toEqual(["aurora.eng.br", "aurora.eng.br"]);
    expect(id.collectedAt?.toISOString()).toBe("2026-10-01T15:00:00.000Z");
  });

  it("com apelido, o apelido segue no título e o domínio corrigido alimenta a publicação", () => {
    const id = projectIdentity({ ...pasta, alias: "Aurora", details: { domain: "aurora.eng.br" } });
    expect([id.label, id.domain, id.renamed]).toEqual(["Aurora", "aurora.eng.br", true]);
  });
});
