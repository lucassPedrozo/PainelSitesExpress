// Binário `claude` de mentira para os testes do motor Claude: emite eventos stream-json de exemplo e nunca
// fala com a Anthropic. O executor chega aqui por CLAUDE_BIN.
//   CLAUDE_FALSO_CENARIO   ok (padrão) | auth | sem-sessao | lento | teimoso | chave | mcp | plugin | ferramenta
//                          | modo | vaza | briefing-simples | site | pipeline | cliente | briefing | briefing-ruim
//   CLAUDE_FALSO_REGISTRO  arquivo que recebe, por chamada, uma linha JSON com os argumentos, o stdin e o ambiente visto
//   CLAUDE_FALSO_PASTA     pasta do cliente que os cenários "cliente" e "briefing" usam
//   CLAUDE_FALSO_BRIEFING  briefing pronto que o cenário "briefing" grava na pasta do cliente
//   CLAUDE_FALSO_PID       arquivo que recebe o pid deste processo (para o teste do órfão)
//   CLAUDE_FALSO_ATRASO_MS quanto os cenários "ok" e "pipeline" esperam antes de responder
//   No cenário "pipeline" (o site que passa por crítica e refino; o pedido digitado diz qual é o passo):
//   CLAUDE_FALSO_APROVA_NA rodada em que a crítica aprova o site (vazio: nunca aprova, e todas as rodadas acontecem)
//   CLAUDE_FALSO_EMPACA    criticar | refinar: esse passo termina sem erro e sem fazer o pipeline andar
//   CLAUDE_FALSO_FALHA_NO  criticar | refinar: esse passo termina com erro
//   Na edição livre (o claude roda dentro do clone do repositório de um site):
//   edicao        troca "Bem-vindo" por "Bem-vindo à Aurora" em src/App.tsx
//   edicao-nada   termina bem sem mudar arquivo nenhum
//   edicao-quebra cria src/QUEBRA, que faz o build do repositório de teste falhar
//   edicao-import importa em src/App.tsx um pacote que o package.json não tem
//   CLAUDE_FALSO_PRONTO    arquivo que o cenário cria assim que começa
//   CLAUDE_FALSO_SINAL     arquivo que o cenário espera existir antes de editar (o teste mexe no "GitHub" no meio)
import { spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('0.0.0 (claude falso)')
  process.exit(0)
}

const cenario = process.env.CLAUDE_FALSO_CENARIO ?? 'ok'
const depois = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const resume = depois('--resume')
if (process.env.CLAUDE_FALSO_PID) writeFileSync(process.env.CLAUDE_FALSO_PID, String(process.pid))

let entrada = ''
for await (const pedaco of process.stdin) entrada += pedaco

if (process.env.CLAUDE_FALSO_REGISTRO) {
  appendFileSync(process.env.CLAUDE_FALSO_REGISTRO, JSON.stringify({
    args,
    entrada,
    cwd: process.cwd(),
    // Só os nomes: o teste confere que nenhum segredo do painel chegou ao ambiente do claude.
    variaveis: Object.keys(process.env).sort(),
    chave: process.env.ANTHROPIC_API_KEY ?? null,
    token: process.env.ANTHROPIC_AUTH_TOKEN ?? null,
    marca: process.env.JOINVIXABLE_HEADLESS ?? null,
    modelo: process.env.JOINVIXABLE_HEADLESS_MODELO ?? null,
    painel: process.env.JOINVIXABLE_PAINEL ?? null,
    trabalho: process.env.JOINVIXABLE_TRABALHO ?? null,
    atual: process.env.JOINVIXABLE_ATUAL ?? null,
    // O que as Configurações do painel dizem do pipeline: só chega o que está preenchido.
    pipeline: {
      rodadas: process.env.JOINVIXABLE_RODADAS ?? null,
      direcaoDeArte: process.env.JOINVIXABLE_DIRECAO_DE_ARTE ?? null,
      movimento: process.env.JOINVIXABLE_MOVIMENTO ?? null,
      aprovacao: process.env.JOINVIXABLE_APROVACAO_HUMANA ?? null,
    },
    memoria: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null,
    runbook: depois('--append-system-prompt-file') ? readFileSync(depois('--append-system-prompt-file'), 'utf8').slice(0, 200) : null,
    configuracoes: depois('--settings') ? JSON.parse(readFileSync(depois('--settings'), 'utf8')) : null,
  }) + '\n')
}

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms))
const escrever = (dados) => new Promise((ok) => process.stdout.write(dados, ok))
const linha = (ev) => JSON.stringify(ev) + '\n'

