import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { createZip } from "../images/zip.js";
import {
  decodeEntryName,
  entryContent,
  readZipDirectory,
  unreadableReason,
} from "./zip-reader.js";

/**
 * O leitor de zip contra arquivos de verdade, montados em memória: o que o
 * painel grava (`createZip`, sem compressão) e o que um compactador comum
 * entrega (deflate, nomes sem a marca de UTF-8, lixo do sistema, senha).
 */

/** Um zip como os de um compactador: método, marcas e nome cru por entrada. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.isBuffer(file.name) ? file.name : Buffer.from(file.name, "utf8");
    const data = file.data ?? Buffer.alloc(0);
    const method = file.method ?? 8;
    const stored = method === 8 ? deflateRawSync(data) : data;
    const flags = file.flags ?? 0x0800;
    // O cabeçalho local pode ter um campo extra que o índice não repete.
    const extra = file.localExtra ?? Buffer.alloc(0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE((14 << 11) | (30 << 5), 12); // 14:30
    central.writeUInt16LE(((2026 - 1980) << 9) | (9 << 5) | 17, 14); // 17/09/2026
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(file.declaredSize ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, extra, stored);
    centrals.push(central, name);
    offset += local.length + name.length + extra.length + stored.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** As duas leituras que a rota faz no Drive, sobre um zip em memória. */
const over = (zip) => {
  const reads = [];
  return {
    reads,
    readRange: async (start, end) => {
      reads.push([start, end]);
      return zip.subarray(start, end + 1);
    },
    // Em pedaços pequenos: o cabeçalho local chega partido, como na rede.
    stream: async function* (entry) {
      for (let at = entry.offset; at < entry.end; at += 7) {
        yield zip.subarray(at, Math.min(at + 7, entry.end));
      }
    },
  };
};

const contentOf = async (zip, entry) => {
  const chunks = [];
  for await (const chunk of entryContent(over(zip).stream(entry), entry)) chunks.push(chunk);
  return Buffer.concat(chunks);
};

describe("readZipDirectory", () => {
  it("lista e abre as entradas de um zip sem compressão, com acento no nome", async () => {
    const zip = createZip([
      { path: "serviços/fachada.jpg", bytes: Buffer.from("foto da fachada") },
      { path: "logo.png", bytes: Buffer.from("logo") },
    ]);
    const { entries, total, truncated } = await readZipDirectory(zip.length, over(zip).readRange);

    assert.deepEqual(entries.map((entry) => entry.path), ["serviços/fachada.jpg", "logo.png"]);
    assert.equal(total, 2);
    assert.equal(truncated, false);
    assert.equal((await contentOf(zip, entries[0])).toString(), "foto da fachada");
    assert.equal((await contentOf(zip, entries[1])).toString(), "logo");
  });

  it("abre entrada comprimida, mesmo com campo extra só no cabeçalho local", async () => {
    const texto = Buffer.from("Somos uma padaria de bairro. ".repeat(200));
    const zip = buildZip([
      { name: "sobre.txt", data: texto, localExtra: Buffer.alloc(28, 1) },
      { name: "vazio.txt", data: Buffer.alloc(0), method: 0 },
    ]);
    const { entries } = await readZipDirectory(zip.length, over(zip).readRange);

    assert.equal(entries[0].size, texto.length);
    assert.ok(entries[0].compressedSize < texto.length);
    assert.deepEqual(await contentOf(zip, entries[0]), texto);
    assert.equal((await contentOf(zip, entries[1])).length, 0);
  });

  it("guarda a data da entrada e deixa pastas e lixo do sistema de fora", async () => {
    const zip = buildZip([
      { name: "fotos/" },
      { name: "fotos/equipe.jpg", data: Buffer.from("x") },
      { name: "__MACOSX/fotos/._equipe.jpg", data: Buffer.from("x") },
      { name: "fotos/.DS_Store", data: Buffer.from("x") },
      { name: "Thumbs.db", data: Buffer.from("x") },
    ]);
    const { entries, total } = await readZipDirectory(zip.length, over(zip).readRange);

    assert.deepEqual(entries.map((entry) => entry.path), ["fotos/equipe.jpg"]);
    assert.equal(total, 1);
    assert.equal(entries[0].modifiedTime, new Date(2026, 8, 17, 14, 30).toISOString());
  });

  it("normaliza barras do Windows e tira `..` do caminho", async () => {
    const zip = buildZip([
      { name: "..\\..\\fotos\\loja.jpg", data: Buffer.from("x") },
      { name: "/abs/./a.txt", data: Buffer.from("x") },
    ]);
    const { entries } = await readZipDirectory(zip.length, over(zip).readRange);
    assert.deepEqual(entries.map((entry) => entry.path), ["fotos/loja.jpg", "abs/a.txt"]);
  });

  it("busca o índice numa segunda leitura quando ele não cabe no fim lido", async () => {
    const zip = buildZip(
      Array.from({ length: 30 }, (_, index) => ({
        name: `fotos/imagem-${index}.jpg`,
        data: Buffer.from(`foto ${index}`),
      })),
    );
    const leitor = over(zip);
    const { entries } = await readZipDirectory(zip.length, leitor.readRange, { tailBytes: 64 });

    assert.equal(entries.length, 30);
    assert.equal(leitor.reads.length, 2);
    assert.equal((await contentOf(zip, entries[29])).toString(), "foto 29");
  });

  it("recusa o que não é zip, com mensagem para a tela", async () => {
    const pdf = Buffer.from("%PDF-1.7 ".repeat(20));
    await assert.rejects(
      readZipDirectory(pdf.length, over(pdf).readRange),
      (err) => err.status === 422 && /não é um \.zip/.test(err.message),
    );
    await assert.rejects(readZipDirectory(0, over(Buffer.alloc(0)).readRange), { status: 422 });
  });

  it("recusa ZIP64 em vez de listar pela metade", async () => {
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("a") }]);
    zip.writeUInt32LE(0xffffffff, zip.length - 6); // onde começa o índice
    await assert.rejects(
      readZipDirectory(zip.length, over(zip).readRange),
      (err) => err.status === 422 && /ZIP64/.test(err.message),
    );
  });
});

