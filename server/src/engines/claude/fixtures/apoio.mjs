// Apoio dos testes do motor Claude: uma bancada com pasta de dados temporária, o claude falso no lugar do
// executável e um motor de mentira no lugar do pacote. Nenhum teste chama o claude de verdade.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { criarExecutor } from '../executor.js'
import { caminhosDoMotor } from '../workspace.js'

export const CLAUDE_FALSO = fileURLToPath(new URL('./claude-falso.mjs', import.meta.url))

/** O contrato de permissões, como está em joinvixable/config/headless.json. */
export const CONTRATO = {
  ferramentas: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
  modo_de_permissao: 'dontAsk',
  fontes_de_configuracao: 'user',
  configuracoes: { permissions: { blockReadsOutsideWorkingDirectories: true } },
  permitir: [
    'Read(./**)',
    'Edit(./projects/*/.session/rascunho.txt)',
    'Bash(npm run -s cliente *)',
    'Bash(npm run -s new-project *)',
    'Bash(npm run -s step *)',
    'Bash(npm run -s tool *)',
    'Bash(npm run -s report *)',
  ],
  permitir_no_briefing: ['Edit(./clientes/{pasta}/**)'],
  negar: ['Bash(rm *)', 'Bash(git *)', 'Bash(curl *)', 'Bash(cat *)', 'Bash(grep *)', 'Bash(ls *)', 'Read(//**/.env)'],
  variaveis_removidas: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'],
  variaveis_definidas: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
  esforco: { criacao: 'xhigh', ajuste: 'medium', briefing: 'high' },
  cancelamento_espera_ms: 8000,
}

/** O que o painel tem no ambiente e nunca pode chegar ao claude. Valores de mentira. */
export const SEGREDOS_DO_PAINEL = {
  GITHUB_TOKEN: 'github_pat_teste_nao_pode_vazar',
  DEV_AREA_FTP_PASSWORD: 'senha-do-ftp-nao-pode-vazar',
  BETTERLINKS_MCP_TOKEN: 'token-do-encurtador-nao-pode-vazar',
  PANEL_ACCESS_TOKEN: 'chave-do-painel-nao-pode-vazar',
  GEMINI_API_KEY: 'chave-do-gemini-nao-pode-vazar',
  AI_API_KEY: 'sk-ant-chave-de-ia-nao-pode-vazar',
  GOOGLE_CREDENTIALS_PATH: 'chave-da-service-account.json',
  ANTHROPIC_API_KEY: 'sk-ant-nao-pode-vazar',
  ANTHROPIC_AUTH_TOKEN: 'token-nao-pode-vazar',
  anthropic_base_url: 'https://exemplo.invalid',
  CLAUDE_CODE_USE_BEDROCK: '1',
}

/** A frase do runbook, no motor de mentira. A de verdade mora em joinvixable/agent/pedidos.ts. */
export function fraseDe(p) {
  if (p.tipo === 'cliente') return `gere o site do cliente ${p.pasta}${p.refazer ? ' com --refazer' : ''}`
  if (p.tipo === 'briefing') return `gere o site do briefing ${p.arquivo}`
  if (p.tipo === 'analisar') return `gere o briefing do cliente ${p.pasta}${p.observacoes?.trim() ? `\nObservações: ${p.observacoes.trim()}` : ''}`
  if (p.tipo === 'ajuste') return `ajuste o site ${p.slug}: ${p.pedido.trim()}`
  return `continue o site ${p.slug}`
}

export const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

/**
 * @param {{ validar?: (slug: string) => Promise<{ ok: boolean, texto: string }> }} [opcoes]
 */