// Quem critica é outra conversa: uma sessão nova abre com o id dela, e não com o de quem escreveu o site.
const sessaoNova = cenario === 'sem-sessao' ? 'sessao-nova-depois-da-falha' : /^critique o site /.test(entrada) ? 'sessao-do-critico' : 'sessao-falsa-1'
const sessao = resume ?? sessaoNova
// O `system/init` conta o que o claude de verdade diria ter aberto: é isso que o executor confere contra o contrato.
const inicio = (extra = {}) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessao,
  model: depois('--model'),
  cwd: process.cwd(),
  tools: (depois('--tools') ?? '').split(',').filter(Boolean),
  mcp_servers: [],
  plugins: [],
  apiKeySource: 'none',
  permissionMode: depois('--permission-mode'),
  ...extra,
})
const bash = (id, command) => ({ type: 'assistant', session_id: sessao, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
const retorno = (id, content, erro = false) => ({ type: 'user', session_id: sessao, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: erro }] } })
const texto = (t) => ({ type: 'assistant', session_id: sessao, message: { role: 'assistant', content: [{ type: 'text', text: t }] } })
const fim = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, session_id: sessao, duration_ms: 1234, num_turns: 3, result: 'Ajuste feito: a descrição mudou em content.json.', total_cost_usd: 0.4242, ...extra })

/**
 * Roda um comando do runbook como o agente rodaria pelo Bash: `npm run -s <nome>`, da pasta de trabalho. O que
 * roda de fato é o script do package.json dessa pasta, que encaminha para o pacote do motor.
 */
function script(nome, ...resto) {
  const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).scripts
  const comando = [scripts[nome], ...resto.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))].join(' ')
  const r = spawnSync(comando, { shell: true, encoding: 'utf8', cwd: process.cwd() })
  return { saida: `${r.stdout}${r.stderr}`, ok: r.status === 0 }
}

if (cenario === 'sem-sessao' && resume) {
  // O CLI de verdade sai antes de abrir qualquer sessão quando o id não existe.
  process.stderr.write(`No conversation found with session ID: ${resume}\n`)
  process.exit(1)
}

if (cenario.startsWith('edicao')) {
  if (process.env.CLAUDE_FALSO_PRONTO) writeFileSync(process.env.CLAUDE_FALSO_PRONTO, 'ok')
  if (process.env.CLAUDE_FALSO_SINAL) {
    for (let i = 0; i < 400 && !existsSync(process.env.CLAUDE_FALSO_SINAL); i++) await espera(50)
  }
  const app = join(process.cwd(), 'src', 'App.tsx')
  if (cenario === 'edicao') writeFileSync(app, readFileSync(app, 'utf8').replace('Bem-vindo', 'Bem-vindo à Aurora'))
  if (cenario === 'edicao-quebra') writeFileSync(join(process.cwd(), 'src', 'QUEBRA'), 'o build do repositório de teste falha com este arquivo')
  if (cenario === 'edicao-import') writeFileSync(app, `import confete from "pacote-que-nao-existe";\n${readFileSync(app, 'utf8')}`)
  const resumo = cenario === 'edicao-nada' ? 'O site já faz o que o pedido descreve: nada a mudar.' : 'Título da página inicial trocado em src/App.tsx.'
  await escrever([
    inicio(),
    { type: 'assistant', session_id: sessao, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'Read', input: { file_path: app } }] } },
    retorno('e1', 'export default function App() { … }'),
    bash('e2', 'npm run build'),
    retorno('e2', 'build ok'),
    texto(resumo),
    fim({ result: resumo }),
  ].map(linha).join(''))
  process.exit(0)
}

