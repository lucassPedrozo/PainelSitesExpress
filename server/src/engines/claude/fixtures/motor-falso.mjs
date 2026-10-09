// O pacote do motor, de mentira, para os testes das rotas do painel rodarem onde o `joinvixable/` não está (o
// repositório é privado: um clone público e o CI não o têm). Responde às mesmas perguntas do `motor.js`, com o
// estado que o teste controla. As conferências de verdade têm o teste delas no pacote do motor.
import fs from 'node:fs'
import path from 'node:path'
import { projetosDoCliente, temSessao } from '../workspace.js'
import { CONTRATO, fraseDe } from './apoio.mjs'

const recusa = (mensagem) => Object.assign(new Error(mensagem), { status: 409, expose: true })

/**
 * @param {{ trabalho: string }} params a pasta de trabalho do motor, onde o claude falso grava
 */
export function criarMotorFalso({ trabalho }) {
  const estado = {
    /** @type {Record<string, { dados: Record<string, any> | null, erros: string[], avisos: string[] }>} por pasta */
    briefings: {},
    /** @type {Record<string, { etapaAberta?: string | null, aguardandoAprovacao?: boolean, entregue?: boolean }>} por slug */
    projetos: {},
    /** Motivo com que o motor recusa o próximo pedido. @type {string | null} */
    recusa: null,
    /** As consultas feitas, na ordem. @type {string[]} */
    consultas: [],
  }

  const pastaDoCliente = (pasta) => path.join(trabalho, 'clientes', pasta)
  const arquivoDoBriefing = (pasta) => path.join(pastaDoCliente(pasta), 'briefing', 'briefing.json')

  /** O briefing do cliente: o que o teste pôs no estado ou o que o claude falso gravou na pasta. */
  function briefingDe(pasta) {
    if (estado.briefings[pasta]) return estado.briefings[pasta]
    if (!fs.existsSync(arquivoDoBriefing(pasta))) return null
    let dados = null
    try {
      dados = JSON.parse(fs.readFileSync(arquivoDoBriefing(pasta), 'utf8'))
    } catch {
      return { dados: null, erros: ['O arquivo não é um JSON válido.'], avisos: [] }
    }
    return { dados, erros: dados?.empresa?.ramo ? [] : ['empresa.ramo: obrigatório'], avisos: [] }
  }

  function conferir(pasta) {
    const briefing = briefingDe(pasta)
    const projetos = projetosDoCliente(trabalho, pasta)
    // Como o motor de verdade: a mensagem diz em que pasta desta máquina ele procurou.
    if (!briefing) return { ok: true, existe: false, arquivo: null, outros: [], erros: [`Nenhum arquivo .json em ${path.join(pastaDoCliente(pasta), 'briefing')}. Ponha ali o briefing do cliente.`], avisos: [], resumo: [], projetos }
    return {
      ok: true,
      existe: true,
      arquivo: `clientes/${pasta}/briefing/briefing.json`,
      outros: [],
      erros: briefing.erros,
      avisos: briefing.avisos,
      resumo: briefing.dados?.empresa?.nome ? [`Empresa: ${briefing.dados.empresa.nome}`] : [],
      projetos,
    }
  }

  const estadoDe = (slug) => {
    if (!temSessao(trabalho, slug)) throw recusa(`Projeto "${slug}" não existe.`)
    return { etapaAberta: null, aguardandoAprovacao: false, entregue: true, ...(estado.projetos[slug] ?? {}) }
  }

  const sitesDe = (texto = '') => [...texto.matchAll(/(?:www\.)?((?:[a-z0-9-]+\.)+(?:com\.br|com))/gi)].map((m) => m[1].toLowerCase())

  const pngs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((nome) => nome.endsWith('.png')).sort() : [])

  function projeto(slug) {
    const e = estadoDe(slug)
    const sessao = path.join(trabalho, 'projects', slug, '.session')
    return {
      ok: true,
      slug,
      situacao: e.aguardandoAprovacao ? 'aguardando aprovação' : e.etapaAberta ? `etapa ${e.etapaAberta} aberta` : 'entregue',
      ...e,
      aprovacaoHumana: false,
      brief: e.aguardandoAprovacao ? 'Arquétipo: vibrante-direto' : null,
      fotosPropostas: [],
      etapas: [],
      temDist: false,
      telas: pngs(path.join(sessao, 'telas')),
      filme: pngs(path.join(sessao, 'filme')),
    }
  }

  const anotar = (nome, fn) => (...args) => {
    estado.consultas.push(nome)
    return fn(...args)
  }

  const motor = {
    dir: path.join(trabalho, '..', 'pacote-de-mentira'),
    estado: () => ({ instalado: true, motivo: null }),
    ambiente: async () => ({
      ok: true,
      headless: structuredClone(CONTRATO),
      modeloEsperado: 'claude-sonnet-5-5',
      aprovacaoHumana: false,
      // O motor de verdade devolve o caminho do navegador que achou nesta máquina.
      navegador: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    }),

    frase: async (pedido) => ({ frase: fraseDe(pedido), sites: pedido.tipo === 'analisar' ? sitesDe(pedido.observacoes) : [] }),

    conferirPedido: async (pedido) => {
      if (estado.recusa) throw recusa(estado.recusa)
      if (pedido.tipo === 'analisar') {
        const material = path.join(pastaDoCliente(pedido.pasta), 'material')
        const temMaterial = fs.existsSync(material) && fs.readdirSync(material).length > 0
        if (!temMaterial && !sitesDe(pedido.observacoes).length) throw recusa(`A pasta de "${pedido.pasta}" não tem nenhum arquivo do cliente para analisar.`)
      }
      if (pedido.tipo === 'cliente') {
        const c = conferir(pedido.pasta)
        if (!c.existe || c.erros.length) throw recusa(`BRIEFING RECUSADO (${c.erros.length}):\n${c.erros.map((erro, i) => `${i + 1}. ${erro}`).join('\n')}`)
        if (c.projetos.length && !pedido.refazer) throw recusa(`Este cliente já tem projeto: ${c.projetos.join(', ')}.`)
      }
      if (pedido.tipo === 'ajuste' || pedido.tipo === 'continuar') {
        const e = estadoDe(pedido.slug)
        if (pedido.tipo === 'ajuste' && e.etapaAberta) throw recusa(`A etapa "${e.etapaAberta}" de "${pedido.slug}" ainda está aberta.`)
        if (pedido.tipo === 'continuar' && e.aguardandoAprovacao) throw recusa(`"${pedido.slug}" ainda não foi aprovado.`)
        if (pedido.tipo === 'continuar' && e.entregue && !e.etapaAberta) throw recusa(`"${pedido.slug}" já foi entregue: não há o que continuar.`)
      }
      return { frase: fraseDe(pedido), sites: pedido.tipo === 'analisar' ? sitesDe(pedido.observacoes) : [] }
    },

    conferirBriefing: async (pasta) => conferir(pasta),
    revisao: async (pasta) => ({
      ...conferir(pasta),
      pasta,
      briefing: briefingDe(pasta)?.dados ?? null,
      fotos: [],
      opcoes: briefingDe(pasta)?.dados ? { multiplas_paginas: false, banco_de_imagens: true, skills: [], observacoes: '', ...(briefingDe(pasta).opcoes ?? {}) } : null,
      skillsDisponiveis: [],
      maxSkills: 3,
      bancos: [],
      aprovacaoHumana: false,
      limites: {},
    }),
    gravarBriefing: async (pasta, dados) => {
      estado.briefings[pasta] = { dados, erros: dados?.empresa?.ramo ? [] : ['empresa.ramo: obrigatório'], avisos: [] }
      return motor.revisao(pasta)
    },
    gravarOpcoes: async (pasta, opcoes) => {
      const briefing = briefingDe(pasta)
      if (!briefing) throw recusa(`Nenhum arquivo .json em ${path.join(pastaDoCliente(pasta), 'briefing')}.`)
      if ((opcoes.skills ?? []).length) throw recusa(`Skill não encontrada: ${opcoes.skills.join(', ')}.`)
      estado.briefings[pasta] = { ...briefing, opcoes }
      return motor.revisao(pasta)
    },

    estadoDoProjeto: async (slug) => ({ ok: true, ...estadoDe(slug) }),
    projeto: async (slug) => projeto(slug),
    aprovar: async (slug) => {
      estadoDe(slug)
      estado.projetos[slug] = { ...(estado.projetos[slug] ?? {}), aguardandoAprovacao: false, entregue: false }
      return { ok: true, aprovado: true, mensagens: ['Design brief aprovado. src/tokens.css gerado.'] }
    },
    abortar: async (slug) => {
      estadoDe(slug)
      estado.projetos[slug] = { ...(estado.projetos[slug] ?? {}), etapaAberta: null, entregue: false }
      return projeto(slug)
    },
    recusarFoto: async (slug) => projeto(slug),
    metricas: async (slug) => ({ ok: true, slug, etapas: [] }),

    gravarRunbook: async (arquivo) => {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true })
      fs.writeFileSync(arquivo, '# Runbook do modo CLI\n\n(runbook de teste)\n')
      return { ok: true, arquivo }
    },
    validar: async () => ({ ok: true, texto: 'BUILD OK. VALIDAÇÃO OK.' }),
    telas: async (slug) => {
      const dir = path.join(trabalho, 'projects', slug, '.session', 'telas')
      fs.mkdirSync(dir, { recursive: true })
      // Um PNG de 1 × 1: o bastante para o painel servir uma imagem de verdade.
      fs.writeFileSync(path.join(dir, 'desktop-topo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
    },
    filme: async () => undefined,
  }

  // Cada consulta fica anotada: os testes conferem que uma recusa veio antes de o motor ser incomodado.
  for (const nome of Object.keys(motor)) {
    if (typeof motor[nome] === 'function' && nome !== 'estado') motor[nome] = anotar(nome, motor[nome])
  }

  return { motor, estado }
}
