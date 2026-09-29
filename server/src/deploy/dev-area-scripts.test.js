import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/*
 * Os scripts da área de desenvolvimento rodam no runner do GitHub, sobre o
 * checkout do site. Aqui eles rodam sobre projetos de mentira com o formato
 * dos que o Lovable gera: React Router e TanStack Start.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = (name) => resolve(projectRoot, 'workflows/scripts', name)

const hasBash = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0

const createProject = (files) => {
  const root = mkdtempSync(resolve(tmpdir(), 'joinvix-area-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const target = resolve(root, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

const run = (name, root, env = {}) => {
  const outputFile = resolve(root, 'github-output.txt')
  writeFileSync(outputFile, '')
  return spawnSync('bash', [script(name)], {
    cwd: root,
    encoding: 'utf8',
    // O MSYS do Git Bash no Windows converteria "/zezinho/" num caminho.
    env: { ...process.env, MSYS_NO_PATHCONV: '1', GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: '', ...env },
  })
}

const read = (root, relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const reactRouterSite = {
  'package.json': JSON.stringify({
    scripts: { build: 'vite build', 'build:dev': 'vite build --mode development', lint: 'eslint .' },
  }),
  'public/videos/v1.mp4': 'x',
  'public/favicon.png': 'x',
  'src/App.tsx': '<BrowserRouter>\n  <Routes><Route path="/" element={<Index />} /></Routes>\n</BrowserRouter>',
  'src/pages/Index.tsx': [
    'const videos = [{ src: "/videos/v1.mp4" }, { src: "/videos-antigos/x.mp4" }];',
    'const logo = "/favicon.png";',
    'const externo = "https://site.com/videos/v1.mp4";',
    'export default () => <a href="/#contato">Contato</a>;',
  ].join('\n'),
  'src/index.css': '.hero { background: url(/videos/v1.mp4); }',
}

test('prepara um site React Router para responder na pasta', { skip: !hasBash }, () => {
  const root = createProject(reactRouterSite)
  try {
    const result = run('prepare-dev-area.sh', root, { BASE_PATH: '/zezinho/' })
    assert.equal(result.status, 0, result.stdout + result.stderr)

    const pkg = JSON.parse(read(root, 'package.json'))
    assert.equal(pkg.scripts.build, 'vite build --base=/zezinho/')
    assert.equal(pkg.scripts['build:dev'], 'vite build --base=/zezinho/ --mode development')
    assert.equal(pkg.scripts.lint, 'eslint .')

    assert.match(read(root, 'src/App.tsx'), /<BrowserRouter basename="\/zezinho">/)

    const index = read(root, 'src/pages/Index.tsx')
    assert.match(index, /"\/zezinho\/videos\/v1\.mp4"/)
    assert.match(index, /"\/zezinho\/favicon\.png"/)
    // Pasta com prefixo parecido, URL externa e link de navegação ficam: o
    // link é corrigido no navegador, porque o mesmo texto pode ir a um <Link>.
    assert.match(index, /"\/videos-antigos\/x\.mp4"/)
    assert.match(index, /"https:\/\/site\.com\/videos\/v1\.mp4"/)
    assert.match(index, /href="\/#contato"/)

    assert.match(read(root, 'src/index.css'), /url\(\/zezinho\/videos\/v1\.mp4\)/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('mantém a base no vite build que vem antes do pós-build', { skip: !hasBash }, () => {
  const root = createProject({
    'package.json': JSON.stringify({ scripts: { build: 'vite build && node scripts/flatten-dist.mjs' } }),
    'src/routes/__root.tsx': 'links: [{ rel: "icon", href: "/favicon.png" }]',
    'public/favicon.png': 'x',
  })
  try {
    const result = run('prepare-dev-area.sh', root, { BASE_PATH: '/zezinho/' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(
      JSON.parse(read(root, 'package.json')).scripts.build,
      'vite build --base=/zezinho/ && node scripts/flatten-dist.mjs',
    )
    assert.match(read(root, 'src/routes/__root.tsx'), /href: "\/zezinho\/favicon\.png"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recusa site que não é Vite ou que já fixa a base', { skip: !hasBash }, () => {
  for (const build of ['next build', 'vite build --base=/outra/']) {
    const root = createProject({ 'package.json': JSON.stringify({ scripts: { build } }) })
    try {
      const result = run('prepare-dev-area.sh', root, { BASE_PATH: '/zezinho/' })
      assert.notEqual(result.status, 0)
      assert.match(result.stdout, /::error::/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('recusa base fora do formato /pasta/', { skip: !hasBash }, () => {
  const root = createProject(reactRouterSite)
  try {
    for (const BASE_PATH of ['', '/', 'zezinho', '/Zé/', '/a/../b/']) {
      assert.notEqual(run('prepare-dev-area.sh', root, { BASE_PATH }).status, 0, BASE_PATH)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const page = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><a href="/#contato">x</a></body></html>'

test('o .htaccess gerado aponta para a pasta, e para a raiz por padrão', { skip: !hasBash }, () => {
  for (const [env, base] of [[{}, '/'], [{ BASE_PATH: '/zezinho/' }, '/zezinho/']]) {
    const root = createProject({ 'dist/index.html': page })
    try {
      const result = run('resolve-build-output.sh', root, env)
      assert.equal(result.status, 0, result.stderr)
      const htaccess = read(root, 'dist/.htaccess')
      assert.ok(htaccess.includes(`RewriteBase ${base}\n`))
      assert.ok(htaccess.includes(`RewriteRule . ${base}index.html [L]`))
      assert.ok(htaccess.includes(`ErrorDocument 404 ${base}index.html`))
      assert.equal(htaccess.includes('@BASE_PATH@'), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('o acabamento tira o site dos buscadores e grava o commit publicado', { skip: !hasBash }, () => {
  const root = createProject({
    'dist/index.html': page,
    'dist/sobre/index.html': page,
    'dist/.htaccess': '# existente\n',
  })
  try {
    const result = run('finalize-dev-area.sh', root, {
      BASE_PATH: '/zezinho/',
      DIST_DIR: 'dist',
      GITHUB_SHA: 'abc123',
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)

    for (const pagina of ['dist/index.html', 'dist/sobre/index.html']) {
      const html = read(root, pagina)
      assert.match(html, /<head><meta name="robots" content="noindex, nofollow"><script data-joinvix-area-dev>/)
      assert.ok(html.includes('"/zezinho/"'))
    }

    const marcador = JSON.parse(read(root, 'dist/joinvix-build.json'))
    assert.equal(marcador.sha, 'abc123')
    assert.equal(marcador.base, '/zezinho/')

    const htaccess = read(root, 'dist/.htaccess')
    assert.ok(htaccess.startsWith('# existente\n'))
    assert.match(htaccess, /Header set X-Robots-Tag "noindex, nofollow"/)

    // Rodar de novo não injeta duas vezes.
    run('finalize-dev-area.sh', root, { BASE_PATH: '/zezinho/', DIST_DIR: 'dist', GITHUB_SHA: 'abc123' })
    assert.equal(read(root, 'dist/index.html').split('data-joinvix-area-dev').length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('o acabamento falha quando não há página para preparar', { skip: !hasBash }, () => {
  const root = createProject({ 'dist/app.js': 'x' })
  try {
    const result = run('finalize-dev-area.sh', root, { BASE_PATH: '/zezinho/', DIST_DIR: 'dist' })
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(resolve(root, 'dist/joinvix-build.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// O cabeçalho do vite.config do Lovable cita "defineConfig({ vite: ... })" num
// comentário: a primeira versão da conversão inseriu o código ali dentro.
const lovableTanstackConfig = [
  '// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually',
  '// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.',
  'import { defineConfig } from "@lovable.dev/vite-tanstack-config";',
  '',
  'export default defineConfig({',
  '  tanstackStart: {',
  '    server: { entry: "server" },',
  '  },',
  '});',
].join('\n')

test('converte o TanStack do Lovable em modo servidor para build estático', { skip: !hasBash }, () => {
  const root = createProject({ 'vite.config.ts': lovableTanstackConfig })
  try {
    const result = run('ensure-static-build.sh', root)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const config = read(root, 'vite.config.ts')
    assert.match(config, /export default defineConfig\(\{\n {2}nitro: false,\n {2}tanstackStart: \{\n {4}spa: \{ enabled: true \},\n {4}server/)
    // O comentário fica intacto.
    assert.ok(config.includes('// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('não mexe em projeto que já escolheu como sai estático, nem em projeto sem o TanStack do Lovable', { skip: !hasBash }, () => {
  const spa = lovableTanstackConfig.replace('    server: { entry: "server" },', '    spa: { enabled: true },')
  // Os dois formatos achados na organização: pré-renderização com o nitro
  // desligado por spread (delltec) e pré-renderização com o nitro ligado
  // (ruptiva, que sai em .output/public). Ligar o SPA por cima quebraria o
  // pós-build deles.
  const prerenderSemNitro = lovableTanstackConfig
    .replace('    server: { entry: "server" },', '    server: { entry: "server" },\n    ...(isSandbox ? {} : { prerender: { enabled: true } }),')
    .replace('});', '  ...(isSandbox ? {} : { nitro: false }),\n});')
  const prerenderComNitro = lovableTanstackConfig.replace(
    '    server: { entry: "server" },',
    '    server: { entry: "server" },\n    pages: [{ path: "/" }],\n    prerender: { enabled: true, autoStaticPathsDiscovery: false },',
  )
  for (const config of [spa, prerenderSemNitro, prerenderComNitro,'import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [] });']) {
    const root = createProject({ 'vite.config.ts': config })
    try {
      const result = run('ensure-static-build.sh', root)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(read(root, 'vite.config.ts'), config)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('cria o bloco tanstackStart quando o config não tem', { skip: !hasBash }, () => {
  const root = createProject({
    'vite.config.ts': 'import { defineConfig } from "@lovable.dev/vite-tanstack-config";\nexport default defineConfig({});\n',
  })
  try {
    assert.equal(run('ensure-static-build.sh', root).status, 0)
    const config = read(root, 'vite.config.ts')
    assert.match(config, /nitro: false,/)
    assert.match(config, /tanstackStart: \{ spa: \{ enabled: true \} \},/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ---- Site estático, feito fora do Lovable: sem package.json ---------- */

