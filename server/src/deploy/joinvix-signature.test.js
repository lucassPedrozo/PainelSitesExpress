import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * O passo do build que garante a assinatura Joinvix no site publicado,
 * rodado de verdade com bash contra um `dist/` de exemplo.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptPath = resolve(projectRoot, 'workflows/scripts/ensure-joinvix-signature.sh')
const hasBash = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0

const setup = (files) => {
  const root = mkdtempSync(resolve(tmpdir(), 'joinvix-assinatura-'))
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  writeFileSync(resolve(root, 'logo.png'), 'png')
  return root
}

const run = (root) =>
  spawnSync('bash', [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DIST_DIR: 'dist',
      JOINVIX_SIGNATURE_LOGO_FILE: resolve(root, 'logo.png'),
      GITHUB_STEP_SUMMARY: '',
    },
  })

const REGRA = /<style id="joinvix-assinatura-tamanho">a\[href\*="joinvix\.com"\] img,#joinvix-assinatura img\{height:45px!important;[^<]*@media \(max-width:767px\)\{[^<]*height:36px!important\}\}<\/style><\/head>/

test('site com a assinatura no bundle: nada é inserido além da regra de altura da logo, em toda página', { skip: !hasBash }, () => {
  const html = '<html><head><title>x</title></head><body><div id="root"></div></body></html>'
  const root = setup({
    'dist/index.html': html,
    'dist/servicos/index.html': html,
    'dist/assets/index.js': 'a({href:"https://www.joinvix.com.br/"})',
  })
  try {
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    const saida = readFileSync(resolve(root, 'dist/index.html'), 'utf8')
    assert.match(saida, REGRA)
    assert.equal(saida.replace(/<style id="joinvix-assinatura-tamanho">[^<]*<\/style>/, '').trimEnd(), html, 'o resto da página fica igual')
    assert.match(readFileSync(resolve(root, 'dist/servicos/index.html'), 'utf8'), REGRA, 'as páginas internas também')
    assert.equal(existsSync(resolve(root, 'dist/joinvix-assinatura.png')), false)
    // Rodar de novo não repete a regra.
    assert.equal(run(root).status, 0)
    assert.equal(readFileSync(resolve(root, 'dist/index.html'), 'utf8').split('joinvix-assinatura-tamanho').length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rodapé com o link sem o ".br", num pedaço carregado depois: é assinatura, e nenhuma faixa entra', { skip: !hasBash }, () => {
  // O caso de um site no ar: a logo da Joinvix já no rodapé, com link para
  // joinvix.com, e o passo colava uma segunda faixa, na cor do rodapé, embaixo.
  const html = '<html><head></head><body><div id="root"></div></body></html>'
  const root = setup({
    'dist/index.html': html,
    'dist/assets/index-a1.js': 'import("./routes-b2.js")',
    'dist/assets/routes-b2.js': 'jsx("footer",{children:jsx("a",{href:"https://joinvix.com",children:jsx("img",{src:te})})})',
  })
  try {
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Assinatura Joinvix presente no site\./)
    const saida = readFileSync(resolve(root, 'dist/index.html'), 'utf8')
    assert.doesNotMatch(saida, /id="joinvix-assinatura"/)
    assert.match(saida, REGRA)
    assert.equal(existsSync(resolve(root, 'dist/joinvix-assinatura.png')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sem assinatura, insere a faixa antes de </body> e copia a logo', { skip: !hasBash }, () => {
  const root = setup({
    'dist/index.html': '<html><body><div id="root"></div>\n<script src="./a.js"></script></body></html>',
    'dist/assets/index.js': 'console.log(1)',
  })
  try {
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8')
    assert.match(html, /<div id="joinvix-assinatura"[^]*href="https:\/\/www\.joinvix\.com\.br\/"[^]*<\/div><script>[^]*<\/script><\/body>/)
    // A faixa toma a cor do rodapé do site quando a página abre, e troca a logo pela branca em rodapé escuro.
    assert.match(html, /data-clara="\.\/joinvix-assinatura-clara\.png"/)
    assert.match(html, /querySelectorAll\("footer"\)/)
    assert.equal(existsSync(resolve(root, 'dist/joinvix-assinatura-clara.png')), true)
    assert.match(html, /src="\.\/joinvix-assinatura\.png"/)
    assert.equal(existsSync(resolve(root, 'dist/joinvix-assinatura.png')), true)
    assert.match(result.stdout, /foi inserida/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sem pasta de build, avisa e não quebra o deploy', { skip: !hasBash }, () => {
  const root = setup({})
  try {
    const result = run(root)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /warning/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
