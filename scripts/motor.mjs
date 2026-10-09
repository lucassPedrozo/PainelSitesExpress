#!/usr/bin/env node
/**
 * Roda um comando do npm dentro do pacote do motor Claude (`joinvixable/`).
 *
 *   node scripts/motor.mjs install          instala as dependências do pacote
 *   node scripts/motor.mjs run test         roda os testes dele
 *   node scripts/motor.mjs run typecheck    confere os tipos
 *
 * O pacote não mora neste repositório: tem prompts, seções e template, que são
 * conhecimento interno, e vive num repositório privado clonado nessa pasta.
 * Onde ele não existe — um clone público, o CI sem a chave de leitura — o
 * passo é pulado com aviso, e o resto da verificação do painel segue valendo.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const PASTA = "joinvixable";
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Uso: node scripts/motor.mjs <comando do npm> [argumentos]");
  process.exit(2);
}

if (!existsSync(join(RAIZ, PASTA, "package.json"))) {
  console.log(`[motor] ${PASTA}/ não está nesta cópia: "npm ${args.join(" ")}" pulado.`);
  process.exit(0);
}

// `shell` porque no Windows o npm é um .cmd; a pasta vai relativa à raiz, sem
// espaço no caminho, e os argumentos vêm do package.json — nunca de fora.
const resultado = spawnSync("npm", ["--prefix", PASTA, ...args], {
  cwd: RAIZ,
  stdio: "inherit",
  shell: true,
});
if (resultado.error) {
  console.error(`[motor] não consegui rodar o npm: ${resultado.error.message}`);
  process.exit(1);
}
process.exit(resultado.status ?? 1);
