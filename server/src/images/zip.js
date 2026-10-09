import { crc32 } from "node:zlib";

/**
 * Um `.zip` mínimo, em memória, sem compressão (método "store").
 *
 * As fotos de banco vão ao Lovable num anexo só: o teto de anexos por envio
 * vale por arquivo, e um zip leva quantas fotos couberem no limite de tamanho.
 * JPEG já é comprimido — "deflate" gastaria CPU para ganhar quase nada —, e
 * escrever o formato aqui evita uma dependência só para isso.
 *
 * Limites do formato sem ZIP64: até 65.535 arquivos e 4 GB. O painel fica
 * muito abaixo (o teto do anexo é de dezenas de MB).
 */

/** Bit 11: nomes em UTF-8 — "serviços/" chega com o "ç". */
const UTF8_FLAG = 0x0800;

/** Data e hora no formato do MS-DOS, que é o que o zip guarda. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * @param {Array<{ path: string, bytes: Buffer }>} entries
 * @param {{ date?: Date }} [options]
 * @returns {Buffer}
 */
export function createZip(entries, { date = new Date() } = {}) {
  if (entries.length > 0xffff) throw new Error("Arquivos demais para um zip sem ZIP64");

  const { time, day } = dosDateTime(date);
  const locais = [];
  const centrais = [];
  let offset = 0;

  for (const { path, bytes } of entries) {
    const nome = Buffer.from(path, "utf8");
    const crc = crc32(bytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // assinatura do cabeçalho local
    local.writeUInt16LE(20, 4); // versão mínima para extrair (2.0)
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // método: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); // tamanho comprimido
    local.writeUInt32LE(bytes.length, 22); // tamanho original
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28); // campo extra

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // assinatura do diretório central
    central.writeUInt16LE(20, 4); // feito pela versão 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nome.length, 28);
    // 30: extra, 32: comentário, 34: disco, 36: atributos internos — tudo 0
    central.writeUInt32LE(0, 38); // atributos externos
    central.writeUInt32LE(offset, 42); // onde começa o cabeçalho local

    locais.push(local, nome, bytes);
    centrais.push(central, nome);
    offset += local.length + nome.length + bytes.length;
  }

  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); // fim do diretório central
  fim.writeUInt16LE(entries.length, 8); // entradas neste disco
  fim.writeUInt16LE(entries.length, 10); // entradas no total
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(offset, 16);

  return Buffer.concat([...locais, diretorio, fim]);
}
