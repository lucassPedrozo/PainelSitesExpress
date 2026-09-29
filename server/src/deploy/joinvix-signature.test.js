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

test('site com a assinatura no bundle não é alterado', { skip: !hasBash }, () => {
  const html = '<html><body><div id="root"></div></body></html>'
  const root = setup({
    'dist/index.html': html,
    'dist/assets/index.js': 'a({href:"https://www.joinvix.com.br/"})',
  })
  try {
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(resolve(root, 'dist/index.html'), 'utf8'), html)
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
    assert.match(html, /<div id="joinvix-assinatura"[^]*href="https:\/\/www\.joinvix\.com\.br\/"[^]*<\/div><\/body>/)
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
