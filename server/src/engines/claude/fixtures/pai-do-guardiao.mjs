// Faz o papel do painel no teste do órfão: lança o guardião com o claude falso, do jeito que o executor lança,
// e fica parado até ser morto à força pelo teste. Imprime o pid do claude assim que o guardião avisa.
//   node pai-do-guardiao.mjs <guardian.js> <executável> [argumentos...]
import { spawn } from 'node:child_process'

const [guardiao, ...comando] = process.argv.slice(2)
const filho = spawn(process.execPath, [guardiao, ...comando], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true })
filho.on('message', (mensagem) => {
  if (mensagem?.tipo === 'iniciado') console.log(`CLAUDE=${mensagem.pid} GUARDIAO=${filho.pid}`)
  if (mensagem?.tipo === 'erro') console.log(`ERRO=${mensagem.codigo}`)
})
filho.on('exit', (codigo) => console.log(`SAIU=${codigo}`))
filho.stdin.end('pedido de teste')
// Fica vivo, como o painel no meio de uma geração.
setInterval(() => {}, 1000)
