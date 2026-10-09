#!/usr/bin/env node
/**
 * Traz o histórico de layouts do Joinvixable antigo para o motor Claude do
 * painel.
 *
 *   node scripts/importar-historico.mjs "<pasta do Joinvixable antigo>"
 *
 * O motor não repete o estilo dos dois últimos sites, e sabe quais foram por
 * `.history/layouts.jsonl`. No painel esse arquivo fica na pasta de trabalho
 * do motor, dentro da pasta de dados — que nasce vazia.
 *
 * Só copia: a pasta de origem não é alterada, e o que já está no painel
 * continua lá. Rodar duas vezes não duplica nada. Não imprime o conteúdo do
 * histórico, só a contagem.
 */
import path from "node:path";
import { config } from "../server/src/config.js";
import { importarHistorico } from "../server/src/engines/claude/history.js";
import { caminhosDoMotor } from "../server/src/engines/claude/workspace.js";

const origem = process.argv[2];
if (!origem) {
  console.error('Uso: node scripts/importar-historico.mjs "<pasta do Joinvixable antigo>"');
  process.exit(2);
}

try {
  const { trabalho } = caminhosDoMotor({
    dataDir: config.dataDir,
    dirMotor: path.join(config.projectRoot, "joinvixable"),
  });
  const r = importarHistorico({ origem: path.resolve(origem), trabalho });
  console.log(`Histórico de layouts: ${r.trazidas} site(s) trazido(s), ${r.repetidas} já estava(m) no painel.`);
  if (r.invalidas) console.log(`  ${r.invalidas} linha(s) da origem não eram um registro em JSON e ficaram de fora.`);
  console.log(`  O painel tem agora ${r.total} site(s) no histórico, em ${r.arquivo}`);
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
}