describe("entryContent", () => {
  it("não abre entrada com senha nem compressão desconhecida", async () => {
    const zip = buildZip([
      { name: "contrato.pdf", data: Buffer.from("x"), method: 0, flags: 0x0801 },
      { name: "antigo.txt", data: Buffer.from("x"), method: 0 },
    ]);
    const { entries } = await readZipDirectory(zip.length, over(zip).readRange);

    assert.match(unreadableReason(entries[0]), /senha/);
    assert.throws(() => entryContent(over(zip).stream(entries[0]), entries[0]), { status: 422 });
    assert.equal(unreadableReason(entries[1]), null);
    assert.match(unreadableReason({ ...entries[1], method: 12 }), /compressão/);
  });

  it("corta a entrada que descomprime além do tamanho declarado", async () => {
    const zip = buildZip([
      { name: "bomba.txt", data: Buffer.alloc(200_000, 0x61), declaredSize: 10 },
    ]);
    const { entries } = await readZipDirectory(zip.length, over(zip).readRange);
    await assert.rejects(contentOf(zip, entries[0]), { status: 422 });
  });

  it("falha quando o zip acaba antes dos dados da entrada", async () => {
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("conteúdo"), method: 0 }]);
    const { entries } = await readZipDirectory(zip.length, over(zip).readRange);
    const cortado = { ...entries[0], end: entries[0].offset + 32 };
    await assert.rejects(contentOf(zip, cortado), { status: 422 });
  });
});

describe("decodeEntryName", () => {
  it("lê CP850 (Windows) quando o nome não é UTF-8", () => {
    // "Fotos da inauguração" como o Windows grava sem a marca de UTF-8.
    const cp850 = Buffer.from([
      ...Buffer.from("Fotos da inaugura"),
      0x87, // ç
      0xc6, // ã
      0x6f,
    ]);
    assert.equal(decodeEntryName(cp850, false), "Fotos da inauguração");
  });

  it("lê UTF-8 sem a marca, como o macOS grava", () => {
    assert.equal(decodeEntryName(Buffer.from("Serviços.pdf", "utf8"), false), "Serviços.pdf");
  });
});
