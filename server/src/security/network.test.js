import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateNetworkAccess,
  isAllowedLocalHost,
  isLoopbackAddress,
  isLocalNetworkAddress,
  canAdministerAccessKeys,
} from './network.js'

test('aceita endereços privados e loopback', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.2.5', '172.31.255.1', '192.168.1.20', '169.254.2.1', '::1', 'fd12::8', 'fe80::1', '::ffff:192.168.0.9']) {
    assert.equal(isLocalNetworkAddress(address), true, address)
  }
})

test('rejeita endereços públicos e faixas fora da LAN', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.64.0.1', '2001:4860:4860::8888', undefined]) {
    assert.equal(isLocalNetworkAddress(address), false, String(address))
  }
})

test('aceita somente hosts locais ou explicitamente autorizados', () => {
  assert.equal(isAllowedLocalHost('localhost:4173'), true)
  assert.equal(isAllowedLocalHost('192.168.1.5:4173'), true)
  assert.equal(isAllowedLocalHost('desktop-joinvix:4173'), true)
  assert.equal(isAllowedLocalHost('painel.local:4173'), true)
  assert.equal(isAllowedLocalHost('deploy.intranet.example', ['deploy.intranet.example']), true)
  assert.equal(isAllowedLocalHost('deploy.example.com'), false)
})

test('bloqueia proxy e origem cruzada mesmo quando o IP é privado', () => {
  const base = { remoteAddress: '192.168.1.30', host: '192.168.1.5:4173' }
  assert.deepEqual(evaluateNetworkAccess(base), { allowed: true })
  assert.equal(evaluateNetworkAccess({ ...base, hasForwardingHeaders: true }).reason, 'forwarded-request')
  assert.equal(evaluateNetworkAccess({ ...base, origin: 'https://example.com' }).reason, 'cross-origin')
  assert.deepEqual(evaluateNetworkAccess({ ...base, origin: 'http://192.168.1.5:4173' }), { allowed: true })
})

test('distingue loopback de endereços privados da LAN', () => {
  for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(address), true, address)
  }

  // A tela de configuração usa isto: a LAN é local, mas não é a própria máquina.
  for (const address of ['192.168.1.20', '10.0.0.8', '172.16.2.5', 'fe80::1', '8.8.8.8', undefined]) {
    assert.equal(isLoopbackAddress(address), false, String(address))
  }
})

test('chaves de acesso: a máquina do painel administra sempre, a LAN só com a chave de administrador', () => {
  // Na própria máquina não importa quem é: quem senta nela já lê o `.env`.
  for (const isAdmin of [true, false]) {
    assert.equal(canAdministerAccessKeys({ remoteAddress: '127.0.0.1', isAdmin }), true)
    assert.equal(canAdministerAccessKeys({ remoteAddress: '::1', isAdmin }), true)
  }

  // Pela rede local, só a chave mestra do `.env`.
  assert.equal(canAdministerAccessKeys({ remoteAddress: '10.40.0.191', isAdmin: true }), true)
  assert.equal(canAdministerAccessKeys({ remoteAddress: '192.168.1.20', isAdmin: true }), true)
  assert.equal(canAdministerAccessKeys({ remoteAddress: '10.40.0.191', isAdmin: false }), false)

  // Sem identidade resolvida (painel sem chave nenhuma) a LAN continua fora.
  assert.equal(canAdministerAccessKeys({ remoteAddress: '10.40.0.191' }), false)

  // Endereço público não passa nem com a chave de administrador.
  assert.equal(canAdministerAccessKeys({ remoteAddress: '8.8.8.8', isAdmin: true }), false)
  assert.equal(canAdministerAccessKeys({ remoteAddress: undefined, isAdmin: true }), false)
})
