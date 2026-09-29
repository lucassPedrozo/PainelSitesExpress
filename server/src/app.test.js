import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * A API de verdade — política de rede, autenticação, permissões e tratador de
 * erros — numa porta local, com uma pasta de dados temporária. Só rotas que
 * não saem da máquina: nada aqui chama Drive, GitHub ou Lovable.
 */

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "painel-app-"));
const MASTER_KEY = "chave-mestra-de-teste-0123456789";

process.env.PANEL_DATA_DIR = dataDir;
process.env.PANEL_ACCESS_TOKEN = "";
// Configurado só para as rotas de deploy chegarem à checagem de permissão;
// nenhum teste deixa a chamada ir ao GitHub.
process.env.GITHUB_TOKEN = "github_pat_teste_nao_usado";
process.env.GITHUB_ORG = "org-de-teste";
process.env.PREVIEW_WATCH_INTERVAL_MS = "0";

const { createApp } = await import("./app.js");
const { resetRuntimeConfig } = await import("./config.js");
const { AuthThrottle } = await import("./security/throttle.js");

/** Endereço da API que o bloco de testes em andamento está usando. */
let base;

/** Sobe uma instância da API; cada bloco tem a sua, com o seu bloqueio. */
const startApi = async (throttle) => {
  const app = createApp({ authentication: { throttle } });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  return () => new Promise((resolve) => server.close(resolve));
};

after(() => fs.rm(dataDir, { recursive: true, force: true }));

const quietly = async (fn) => {
  const { error, log } = console;
  console.error = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
    console.log = log;
  }
};