if (cenario === 'auth') {
  await escrever(linha(inicio()))
  await escrever(linha(texto('Invalid API key · Please run /login')))
  await escrever(linha(fim({ subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', total_cost_usd: 0 })))
  process.exit(1)
}

// O claude diz ter aberto algo fora do contrato e fica trabalhando: o executor precisa matá-lo, não esperar.
const FORA_DO_CONTRATO = {
  chave: { apiKeySource: 'ANTHROPIC_API_KEY' },
  mcp: { mcp_servers: [{ name: 'servidor-do-perfil', status: 'connected' }] },
  plugin: { plugins: [{ name: 'plugin-do-perfil', path: '/algum/lugar' }] },
  ferramenta: { tools: ['Bash', 'Read', 'WebSearch'] },
  modo: { permissionMode: 'acceptEdits' },
}
if (FORA_DO_CONTRATO[cenario]) {
  await escrever(linha(inicio(FORA_DO_CONTRATO[cenario])))
  await espera(30_000)
  process.exit(0)
}

if (cenario === 'vaza') {
  // O agente cita um caminho desta máquina e um valor que não devia ter lido: a tela não pode mostrar nenhum dos dois.
  await escrever(linha(inicio()))
  await escrever(linha(texto(`Li ${join(process.cwd(), 'projects', 'h', 'content.json')} e achei ${process.env.CLAUDE_FALSO_TEXTO}.`)))
  await escrever(linha(fim({ result: `Terminei em ${process.cwd()} com ${process.env.CLAUDE_FALSO_TEXTO}.` })))
  process.exit(0)
}

if (cenario === 'lento' || cenario === 'teimoso') {
  // O teimoso não sai no primeiro sinal: é ele que prova o segundo tempo do cancelamento.
  if (cenario === 'teimoso') process.on('SIGINT', () => {})
  await escrever(linha(inicio()))
  await escrever(linha(bash('t1', 'npm run -s step -- start ajuste lento "pedido" --modelo=claude-opus-5-5')))
  // Fica trabalhando até ser cancelado.
  await espera(120_000)
  process.exit(0)
}

if (cenario === 'briefing' || cenario === 'briefing-ruim') {
  // O agente pede a instrução, lê o material e grava o briefing na pasta do cliente.
  const pasta = process.env.CLAUDE_FALSO_PASTA
  const destino = join(process.cwd(), 'clientes', pasta, 'briefing', 'briefing.json')
  await escrever(linha(inicio()))
  await escrever(linha(bash('t1', `npm run -s cliente -- ${pasta} --briefing`)))
  await escrever(linha(retorno('t1', script('cliente', pasta, '--briefing').saida)))
  mkdirSync(dirname(destino), { recursive: true })
  if (cenario === 'briefing') copyFileSync(process.env.CLAUDE_FALSO_BRIEFING, destino)
  else writeFileSync(destino, JSON.stringify({ empresa: { nome: 'Sem ramo' }, servicos: [], contato: {} }))
  await escrever(linha(fim({ result: 'Briefing escrito a partir de site-antigo.md.' })))
  process.exit(0)
}

if (cenario === 'briefing-simples') {
  // Sem o pacote do motor: o agente olha a pasta do cliente e grava um briefing curto, anotando o que achou nela —
  // é assim que o teste confere que o material já estava lá quando o claude começou.
  const pasta = /gere o briefing do cliente (\S+)/.exec(entrada)?.[1]
  const raiz = join(process.cwd(), 'clientes', pasta)
  const vistos = []
  const andar = (rel) => {
    for (const item of readdirSync(join(raiz, rel), { withFileTypes: true })) {
      const caminho = `${rel}/${item.name}`
      if (item.isDirectory()) andar(caminho)
      else vistos.push(caminho)
    }
  }
  if (existsSync(join(raiz, 'material'))) andar('material')
  mkdirSync(join(raiz, 'briefing'), { recursive: true })
  writeFileSync(
    join(raiz, 'briefing', 'briefing.json'),
    JSON.stringify({ empresa: { nome: 'Voltagem Auto Elétrica', ramo: 'auto elétrica' }, servicos: [{ nome: 'Diagnóstico elétrico' }], contato: { telefone: '2733330000' }, material_visto: vistos.sort() }, null, 2),
  )
  await escrever(linha(inicio()))
  await escrever(linha(bash('t1', `npm run -s cliente -- ${pasta} --briefing`)))
  await escrever(linha(retorno('t1', 'Briefing a partir dos arquivos do cliente')))
  await escrever(linha(fim({ result: `Briefing escrito a partir de ${vistos.length} arquivo(s).` })))
  process.exit(0)
}

/**
 * O pipeline de um site, no arquivo que o motor de mentira lê (`.session/pipeline.json`): quantas rodadas de crítica e
 * refino ele tem, em qual está, a fase e a última crítica. O motor de verdade não grava este arquivo: é só do de mentira.
 */
const arquivoDoPipeline = (slug) => join(process.cwd(), 'projects', slug, '.session', 'pipeline.json')
const lerPipeline = (slug) => JSON.parse(readFileSync(arquivoDoPipeline(slug), 'utf8'))
const gravarPipeline = (slug, pipeline) => writeFileSync(arquivoDoPipeline(slug), JSON.stringify(pipeline, null, 2))

if (cenario === 'pipeline' && Number(process.env.CLAUDE_FALSO_ATRASO_MS) > 0) await espera(Number(process.env.CLAUDE_FALSO_ATRASO_MS))
const passo = cenario === 'pipeline' ? /^(critique|refine) o site (\S+)/.exec(entrada) : null
if (passo) {
  // Uma execução por passo: a crítica, de uma sessão que não escreveu o site, ou o refino, de quem escreveu.
  const [, verbo, slug] = passo
  const tipo = verbo === 'critique' ? 'criticar' : 'refinar'
  const etapa = tipo === 'criticar' ? 'critica' : 'refino'
  const pipeline = lerPipeline(slug)
  await escrever(linha(inicio()))
  await escrever(linha(bash('t1', `npm run -s step -- start ${etapa} ${slug} --modelo=${depois('--model')}`)))
  await escrever(linha(retorno('t1', `[etapa ${etapa} aberta para "${slug}" | rodada ${pipeline.rodada} de ${pipeline.rodadas}]`)))
  if (process.env.CLAUDE_FALSO_FALHA_NO === tipo) {
    await escrever(linha(fim({ subtype: 'error_during_execution', is_error: true, result: `Não consegui terminar a etapa de ${etapa}.` })))
    process.exit(1)
  }
  if (process.env.CLAUDE_FALSO_EMPACA !== tipo) {
    if (tipo === 'criticar') {
      const aprovado = Number(process.env.CLAUDE_FALSO_APROVA_NA) > 0 && pipeline.rodada >= Number(process.env.CLAUDE_FALSO_APROVA_NA)
      pipeline.critica = {
        rodada: pipeline.rodada,
        veredito: aprovado ? 'aprovado' : 'refinar',
        resumo: aprovado ? 'O site tem cara própria e está pronto para o cliente.' : 'A abertura é a de um template: falta uma ideia que seja deste cliente.',
        notas: aprovado ? { identidade: 9, hierarquia: 8, movimento: 8 } : { identidade: 5, hierarquia: 7, movimento: 6 },
        // O crítico cita o arquivo pelo caminho desta máquina: a tela não pode mostrá-lo assim.
        problemas: aprovado ? [] : [{ gravidade: 'grave', onde: join(process.cwd(), 'projects', slug, 'src', 'App.tsx'), problema: 'O topo repete a estrutura de sempre.', correcao: 'Abrir com a foto do balcão e o título sobre ela.' }],
      }
      pipeline.fase = aprovado ? 'entregue' : 'refino'
    } else if (pipeline.rodada < pipeline.rodadas) {
      pipeline.rodada += 1
      pipeline.fase = 'critica'
    } else {
      pipeline.fase = 'entregue'
    }
    gravarPipeline(slug, pipeline)
  }
  await escrever(linha(fim({ result: tipo === 'criticar' ? `Crítica da rodada ${pipeline.critica?.rodada ?? pipeline.rodada} registrada.` : 'Refino feito e validado.' })))
  process.exit(0)
}

if (cenario === 'site' || (cenario === 'pipeline' && /^gere o site do cliente /.test(entrada))) {
  // O agente cria o projeto do cliente e entrega o site, sem o pacote do motor: grava só o que o executor procura —
  // o registro do cliente e a sessão do projeto. A pasta vem do pedido digitado, como o agente de verdade a lê. No
  // cenário "pipeline" a geração não é o fim: o site sai dela esperando a primeira crítica.
  const pasta = /gere o site do cliente (\S+)/.exec(entrada)?.[1]
  const refeito = /--refazer/.test(entrada)
  const slug = `${pasta}${refeito ? '-2' : ''}`
  const registro = join(process.cwd(), 'clientes', pasta, 'projeto.json')
  let projetos = []
  try {
    projetos = JSON.parse(readFileSync(registro, 'utf8')).projetos
  } catch {
    // primeiro site do cliente
  }
  mkdirSync(join(process.cwd(), 'projects', slug, '.session'), { recursive: true })
  writeFileSync(join(process.cwd(), 'projects', slug, '.session', 'session.json'), '{}')
  if (cenario === 'pipeline') {
    // As rodadas são as que o painel passou pelo ambiente; sem nada lá, as duas do padrão do motor.
    gravarPipeline(slug, { rodadas: Number(process.env.JOINVIXABLE_RODADAS) || 2, rodada: 1, fase: 'critica', critica: null })
    // O mínimo de um site do motor, para o envio ao GitHub ter o que mandar quando a sequência terminar.
    mkdirSync(join(process.cwd(), 'projects', slug, 'src'), { recursive: true })
    writeFileSync(join(process.cwd(), 'projects', slug, 'src', 'main.tsx'), "import './App'\n")
    writeFileSync(join(process.cwd(), 'projects', slug, 'content.json'), JSON.stringify({ site: { titulo: pasta } }))
  }
  mkdirSync(dirname(registro), { recursive: true })
  writeFileSync(registro, JSON.stringify({ projetos: [...projetos, { slug, briefing: 'briefing/briefing.json', criado_em: new Date().toISOString() }] }))
  await escrever(linha(inicio()))
  await escrever(linha(bash('t1', `npm run -s cliente -- ${pasta}`)))
  await escrever(linha(retorno('t1', `PROJETO_CRIADO=${slug}`)))
  await escrever(linha(bash('t2', `npm run -s step -- start geracao ${slug} --modelo=claude-opus-5-5`)))
  await escrever(linha(retorno('t2', `[etapa geracao aberta para "${slug}" | limite: 60 chamadas de ferramenta]`)))
  await escrever(linha(fim({ result: 'Site entregue e validado.' })))
  process.exit(0)
}

if (cenario === 'cliente') {
  const pasta = process.env.CLAUDE_FALSO_PASTA
  await escrever(linha(inicio()))
  await escrever(linha(bash('t1', 'npm run -s step -- modo')))
  await escrever(linha(retorno('t1', script('step', 'modo').saida)))
  await escrever(linha(bash('t2', `npm run -s cliente -- ${pasta}`)))
  const criado = script('cliente', pasta)
  await escrever(linha(retorno('t2', criado.saida, !criado.ok)))
  const slug = /PROJETO_CRIADO=(\S+)/.exec(criado.saida)?.[1]
  // O agente informa um modelo diferente do que o executor lançou: o step registra o aviso.
  await escrever(linha(bash('t3', `npm run -s step -- start direcao ${slug} --modelo=modelo-que-o-agente-acha`)))
  await escrever(linha(retorno('t3', script('step', 'start', 'direcao', slug, '--modelo=modelo-que-o-agente-acha').saida.slice(0, 600))))
  await escrever(linha(fim({ result: 'Parei no meio da direção criativa.' })))
  process.exit(0)
}

// Cenário "ok": o stream chega em pedaços que não respeitam as linhas, com um caractere acentuado cortado ao meio.
if (Number(process.env.CLAUDE_FALSO_ATRASO_MS) > 0) await espera(Number(process.env.CLAUDE_FALSO_ATRASO_MS))
const bytes = Buffer.from(
  [
    inicio(),
    bash('t1', 'npm run -s step -- start ajuste h "troque a descrição" --modelo=claude-opus-5-5'),
    retorno('t1', '[etapa ajuste aberta para "h" | limite: 20 chamadas de ferramenta]'),
    bash('t2', 'npm run -s tool -- edit_file <<\'EOF\'\n{"path": "content.json", "old_string": "a", "new_string": "ação"}\nEOF'),
    retorno('t2', 'content.json alterado.'),
    texto('Descrição trocada: a seção agora fala da promoção.'),
    fim(),
  ].map(linha).join(''),
  'utf8',
)
const corte = bytes.indexOf(Buffer.from('ç', 'utf8')) + 1 // no meio do "ç" (dois bytes) de "descrição"
const pontos = [17, 200, corte, corte + 40, bytes.length - 25, bytes.length]
let de = 0
for (const ate of pontos) {
  await escrever(bytes.subarray(de, ate))
  de = ate
  await espera(15)
}
// O preso entregou o resultado, mas espera um comando em segundo plano que nunca termina.
if (cenario === 'preso') await espera(120_000)
process.exit(0)
