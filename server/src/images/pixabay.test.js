import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32 } from "node:zlib";
import { createPixabayClient, parseStockSelection, parseTerms } from "./pixabay.js";

/**
 * O cliente do Pixabay com `fetch` de mentira: nada sai para a rede, e o que
 * se prova é o que protege a chave e a geração — a chave nunca aparece numa
 * mensagem, e o painel só baixa foto de host do Pixabay.
 */

const KEY = "12345678-abcdef0123456789abcdef01";

const hit = (id, over = {}) => ({
  id,
  pageURL: `https://pixabay.com/photos/foto-${id}/`,
  tags: "padaria, pão",
  previewURL: `https://cdn.pixabay.com/photo/${id}_150.jpg`,
  webformatURL: `https://pixabay.com/get/${id}_640.jpg`,
  largeImageURL: `https://pixabay.com/get/${id}_1280.jpg`,
  imageWidth: 1920,
  imageHeight: 1280,
  user: "fotografa",
  ...over,
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Cliente com `fetch` gravado; `respond` decide a resposta de cada URL. */
const setup = (respond, { key = KEY } = {}) => {
  const calls = [];
  const client = createPixabayClient({
    apiKey: () => key,
    fetchImpl: async (url) => {
      const u = new URL(url);
      calls.push(u);
      return respond(u);
    },
  });
  return { client, calls };
};

describe("parseTerms", () => {
  it("aceita o formato do script e o da tela, com 5 de padrão", () => {
    assert.deepEqual(parseTerms(["hero:3", "sobre"]), [
      { term: "hero", quantity: 3, section: null },
      { term: "sobre", quantity: 5, section: null },
    ]);
    assert.deepEqual(parseTerms([{ term: " padaria  artesanal ", quantity: 99, section: "Hero" }]), [
      { term: "padaria artesanal", quantity: 10, section: "Hero" },
    ]);
  });

  it("recusa lista vazia, termo vazio e termos demais", () => {
    assert.throws(() => parseTerms([]), /ao menos um termo/);
    assert.throws(() => parseTerms([{ term: "  " }]), /termo de busca vazio/);
    assert.throws(() => parseTerms(Array(9).fill("x")), /no máximo 8/);
  });
});

describe("parseStockSelection", () => {
  it("normaliza, descarta id repetido e recusa id inválido", () => {
    assert.deepEqual(parseStockSelection(undefined), []);
    assert.deepEqual(
      parseStockSelection([
        { id: 7, term: "pão", section: "" },
        { id: "7", term: "pão" },
        { id: 8, term: "café", section: "sobre" },
      ]),
      [
        { id: 7, term: "pão", section: null },
        { id: 8, term: "café", section: "sobre" },
      ],
    );
    assert.throws(() => parseStockSelection([{ id: "../x", term: "pão" }]), /inválida/);
    assert.throws(() => parseStockSelection("7"), /inválida/);
    const demais = Array.from({ length: 81 }, (_, i) => ({ id: i + 1, term: "pão" }));
    assert.throws(() => parseStockSelection(demais), /no máximo 80/);
  });
});

describe("createPixabayClient", () => {
  it("busca com os parâmetros do script e devolve candidatas sem URL de imagem", async () => {
    const { client, calls } = setup(() => json({ hits: [hit(1), hit(2), hit(3)] }));
    const [resultado] = await client.searchTerms([{ term: "padaria", quantity: 2, section: "hero" }]);

    const params = calls[0].searchParams;
    assert.equal(params.get("q"), "padaria");
    assert.equal(params.get("image_type"), "photo");
    assert.equal(params.get("orientation"), "horizontal");
    assert.equal(params.get("lang"), "pt");
    assert.ok(Number(params.get("per_page")) >= 3);

    assert.equal(resultado.section, "hero");
    assert.equal(resultado.images.length, 3);
    assert.equal(resultado.images[0].id, 1);
    assert.ok(!JSON.stringify(resultado).includes("pixabay.com/get"));
  });

  it("guarda a busca e reaproveita as fotos vistas na hora de gerar", async () => {
    const { client, calls } = setup(() => json({ hits: [hit(1)] }));
    await client.searchTerms([{ term: "padaria", quantity: 1, section: null }]);
    await client.searchTerms([{ term: "Padaria", quantity: 1, section: null }]);
    const [foto] = await client.resolve([{ id: 1, term: "padaria", section: "Hero" }]);

    assert.equal(calls.length, 1);
    assert.equal(foto.name, "pixabay-hero-1.jpg");
    assert.equal(foto.path, "hero/pixabay-hero-1.jpg");
  });

  it("foto que não está no cache é conferida pelo id", async () => {
    const { client, calls } = setup((url) =>
      url.searchParams.get("id") === "5" ? json({ hits: [hit(5)] }) : json({ hits: [] }),
    );
    const [foto] = await client.resolve([{ id: 5, term: "café", section: null }]);
    assert.equal(foto.name, "pixabay-cafe-5.jpg");
    assert.equal(calls[0].searchParams.get("id"), "5");

    await assert.rejects(client.resolve([{ id: 6, term: "café", section: null }]), /não existe mais/);
  });

  it("sem chave, não chama a API", async () => {
    const { client, calls } = setup(() => json({ hits: [] }), { key: "" });
    await assert.rejects(
      client.searchTerms([{ term: "x", quantity: 1, section: null }]),
      (err) => err.status === 409 && /PIXABAY_API_KEY/.test(err.message),
    );
    assert.equal(calls.length, 0);
  });

  it("chave recusada vira mensagem clara, sem a chave", async () => {
    const { client } = setup(
      () => new Response("[ERROR 400] Invalid or missing API key", { status: 400 }),
    );
    await assert.rejects(client.searchTerms([{ term: "x", quantity: 1, section: null }]), (err) => {
      assert.match(err.message, /recusou a chave/);
      assert.ok(!err.message.includes(KEY));
      return true;
    });
  });

  it("limite de buscas vira 429", async () => {
    const { client } = setup(() => new Response("Too many", { status: 429 }));
    await assert.rejects(
      client.searchTerms([{ term: "x", quantity: 1, section: null }]),
      (err) => err.status === 429,
    );
  });

  it("miniatura vem do Pixabay pelo painel, só de host do Pixabay e só imagem", async () => {
    const { client, calls } = setup((url) => {
      if (url.pathname === "/api/") {
        const id = Number(url.searchParams.get("id"));
        return json({
          hits: [id === 9 ? hit(9, { webformatURL: "https://evil.example/9.jpg" }) : hit(id)],
        });
      }
      if (url.pathname.endsWith("/2_640.jpg")) {
        return new Response("<html>", { headers: { "content-type": "text/html" } });
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    });

    const miniatura = await client.thumbnail(1);
    assert.equal(miniatura.contentType, "image/jpeg");
    assert.equal(miniatura.bytes.length, 3);
    assert.ok(calls.some((url) => url.pathname.endsWith("/1_640.jpg")));

    await assert.rejects(client.thumbnail(2), /não devolveu uma imagem/);
    const antes = calls.length;
    await assert.rejects(client.thumbnail(9), /Endereço inesperado/);
    // Uma chamada à API (o id 9) e nenhum download do host estranho.
    assert.equal(calls.length, antes + 1);
  });

  it("o zip leva todas as fotos, uma pasta por grupo, na ordem da seleção", async () => {
    const { client } = setup((url) => {
      if (url.pathname === "/api/") return json({ hits: [hit(Number(url.searchParams.get("id")))] });
      const id = Number(url.pathname.match(/(\d+)_1280/)[1]);
      return new Response(Buffer.from(`foto-${id}`), { headers: { "content-type": "image/jpeg" } });
    });

    const fotos = await client.resolve([
      { id: 3, term: "pão", section: "Serviços" },
      { id: 1, term: "padaria", section: "hero" },
      { id: 2, term: "padaria", section: "hero" },
    ]);
    const zip = await client.buildZip(fotos);
    assert.equal(zip.name, "imagens-pixabay.zip");
    assert.equal(zip.contentType, "application/zip");
    assert.equal(zip.count, 3);

    const entradas = lerZip(zip.bytes);
    assert.deepEqual(
      entradas.map((item) => item.path),
      ["servicos/pixabay-servicos-3.jpg", "hero/pixabay-hero-1.jpg", "hero/pixabay-hero-2.jpg"],
    );
    assert.deepEqual(entradas.map((item) => item.conteudo), ["foto-3", "foto-1", "foto-2"]);
  });

  it("uma foto que falha derruba o zip inteiro", async () => {
    const { client } = setup((url) => {
      if (url.pathname === "/api/") return json({ hits: [hit(Number(url.searchParams.get("id")))] });
      if (url.pathname.includes("/2_")) return new Response("x", { status: 404 });
      return new Response(Buffer.from("ok"), { headers: { "content-type": "image/jpeg" } });
    });
    const fotos = await client.resolve([
      { id: 1, term: "pão", section: null },
      { id: 2, term: "pão", section: null },
    ]);
    await assert.rejects(client.buildZip(fotos), /pixabay-pao-2\.jpg.*falhou \(404\)/);
  });
});

/**
 * Lê o zip pelo diretório central — o caminho que os descompactadores usam —
 * e confere o CRC de cada arquivo.
 */
function lerZip(bytes) {
  const fim = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(fim), 0x06054b50);
  const total = bytes.readUInt16LE(fim + 10);
  let pos = bytes.readUInt32LE(fim + 16);
  const entradas = [];
  for (let i = 0; i < total; i++) {
    assert.equal(bytes.readUInt32LE(pos), 0x02014b50);
    const crc = bytes.readUInt32LE(pos + 16);
    const tamanho = bytes.readUInt32LE(pos + 20);
    const nomeLen = bytes.readUInt16LE(pos + 28);
    const local = bytes.readUInt32LE(pos + 42);
    const path = bytes.subarray(pos + 46, pos + 46 + nomeLen).toString("utf8");
    const inicio = local + 30 + bytes.readUInt16LE(local + 26);
    const dados = bytes.subarray(inicio, inicio + tamanho);
    assert.equal(crc32(dados), crc);
    entradas.push({ path, conteudo: dados.toString("utf8") });
    pos += 46 + nomeLen;
  }
  return entradas;
}
