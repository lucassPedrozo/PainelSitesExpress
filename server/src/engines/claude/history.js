import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * O histórico de layouts do motor Claude, trazido da ferramenta antiga.
 *
 * O motor não repete o estilo dos dois últimos sites — arquétipo com as mesmas
 * fontes, a moldura, a abertura, o movimento — e sabe quais foram por
 * `.history/layouts.jsonl`, uma linha de JSON por site, da mais antiga para a
 * mais nova. No painel esse arquivo mora na pasta de trabalho do motor, que
 * nasce vazia: sem trazer o histórico de antes, o primeiro site gerado aqui
 * poderia sair igual ao último feito no Joinvixable.
 *
 * Só copia. A pasta de origem não é alterada.
 */

const ARQUIVO = path.join(".history", "layouts.jsonl");

const linhasDe = (texto) =>
  String(texto ?? "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

/**
 * Junta o histórico de origem ao que o painel já tem. O de origem é mais
 * antigo, então vai na frente: a ordem é o que diz quais são "os dois
 * últimos". Linha que já está no destino não entra de novo, e linha que não é
 * JSON fica de fora.
 *
 * @param {string} origem o conteúdo do arquivo de origem
 * @param {string} destino o conteúdo do arquivo do painel (vazio se não existe)
 * @returns {{ texto: string, trazidas: number, repetidas: number, invalidas: number }}
 */
export function mesclarHistorico(origem, destino) {
  const atuais = linhasDe(destino);
  const jaTem = new Set(atuais);
  const novas = [];
  let repetidas = 0;
  let invalidas = 0;
  for (const linha of linhasDe(origem)) {
    try {
      const registro = JSON.parse(linha);
      if (!registro || typeof registro !== "object" || Array.isArray(registro)) throw new Error("não é um registro");
    } catch {
      invalidas += 1;
      continue;
    }
    if (jaTem.has(linha)) {
      repetidas += 1;
      continue;
    }
    jaTem.add(linha);
    novas.push(linha);
  }
  const todas = [...novas, ...atuais];
  return { texto: todas.length ? `${todas.join("\n")}\n` : "", trazidas: novas.length, repetidas, invalidas };
}

/**
 * Copia o histórico de uma pasta do Joinvixable para a pasta de trabalho do
 * motor.
 *
 * @param {{ origem: string, trabalho: string }} params `origem`: a raiz da
 *   ferramenta antiga; `trabalho`: a pasta de trabalho do motor no painel
 * @returns {{ arquivo: string, trazidas: number, repetidas: number, invalidas: number, total: number }}
 */
export function importarHistorico({ origem, trabalho }) {
  const deOnde = path.join(origem, ARQUIVO);
  if (!existsSync(deOnde)) {
    throw new Error(`Não há histórico de layouts em ${origem} (esperava ${ARQUIVO}).`);
  }
  const paraOnde = path.join(trabalho, ARQUIVO);
  const resultado = mesclarHistorico(
    readFileSync(deOnde, "utf8"),
    existsSync(paraOnde) ? readFileSync(paraOnde, "utf8") : "",
  );
  if (resultado.trazidas > 0) {
    mkdirSync(path.dirname(paraOnde), { recursive: true });
    // Gravado ao lado e trocado de uma vez: o motor nunca lê um arquivo pela metade.
    const temporario = `${paraOnde}.${process.pid}.tmp`;
    writeFileSync(temporario, resultado.texto, "utf8");
    renameSync(temporario, paraOnde);
  }
  const { texto, ...contagem } = resultado;
  return { arquivo: paraOnde, ...contagem, total: linhasDe(texto).length };
}