const staticSite = {
  'index.html': [
    '<link href="/css/site.css" rel="stylesheet">',
    '<a href="/">Início</a> <a href="/contato.html">Contato</a>',
    '<img src="/img/logo.png"> <script src="https://cdn.site.com/x.js"></script>',
    '<img src="//cdn.site.com/y.png"> <img src="img/relativa.png">',
  ].join('\n'),
  'css/site.css': '.hero { background: url(/img/fundo.jpg); } .b { background: url("/img/b.png"); }',
  'contato.html': '<a href="/zezinho/ja-tem.html">x</a>',
}

test('site estático: os caminhos absolutos ganham a pasta, sem build', { skip: !hasBash }, () => {
  const root = createProject(staticSite)
  try {
    const prep = run('prepare-dev-area.sh', root, { BASE_PATH: '/zezinho/' })
    assert.equal(prep.status, 0, prep.stdout + prep.stderr)
    const html = read(root, 'index.html')
    assert.match(html, /href="\/zezinho\/css\/site\.css"/)
    assert.match(html, /href="\/zezinho\/"/)
    assert.match(html, /href="\/zezinho\/contato\.html"/)
    assert.match(html, /src="\/zezinho\/img\/logo\.png"/)
    // Outro domínio e caminho relativo ficam como estão.
    assert.match(html, /src="https:\/\/cdn\.site\.com\/x\.js"/)
    assert.match(html, /src="\/\/cdn\.site\.com\/y\.png"/)
    assert.match(html, /src="img\/relativa\.png"/)
    assert.equal(
      read(root, 'css/site.css'),
      '.hero { background: url(/zezinho/img/fundo.jpg); } .b { background: url("/zezinho/img/b.png"); }',
    )
    // O que já tem a pasta não ganha outra.
    assert.equal(read(root, 'contato.html'), '<a href="/zezinho/ja-tem.html">x</a>')

    const build = run('install-and-build.sh', root)
    assert.equal(build.status, 0, build.stdout + build.stderr)
    assert.match(build.stdout, /site estatico/i)

    const saida = run('resolve-build-output.sh', root)
    assert.equal(saida.status, 0, saida.stdout + saida.stderr)
    assert.match(read(root, 'github-output.txt'), /^dist-dir=\.$/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sem package.json e sem index.html, não há site para publicar', { skip: !hasBash }, () => {
  const root = createProject({ 'README.md': '# nada' })
  try {
    const prep = run('prepare-dev-area.sh', root, { BASE_PATH: '/zezinho/' })
    assert.notEqual(prep.status, 0)
    assert.match(prep.stdout, /nao ha site para publicar/)
    assert.notEqual(run('install-and-build.sh', root).status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
