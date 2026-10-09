#!/usr/bin/env node
/**
 * O guardião do `claude -p`: um processo pequeno entre o painel e o claude.
 *
 *   node guardian.js <executável> [argumentos...]
 *
 * O painel não lança o claude direto. Se o painel morre sem aviso — o
 * `node --watch` reiniciando a API a cada arquivo salvo, alguém encerrando o
 * processo à força —, um filho direto ficaria órfão, gastando a assinatura
 * sem ninguém olhando. O guardião sobrevive a essa morte o bastante para
 * perceber que ficou sem pai (o canal com o painel fecha) e encerrar o claude
 * com a árvore inteira dele: npm, node, o navegador das capturas.
 *
 * O claude herda o stdin, o stdout e o stderr do guardião, que são os canos
 * abertos pelo painel: o pedido e o stream passam direto, sem cópia aqui.
 *
 * Mensagens pelo canal com o painel:
 *   painel → guardião   { tipo: "encerrar", sinal: "SIGINT" | "SIGTERM" }
 *   guardião → painel   { tipo: "iniciado", pid } | { tipo: "erro", codigo, mensagem }
 */
import { spawn, spawnSync } from "node:child_process";

const [comando, ...argumentos] = process.argv.slice(2);
const pai = process.ppid;
const noWindows = process.platform === "win32";

const avisar = (mensagem) => {
  if (process.connected) process.send?.(mensagem, () => undefined);
};

if (!comando) {
  avisar({ tipo: "erro", codigo: "USO", mensagem: "guardião chamado sem comando" });
  process.exit(2);
}

const filho = spawn(comando, argumentos, {
  stdio: "inherit",
  windowsHide: true,
  // Fora do Windows o filho ganha um grupo próprio, para o sinal alcançar a
  // árvore toda. No Windows quem alcança a árvore é o taskkill.
  detached: !noWindows,
});

let encerrado = false;

/** Encerra o claude e os descendentes dele. */
function encerrar(sinal) {
  if (encerrado || !filho.pid) return;
  if (noWindows) {
    // No Windows não há sinais: o processo e os filhos dele saem na hora.
    const resultado = spawnSync("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { windowsHide: true });
    if (resultado.status === 0) return;
    filho.kill();
    return;
  }
  try {
    process.kill(-filho.pid, sinal);
  } catch {
    filho.kill(sinal);
  }
}

filho.on("spawn", () => avisar({ tipo: "iniciado", pid: filho.pid }));
filho.on("error", (/** @type {NodeJS.ErrnoException} */ erro) => {
  encerrado = true;
  avisar({ tipo: "erro", codigo: erro.code ?? "ERRO", mensagem: erro.message });
  // O painel precisa receber a mensagem antes de o processo sair.
  setTimeout(() => process.exit(127), 50);
});
filho.on("exit", (codigo, sinal) => {
  encerrado = true;
  clearInterval(vigia);
  process.exit(codigo ?? (sinal ? 1 : 0));
});

process.on("message", (/** @type {any} */ mensagem) => {
  if (mensagem?.tipo === "encerrar") encerrar(mensagem.sinal === "SIGINT" ? "SIGINT" : "SIGTERM");
});

/** O painel sumiu: não há mais quem acompanhe, cancele ou registre a execução. */
function semPai() {
  if (encerrado) return;
  encerrar("SIGTERM");
  // Se o claude ignorar o sinal (fora do Windows), insiste e sai de qualquer jeito.
  setTimeout(() => {
    if (!encerrado && !noWindows) encerrar("SIGKILL");
    process.exit(1);
  }, 3000).unref();
}

process.on("disconnect", semPai);

// Segunda conferência, para o caso de o canal não avisar: o pai ainda existe?
const vigia = setInterval(() => {
  try {
    process.kill(pai, 0);
  } catch (/** @type {any} */ erro) {
    if (erro?.code !== "EPERM") semPai();
  }
}, 2000);
vigia.unref();

// Um sinal direto ao guardião (Ctrl+C no terminal do painel, um `kill`) vale
// como ordem de encerrar tudo: sem ele, o claude ficaria sem quem o vigie.
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sinal, semPai);
