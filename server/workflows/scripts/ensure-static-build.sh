# Garante build estatico nos projetos TanStack Start do Lovable.
#
# O template do Lovable compila com Nitro para Cloudflare Workers: o build
# gera .output/server e nenhum HTML, e nao ha o que enviar por FTP. Antes a
# saida era converter o vite.config.ts a mao, no repositorio, site por site —
# e todo site novo falhava na primeira publicacao. Aqui a conversao acontece
# so no runner, sem commit: `nitro: false` e `spa: { enabled: true }`.
#
# Projeto que ja declara `spa`, `prerender` ou `nitro` fica como esta: alguem
# ja escolheu como ele sai estatico, e a escolha dele vale.
set -euo pipefail

node --input-type=module <<'NODE'
import fs from "node:fs";

const candidatos = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];
const arquivo = candidatos.find((nome) => fs.existsSync(nome));
if (!arquivo) {
  console.log("Sem vite.config: nada a converter.");
  process.exit(0);
}

const original = fs.readFileSync(arquivo, "utf8");
if (!original.includes("@lovable.dev/vite-tanstack-config")) {
  console.log(`${arquivo} nao usa a configuracao TanStack do Lovable: nada a converter.`);
  process.exit(0);
}
// So o template padrao, intocado, e convertido. `spa`, `prerender` ou `nitro`
// declarados sao uma escolha de alguem: ha sites que ja saem estaticos por
// pre-renderizacao de cada rota (melhor para SEO), com um pos-build proprio
// que espera essa saida. Ligar o SPA por cima deles quebraria o que funciona.
const escolha = original.match(/\b(spa|prerender|nitro)\s*:/);
if (escolha) {
  console.log(`${arquivo} ja declara "${escolha[1]}": configuracao do projeto mantida como esta.`);
  process.exit(0);
}

// So em linha de codigo: o cabecalho do template do Lovable cita
// "defineConfig({ vite: { ... } })" num comentario, e inserir ali quebraria o
// arquivo.
const abertura = /^(?![ \t]*(?:\/\/|\/?\*))([^\n]*?\bdefineConfig\(\s*\{)/m;
const blocoTanstack = /^(?![ \t]*(?:\/\/|\/?\*))([^\n]*?\btanstackStart\s*:\s*\{)/m;
if (!abertura.test(original)) {
  console.log(`::error::${arquivo} nao tem defineConfig({ ... }); converta o projeto para SPA a mao (veja o README do painel).`);
  process.exit(1);
}

let texto = original;
if (blocoTanstack.test(texto)) {
  texto = texto.replace(blocoTanstack, (trecho) => `${trecho}\n    spa: { enabled: true },`);
} else {
  texto = texto.replace(abertura, (trecho) => `${trecho}\n  tanstackStart: { spa: { enabled: true } },`);
}
texto = texto.replace(abertura, (trecho) => `${trecho}\n  nitro: false,`);

fs.writeFileSync(arquivo, texto);
console.log(`${arquivo}: build estatico (nitro desligado, modo SPA) so neste build.`);
console.log("::notice::Projeto TanStack em modo servidor convertido para SPA no build. O repositorio nao foi alterado.");
NODE