/** @param {string} pathname @param {RequestInit & { json?: unknown }} [init] */
const call = (pathname, { json, headers, ...init } = {}) =>
  quietly(async () => {
    const response = await fetch(base + pathname, {
      ...init,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return {
      status: response.status,
      body,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null,
    };
  });

const setMasterKey = (value) => {
  process.env.PANEL_ACCESS_TOKEN = value;
  resetRuntimeConfig();
};

const login = async (key) => {
  const response = await call("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.cookie;
};

describe("API — entrada e sessão", () => {
  let stop;
  // Bloqueio mais curto que o padrão, para o teste não esperar minutos.
  before(async () => {
    stop = await startApi(new AuthThrottle({ maxFailures: 3 }));
  });
  after(() => stop());

  it("sem chave nenhuma configurada, o painel local abre sem identidade", async () => {
    const gate = await call("/api/gate");
    assert.deepEqual(gate.body, { authenticationRequired: false, authenticated: true });

    const me = await call("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user, null);
    assert.deepEqual(me.body.permissions, ["organizar", "gerar", "publicar", "configurar", "administrar"]);
  });

  it("com a chave mestra definida, pede autenticação e troca a chave por cookie", async () => {
    setMasterKey(MASTER_KEY);

    const gate = await call("/api/gate");
    assert.deepEqual(gate.body, { authenticationRequired: true, authenticated: false });

    const anon = await call("/api/me");
    assert.equal(anon.status, 401);
    assert.equal(anon.body.code, "session-expired");

    const cookie = await login(MASTER_KEY);
    const me = await call("/api/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.kind, "admin");

    const gateComCookie = await call("/api/gate", { headers: { Cookie: cookie } });
    assert.equal(gateComCookie.body.authenticated, true);
  });

  it("chave errada bloqueia por IP, mas não derruba quem já tem sessão", async () => {
    const cookie = await login(MASTER_KEY);

    const tentativas = [];
    for (let n = 0; n < 4; n += 1) {
      const response = await call("/api/me", {
        headers: { Authorization: "Bearer chave-errada-000000000" },
      });
      tentativas.push(response.status);
    }
    assert.deepEqual(tentativas, [401, 401, 401, 429]);

    const comCookie = await call("/api/me", { headers: { Cookie: cookie } });
    assert.equal(comCookie.status, 200);
  });
});

describe("API — permissões, rede e erros", () => {
  let stop;
  // Instância nova: o bloqueio de IP do bloco anterior não vale aqui.
  before(async () => {
    setMasterKey(MASTER_KEY);
    stop = await startApi(new AuthThrottle());
  });
  after(() => stop());

  it("chave só com 'organizar' cria tag, mas não publica nem administra", async () => {
    const adminResponse = await call("/api/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${MASTER_KEY}` },
    });
    const admin = adminResponse.cookie;

    const criada = await call("/api/access-keys", {
      method: "POST",
      headers: { Cookie: admin },
      json: { name: "Bruna", permissions: ["organizar"] },
    });
    assert.equal(criada.status, 201);

    const bruna = (
      await call("/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${criada.body.key}` },
      })
    ).cookie;

    const tag = await call("/api/tags", {
      method: "POST",
      headers: { Cookie: bruna },
      json: { name: "Urgente", color: "red" },
    });
    assert.equal(tag.status, 201);

    const chaves = await call("/api/access-keys", { headers: { Cookie: bruna } });
    assert.equal(chaves.status, 403);

    const deploy = await call("/api/deploy/repositories/org-de-teste/site/deploy", {
      method: "POST",
      headers: { Cookie: bruna },
      json: { branch: "main" },
    });
    assert.equal(deploy.status, 403);
    assert.match(deploy.body.error, /publicar/);

    // Revogar corta a sessão aberta na hora.
    const revogada = await call(`/api/access-keys/${criada.body.user.id}`, {
      method: "DELETE",
      headers: { Cookie: admin },
    });
    assert.equal(revogada.body.sessionsClosed, 1);
    const depois = await call("/api/me", { headers: { Cookie: bruna } });
    assert.equal(depois.status, 401);
  });

  it("trocar a chave mestra derruba as sessões abertas com a antiga", async () => {
    const admin = (
      await call("/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${MASTER_KEY}` },
      })
    ).cookie;

    setMasterKey(`${MASTER_KEY}-nova`);
    try {
      const me = await call("/api/me", { headers: { Cookie: admin } });
      assert.equal(me.status, 401);
    } finally {
      setMasterKey(MASTER_KEY);
    }
  });

  it("configurar o painel depende da permissão da chave, não do endereço", async () => {
    const admin = (
      await call("/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${MASTER_KEY}` },
      })
    ).cookie;
    const sessao = async (name, permissions) => {
      const criada = await call("/api/access-keys", {
        method: "POST",
        headers: { Cookie: admin },
        json: { name, permissions },
      });
      return (
        await call("/api/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${criada.body.key}` },
        })
      ).cookie;
    };
    const carla = await sessao("Carla", ["configurar"]);
    const davi = await sessao("Davi", ["organizar", "gerar", "publicar", "administrar"]);

    // Mesmo no loopback, sem a permissão não há tela de configuração.
    const negado = await call("/api/settings", { headers: { Cookie: davi } });
    assert.equal(negado.status, 403);
    assert.match(negado.body.error, /configurar/);
    const statusDavi = await call("/api/deploy/status", { headers: { Cookie: davi } });
    assert.equal(statusDavi.body.configurable, false);

    const liberado = await call("/api/settings", { headers: { Cookie: carla } });
    assert.equal(liberado.status, 200);
    assert.ok(Array.isArray(liberado.body.sections));
    const statusCarla = await call("/api/deploy/status", { headers: { Cookie: carla } });
    assert.equal(statusCarla.body.configurable, true);
  });

  it("conexão com o Lovable concluída pelo endereço colado exige 'gerar' e o código", async () => {
    const admin = (
      await call("/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${MASTER_KEY}` },
      })
    ).cookie;
    const semCodigo = await call("/api/lovable/callback/manual", {
      method: "POST",
      headers: { Cookie: admin },
      json: { url: "http://localhost:3333/api/lovable/callback?state=abc" },
    });
    assert.equal(semCodigo.status, 400);
    assert.match(semCodigo.body.error, /código/);

    const recusada = await call("/api/lovable/callback/manual", {
      method: "POST",
      headers: { Cookie: admin },
      json: { url: "http://localhost:3333/api/lovable/callback?error=access_denied" },
    });
    assert.equal(recusada.status, 400);
    assert.match(recusada.body.error, /recusou/);

    // Sem autorização em andamento, um código qualquer não conecta nada.
    const avulsa = await call("/api/lovable/callback/manual", {
      method: "POST",
      headers: { Cookie: admin },
      json: { url: "http://localhost:3333/api/lovable/callback?code=x&state=y" },
    });
    assert.equal(avulsa.status, 400);
  });

  it("recusa origem cruzada e requisição vinda de proxy", async () => {
    const cruzada = await call("/api/gate", {
      headers: { Origin: "https://site-malicioso.example" },
    });
    assert.equal(cruzada.status, 403);

    const proxy = await call("/api/gate", {
      headers: { "X-Forwarded-For": "203.0.113.7" },
    });
    assert.equal(proxy.status, 403);
  });

  it("erros saem em JSON: rota inexistente, corpo inválido e id fora do padrão do Drive", async () => {
    const admin = (
      await call("/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${MASTER_KEY}` },
      })
    ).cookie;

    const inexistente = await call("/api/nao-existe", { headers: { Cookie: admin } });
    assert.equal(inexistente.status, 404);
    assert.equal(inexistente.body.error, "Rota não encontrada");

    const corpo = await call("/api/tags", {
      method: "POST",
      headers: { Cookie: admin, "Content-Type": "application/json" },
      body: "{ não é json",
    });
    assert.equal(corpo.status, 400);

    // Id malformado é recusado antes de qualquer consulta ao Drive.
    const id = await call(`/api/files/${encodeURIComponent("x' or '1'='1")}/raw`, {
      headers: { Cookie: admin },
    });
    assert.equal(id.status, 404);
    assert.equal(id.body.error, "Arquivo não encontrado.");
  });
});