export function bancada({ validar = async () => ({ ok: true, texto: 'BUILD OK. VALIDAÇÃO OK.' }) } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-claude-'))
  const dirMotor = path.join(raiz, 'pacote')
  fs.mkdirSync(path.join(dirMotor, 'node_modules'), { recursive: true })
  const caminhos = caminhosDoMotor({ dataDir: path.join(raiz, 'dados'), dirMotor })
  const arquivoDeChamadas = path.join(raiz, 'chamadas.jsonl')
  const arquivoDoPid = path.join(raiz, 'claude.pid')

  /** O que o teste controla: cenário do claude falso, respostas do motor e o que foi registrado. */
  const estado = {
    cenario: 'ok',
    extraNoAmbiente: {},
    /** @type {Record<string, { etapaAberta?: string | null, aguardandoAprovacao?: boolean, entregue?: boolean }>} */
    projetos: {},
    /** @type {Record<string, string[]>} erros da conferência do briefing, por pasta */
    briefings: {},
    /** @type {string | null} motivo com que o motor recusa o próximo pedido */
    recusa: null,
    /** @type {string[]} */
    sites: [],
    /** @type {Array<Record<string, any>>} */
    registros: [],
    validacoes: 0,
  }

  const motor = {
    dir: dirMotor,
    ambiente: async () => ({ ok: true, headless: structuredClone(CONTRATO), modeloEsperado: 'claude-sonnet-5-5' }),
    conferirPedido: async (pedido) => {
      if (estado.recusa) {
        const erro = /** @type {any} */ (new Error(estado.recusa))
        erro.status = 409
        erro.expose = true
        throw erro
      }
      return { frase: fraseDe(pedido), sites: estado.sites }
    },
    estadoDoProjeto: async (slug) => ({ ok: true, etapaAberta: null, aguardandoAprovacao: false, entregue: true, ...(estado.projetos[slug] ?? {}) }),
    conferirBriefing: async (pasta) => ({ ok: true, existe: true, erros: estado.briefings[pasta] ?? [], avisos: [] }),
    gravarRunbook: async (arquivo) => {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true })
      fs.writeFileSync(arquivo, '# Runbook do modo CLI\n\n(runbook de teste)\n')
      return { ok: true, arquivo }
    },
    validar: async (slug) => {
      estado.validacoes += 1
      return validar(slug)
    },
  }

  const executor = criarExecutor({
    motor: /** @type {any} */ (motor),
    caminhos,
    registrar: (execucao) => estado.registros.push(execucao),
    opcoes: () => ({
      bin: CLAUDE_FALSO,
      modelo: 'claude-sonnet-5-5',
      // O ambiente do painel, com os segredos dele: é daqui que o executor tira só o que o claude pode ver.
      base: { ...process.env, ...SEGREDOS_DO_PAINEL },
      ambiente: {
        CLAUDE_FALSO_CENARIO: estado.cenario,
        CLAUDE_FALSO_REGISTRO: arquivoDeChamadas,
        CLAUDE_FALSO_PID: arquivoDoPid,
        ...estado.extraNoAmbiente,
      },
      protegidos: [path.join(raiz, '.env'), path.join(raiz, 'dados', 'painel.json')],
      segredos: Object.values(SEGREDOS_DO_PAINEL),
    }),
  })

  return {
    raiz,
    caminhos,
    estado,
    motor,
    executor,
    /** Cria o projeto do motor na pasta de trabalho: basta a sessão existir. */
    projeto(slug, situacao = {}) {
      const sessao = path.join(caminhos.trabalho, 'projects', slug, '.session')
      fs.mkdirSync(sessao, { recursive: true })
      fs.writeFileSync(path.join(sessao, 'session.json'), '{}')
      estado.projetos[slug] = situacao
    },
    /** Cada chamada ao claude falso: argumentos, stdin, pasta e o ambiente visto. */
    chamadas: () =>
      fs.existsSync(arquivoDeChamadas)
        ? fs.readFileSync(arquivoDeChamadas, 'utf8').trim().split('\n').map((linha) => JSON.parse(linha))
        : [],
    pidDoClaude: () => (fs.existsSync(arquivoDoPid) ? Number(fs.readFileSync(arquivoDoPid, 'utf8')) : null),
    historico: (slug) => JSON.parse(fs.readFileSync(path.join(caminhos.trabalho, 'projects', slug, '.session', 'headless.json'), 'utf8')).execucoes,
    limpar: () => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  }
}
