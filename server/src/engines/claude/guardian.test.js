import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { pidVivo } from "./executor.js";

/**
 * O guardião é o que impede um `claude -p` de ficar gastando a assinatura
 * depois que o painel morreu sem aviso — o `node --watch` reiniciando a API,
 * alguém encerrando o processo à força. Aqui um processo faz o papel do painel
 * e é morto de verdade, sem a árvore: o claude falso tem de sair sozinho.
 */

const GUARDIAO = fileURLToPath(new URL("./guardian.js", import.meta.url));
const PAI = fileURLToPath(new URL("./fixtures/pai-do-guardiao.mjs", import.meta.url));
const CLAUDE_FALSO = fileURLToPath(new URL("./fixtures/claude-falso.mjs", import.meta.url));

const esperarAte = async (condicao, ms) => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicao()) return true;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return condicao();
};

/** Mata um processo só, sem a árvore dele — é o que o `node --watch` faz com a API. */
function matarSoEste(pid) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/F"], { windowsHide: true });
  else process.kill(pid, "SIGKILL");
}

describe("guardião do claude -p", () => {
  it("o painel morre à força no meio de uma execução: o claude é encerrado, e não fica órfão gastando", { timeout: 60_000 }, async () => {
    const painel = spawn(process.execPath, [PAI, GUARDIAO, process.execPath, CLAUDE_FALSO, "-p"], {
      env: { ...process.env, CLAUDE_FALSO_CENARIO: "lento" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let saida = "";
    painel.stdout.on("data", (pedaco) => (saida += pedaco));
    painel.stderr.on("data", (pedaco) => (saida += pedaco));

    assert.ok(await esperarAte(() => /CLAUDE=\d+/.test(saida), 20_000), `o guardião avisa o pid do claude: ${saida}`);
    const claude = Number(/CLAUDE=(\d+)/.exec(saida)[1]);
    const guardiao = Number(/GUARDIAO=(\d+)/.exec(saida)[1]);
    assert.equal(pidVivo(claude), true, "o claude falso está rodando (ficaria 2 minutos, se ninguém o parasse)");

    matarSoEste(painel.pid);
    assert.ok(await esperarAte(() => !pidVivo(painel.pid), 10_000), "o painel morreu");

    assert.ok(await esperarAte(() => !pidVivo(claude), 15_000), "o claude foi encerrado pelo guardião");
    assert.ok(await esperarAte(() => !pidVivo(guardiao), 10_000), "e o guardião saiu em seguida");
  });

  it("execução que termina sozinha: o guardião sai com o mesmo código do claude", { timeout: 60_000 }, async () => {
    const fim = (cenario) =>
      new Promise((resolve) => {
        const filho = spawn(process.execPath, [GUARDIAO, process.execPath, CLAUDE_FALSO, "-p", "--model", "m"], {
          env: { ...process.env, CLAUDE_FALSO_CENARIO: cenario },
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          windowsHide: true,
        });
        let saida = "";
        filho.stdout.on("data", (pedaco) => (saida += pedaco));
        filho.on("close", (codigo) => resolve({ codigo, saida }));
        filho.stdin.end("pedido");
      });
    const ok = await fim("ok");
    assert.equal(ok.codigo, 0);
    assert.match(ok.saida, /"type":"result"/, "o stream do claude passa direto pelo guardião");
    assert.equal((await fim("auth")).codigo, 1);
  });

  it("executável que não existe: o guardião avisa o motivo em vez de ficar esperando", { timeout: 30_000 }, async () => {
    const mensagens = [];
    const codigo = await new Promise((resolve) => {
      const filho = spawn(process.execPath, [GUARDIAO, "claude-que-nao-existe-nesta-maquina"], { stdio: ["pipe", "pipe", "pipe", "ipc"], windowsHide: true });
      filho.on("message", (mensagem) => mensagens.push(mensagem));
      filho.on("close", resolve);
      filho.stdin.end("");
    });
    assert.equal(codigo, 127);
    assert.deepEqual(mensagens.map((mensagem) => [mensagem.tipo, mensagem.codigo]), [["erro", "ENOENT"]]);
  });
});
