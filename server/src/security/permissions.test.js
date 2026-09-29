import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACCESS_PERMISSIONS,
  identityAllows,
  permissionsOf,
  requirePermission,
  sanitizePermissions,
} from './permissions.js'

test('chave anterior às permissões vale como "pode tudo"', () => {
  // Migração: o campo não existe nos registros gravados antes desta versão.
  assert.deepEqual(permissionsOf({ name: 'Antiga' }), ACCESS_PERMISSIONS)
  assert.deepEqual(permissionsOf({ name: 'Antiga', permissions: null }), ACCESS_PERMISSIONS)

  // Lista vazia é escolha deliberada, não ausência: não vira "pode tudo".
  assert.deepEqual(permissionsOf({ permissions: [] }), [])
})

test('sanitiza a lista vinda da API', () => {
  assert.deepEqual(sanitizePermissions(['gerar', 'organizar']).permissions, ['organizar', 'gerar'])
  // Repetição não duplica, e a ordem sai canônica.
  assert.deepEqual(sanitizePermissions(['gerar', 'gerar']).permissions, ['gerar'])
  assert.deepEqual(sanitizePermissions([]).permissions, [])

  assert.match(sanitizePermissions(['voar']).error, /desconhecida/)
  assert.match(sanitizePermissions('gerar').error, /lista/)
  assert.match(sanitizePermissions(undefined).error, /lista/)
})

test('autoriza pela lista da identidade', () => {
  const maria = { kind: 'user', permissions: ['organizar', 'gerar'] }
  assert.equal(identityAllows(maria, 'organizar'), true)
  assert.equal(identityAllows(maria, 'gerar'), true)
  assert.equal(identityAllows(maria, 'publicar'), false)
  assert.equal(identityAllows(maria, 'administrar'), false)

  // Painel sem chave nenhuma: não há identidade, e tudo é permitido.
  assert.equal(identityAllows(undefined, 'publicar'), true)
  assert.equal(identityAllows(null, 'administrar'), true)

  // Chave antiga, sem o campo: pode tudo.
  assert.equal(identityAllows({ kind: 'user' }, 'publicar'), true)
})

test('o middleware recusa com 403 e diz qual permissão falta', () => {
  const semPublicar = { identity: { kind: 'user', permissions: ['gerar'] } }
  let status = null
  let corpo = null
  const res = {
    status(code) {
      status = code
      return this
    },
    json(payload) {
      corpo = payload
    },
  }

  let passou = false
  requirePermission('publicar')(semPublicar, res, () => {
    passou = true
  })
  assert.equal(passou, false)
  assert.equal(status, 403)
  assert.match(corpo.error, /publicar sites/)

  // Com a permissão, segue adiante sem tocar na resposta.
  requirePermission('gerar')(semPublicar, res, () => {
    passou = true
  })
  assert.equal(passou, true)
})
