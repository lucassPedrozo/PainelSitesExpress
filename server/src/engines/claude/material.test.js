import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";
import { createZip } from "../../archive/zip-writer.js";
import {
  ARQUIVO_DAS_INFORMACOES,
  copiarMaterial,
  LIMITES_DO_MATERIAL,
  nomeDeFoto,
  nomeSeguro,
  pacoteDoMaterial,
  planoDoMaterial,
} from "./material.js";

/**
 * O material do cliente a caminho da pasta de trabalho do motor. Tudo aqui é
 * conteúdo de fora — nomes de arquivo do Drive, o que há dentro de um zip —,
 * então o que se prova é que nada disso escolhe onde o painel grava.
 */

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "painel-material-"));
after(() => fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

/** Uma pasta de coleta de mentira, no formato que a fonte do Drive entrega. */
const arquivo = (id, name, { trail = [], mimeType = "application/octet-stream", conteudo = "x", size, isBrief = false } = {}) => ({
  id,
  name,
  trail,
  mimeType,
  size: size === undefined ? Buffer.byteLength(conteudo) : size,
  modifiedTime: "2026-01-01T10:00:00.000Z",
  webViewLink: null,
  hasThumbnail: false,
  isBrief,
  abrir: async () => Readable.from([Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo)]),
});

const fonteCom = (arquivos, informacoes = { found: false }) => ({
  listar: async () => arquivos,
  informacoes: async () => informacoes,
});

const listar = (dir, prefixo = "") =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? listar(path.join(dir, item.name), `${prefixo}${item.name}/`) : [`${prefixo}${item.name}`],
  ).sort();

let seq = 0;
const novaPasta = () => {
  const base = path.join(raiz, `caso-${++seq}`);
  return { pastaDoCliente: path.join(base, "trabalho", "clientes", "cliente"), entrada: path.join(base, "entrada") };
};

describe("material do cliente — o que a tela de geração mostra", () => {
  it("classifica os arquivos: o que o Claude lê, o que ele não lê e o que vai com ressalva", async () => {
    const pacote = await pacoteDoMaterial("projeto", {
      fonte: fonteCom(
        [
          arquivo("1", "Informações do Site - cliente.com.br", { mimeType: "application/vnd.google-apps.document", isBrief: true }),
          arquivo("2", "fachada.jpg", { trail: ["fotos"], mimeType: "image/jpeg" }),
          arquivo("3", "apresentação.mp4", { mimeType: "video/mp4" }),
          arquivo("4", "audio do dono.mp3", { mimeType: "audio/mpeg" }),
          arquivo("5", "fotos.rar", {}),
          arquivo("6", "fotos.zip", { mimeType: "application/zip" }),
          arquivo("7", "Rodapé Escuro.png", { mimeType: "image/png" }),
          arquivo("8", "texto.doc", {}),
          arquivo("9", "Proposta", { mimeType: "application/vnd.google-apps.presentation" }),
          arquivo("10", "enorme.pdf", { mimeType: "application/pdf", size: LIMITES_DO_MATERIAL.maxBytesPorArquivo + 1 }),
        ],
        { found: true, text: "  Texto do formulário.  ", file: { id: "1", name: "Informações do Site - cliente.com.br" }, others: 0 },
      ),
    });
    const porNome = Object.fromEntries(pacote.files.map((file) => [file.name, file]));

    assert.deepEqual([pacote.prompt.found, pacote.prompt.text], [true, "  Texto do formulário.  "]);
    assert.deepEqual(
      Object.fromEntries(pacote.files.map((file) => [file.name, [file.recommended, file.blockedReason]])),
      {
        // O texto das informações já vai num arquivo próprio: o original não vem marcado.
        "Informações do Site - cliente.com.br": [false, null],
        "fachada.jpg": [true, null],
        "apresentação.mp4": [false, "O Claude não lê vídeo."],
        "audio do dono.mp3": [false, "O Claude não lê áudio."],
        "fotos.rar": [false, "Só arquivos .zip são abertos pelo painel."],
        "fotos.zip": [true, null],
        "Rodapé Escuro.png": [false, null],
        "texto.doc": [false, null],
        Proposta: [true, null],
        "enorme.pdf": [false, "Acima do limite de 100 MB"],
      },
    );
    assert.match(porNome["Rodapé Escuro.png"].attachWarning, /Assinatura antiga/);
    assert.match(porNome["texto.doc"].attachWarning, /não abre este formato/);
    assert.match(porNome["fotos.zip"].attachWarning, /abre o \.zip/);
    // Nativo do Google sai em PDF, e o tamanho só se conhece depois da exportação.
    assert.deepEqual([porNome.Proposta.uploadName, porNome.Proposta.exportedToPdf, porNome.Proposta.size], ["Proposta.pdf", true, null]);
    assert.deepEqual(pacote.files.slice(0, 3).map((file) => file.recommended), [true, true, true], "os marcados vêm primeiro");
  });

  it("o plano só aceita o que veio da varredura do projeto, dentro dos limites", async () => {
    const pacote = await pacoteDoMaterial("projeto", {
      fonte: fonteCom(
        [arquivo("a", "sobre.txt", { mimeType: "text/plain" }), arquivo("b", "video.mp4", { mimeType: "video/mp4" }), arquivo("c", "texto.doc")],
        { found: true, text: "Informações do formulário.", file: null, others: 0 },
      ),
    });

    const padrao = planoDoMaterial(pacote);
    assert.deepEqual([padrao.arquivos.map((file) => file.id), padrao.informacoes, padrao.observacoes], [["a"], "Informações do formulário.", ""]);
    // Marcar à mão o que vem desmarcado vale; texto vazio tira o arquivo das informações.
    const escolhido = planoDoMaterial(pacote, { fileIds: ["c", "a", "c"], texto: "  ", observacoes: "  Use\n\to  site  " });
    assert.deepEqual([escolhido.arquivos.map((file) => file.id), escolhido.informacoes, escolhido.observacoes], [["c", "a"], "", "Use o site"]);
    assert.deepEqual(planoDoMaterial(pacote, { fileIds: [] }).arquivos, []);

    const recusa = (entrada, padraoDaMensagem) =>
      assert.throws(() => planoDoMaterial(pacote, entrada), (erro) => erro.status === 400 && padraoDaMensagem.test(erro.message));
    recusa({ fileIds: "a" }, /Lista de arquivos inválida/);
    recusa({ fileIds: ["id-de-outro-projeto"] }, /não é deste projeto/);
    recusa({ fileIds: [{ id: "a" }] }, /não é deste projeto/);
    recusa({ fileIds: ["b"] }, /"video\.mp4": O Claude não lê vídeo/);
    recusa({ texto: 123 }, /Texto das informações inválido/);
    recusa({ texto: "x".repeat(LIMITES_DO_MATERIAL.maxCaracteresDoTexto + 1) }, /o limite é 40\.000/);
    recusa({ observacoes: ["a"] }, /Observações inválidas/);
    recusa({ observacoes: "x".repeat(LIMITES_DO_MATERIAL.maxCaracteresDasObservacoes + 1) }, /o limite é 2\.000/);

    const muitos = await pacoteDoMaterial("projeto", {
      fonte: fonteCom(Array.from({ length: LIMITES_DO_MATERIAL.maxArquivos + 1 }, (_, n) => arquivo(`f${n}`, `f${n}.txt`, { mimeType: "text/plain" }))),
    });
    assert.throws(() => planoDoMaterial(muitos), /Selecione no máximo 300 arquivos/);
  });
});

describe("material do cliente — nomes em disco", () => {
  it("nenhum nome que veio de fora vira caminho sem ser limpo", () => {
    assert.deepEqual(
      ['../../etc/passwd', 'a\\b:c*d?"e<f>g|h', "  .oculto  ", "nome.", "CON", "nul.txt", "", "ç ã é.txt", "linha\nquebrada\t.txt"].map(nomeSeguro),
      ["-..-etc-passwd", "a-b-c-d--e-f-g-h", "oculto", "nome", "_CON", "_nul.txt", "arquivo", "ç ã é.txt", "linha-quebrada-.txt"],
    );
    const longo = nomeSeguro(`${"a".repeat(300)}.jpeg`);
    assert.deepEqual([longo.length, longo.endsWith(".jpeg")], [120, true]);
  });

  it("a foto ganha um nome de site: minúsculas, sem acento nem espaço", () => {
    assert.deepEqual(
      ["Fachada da Loja (1).JPG", "ÓTIMA  foto_ação.jpeg", "LOGO.PNG", "...webp", "çãé.avif", `${"x".repeat(100)}.png`].map(nomeDeFoto),
      ["fachada-da-loja-1.jpg", "otima-foto-acao.jpg", "logo.png", "foto.webp", "cae.avif", `${"x".repeat(60)}.png`],
    );
  });
});

describe("material do cliente — a cópia para a pasta de trabalho", () => {
  const origemDe = (arquivos) => new Map(arquivos.map((item) => [item.id, item]));
  const descritos = async (arquivos) => (await pacoteDoMaterial("p", { fonte: fonteCom(arquivos) })).files;

  it("copia o que foi marcado, abre o zip e troca a cópia anterior por inteiro", async () => {
    const { pastaDoCliente, entrada } = novaPasta();
    // Uma cópia anterior e o briefing que já existia.
    fs.mkdirSync(path.join(pastaDoCliente, "material", "velho"), { recursive: true });
    fs.writeFileSync(path.join(pastaDoCliente, "material", "velho", "desmarcado.txt"), "não vale mais");
    fs.mkdirSync(path.join(pastaDoCliente, "briefing"), { recursive: true });
    fs.writeFileSync(path.join(pastaDoCliente, "briefing", "briefing.json"), "{}");

    const zip = createZip([
      { path: "Fotos/Equipe.JPG", bytes: Buffer.from("equipe") },
      { path: "../../fora-da-pasta.txt", bytes: Buffer.from("zip malicioso") },
      { path: "__MACOSX/._lixo", bytes: Buffer.from("lixo") },
      { path: "video.mov", bytes: Buffer.from("video") },
      { path: "outro.zip", bytes: Buffer.from("zip") },
    ]);
    const arquivos = [
      arquivo("1", "Sobre a empresa.txt", { trail: ["Textos", "..", "CON"], mimeType: "text/plain", conteudo: "sobre" }),
      arquivo("2", "Equipe.jpg", { trail: ["Fotos"], mimeType: "image/jpeg", conteudo: "equipe-solta" }),
      arquivo("3", "Material extra.zip", { mimeType: "application/zip", conteudo: zip }),
      arquivo("4", "Proposta", { mimeType: "application/vnd.google-apps.document", conteudo: "%PDF-1.7" }),
    ];
    const resultado = await copiarMaterial({
      pastaDoCliente,
      entrada,
      arquivos: await descritos(arquivos),
      origem: origemDe(arquivos),
      informacoes: "  Loja aberta desde 2015.  ",
      fotosDeBanco: [{ path: "hero/pixabay-hero-123.jpg", bytes: Buffer.from("banco") }],
    });

    assert.deepEqual(listar(path.join(pastaDoCliente, "material")), [
      "Fotos/equipe.jpg",
      "Material extra/Fotos/equipe-2.jpg",
      "Material extra/fora-da-pasta.txt",
      "Proposta.pdf",
      // ".." como nome de pasta não sobe de nível: vira uma pasta qualquer, dentro do material.
      "Textos/arquivo/_CON/Sobre a empresa.txt",
      "fotos-de-banco/hero/pixabay-hero-123.jpg",
      ARQUIVO_DAS_INFORMACOES,
    ].sort());
    assert.equal(fs.readFileSync(path.join(pastaDoCliente, "material", ARQUIVO_DAS_INFORMACOES), "utf8"), "Loja aberta desde 2015.\n");
    assert.deepEqual([resultado.arquivos, resultado.bytes > 0], [7, true]);
    assert.deepEqual(resultado.pulados, [
      "Material extra.zip › video.mov: O Claude não lê vídeo.",
      "Material extra.zip › outro.zip: Compactado dentro de compactado não é aberto.",
    ]);
    // O zip que tentava sair da pasta ficou dentro dela; a pasta do briefing não foi tocada; nada sobrou da montagem.
    assert.equal(fs.existsSync(path.join(pastaDoCliente, "..", "..", "fora-da-pasta.txt")), false);
    assert.deepEqual(fs.readdirSync(path.join(pastaDoCliente, "briefing")), ["briefing.json"]);
    assert.deepEqual(fs.readdirSync(entrada), []);
  });

  it("estourou um limite no meio: a cópia anterior fica como estava e nada sobra", async () => {
    const { pastaDoCliente, entrada } = novaPasta();
    fs.mkdirSync(path.join(pastaDoCliente, "material"), { recursive: true });
    fs.writeFileSync(path.join(pastaDoCliente, "material", "de-antes.txt"), "continua aqui");

    const arquivos = [
      arquivo("1", "a.txt", { mimeType: "text/plain", conteudo: "12345" }),
      arquivo("2", "b.txt", { mimeType: "text/plain", conteudo: "12345" }),
      arquivo("3", "c.zip", { mimeType: "application/zip", conteudo: createZip([{ path: "d.txt", bytes: Buffer.from("12345") }, { path: "e.txt", bytes: Buffer.from("12345") }]) }),
    ];
    const copiar = (limites, quais = arquivos) =>
      descritos(quais).then((lista) => copiarMaterial({ pastaDoCliente, entrada, arquivos: lista, origem: origemDe(quais), limites }));
    const folgado = { maxArquivos: 100, maxBytesPorArquivo: 10_000, maxBytesTotal: 10_000 };

    await assert.rejects(copiar({ ...folgado, maxBytesPorArquivo: 4 }), (erro) => erro.status === 413 && /passa de/.test(erro.message));
    await assert.rejects(copiar({ ...folgado, maxBytesTotal: 12 }), (erro) => erro.status === 413 && /O material passa de/.test(erro.message));
    // O que há dentro do zip conta como arquivo do material.
    await assert.rejects(copiar({ ...folgado, maxArquivos: 3 }), (erro) => erro.status === 413 && /passa de 3 arquivos/.test(erro.message));
    // Arquivo que sumiu do projeto entre a tela e o pedido.
    await assert.rejects(
      copiarMaterial({ pastaDoCliente, entrada, arquivos: await descritos(arquivos), origem: new Map() }),
      (erro) => erro.status === 400,
    );
    // A leitura da origem falha no meio (o Drive caiu).
    const quebrado = [{ ...arquivos[0], abrir: async () => Readable.from((async function* falha() { yield Buffer.from("12"); throw new Error("o Drive caiu"); })()) }];
    await assert.rejects(copiarMaterial({ pastaDoCliente, entrada, arquivos: await descritos(quebrado), origem: origemDe(quebrado) }), /o Drive caiu/);

    assert.deepEqual(listar(path.join(pastaDoCliente, "material")), ["de-antes.txt"]);
    assert.deepEqual(fs.readdirSync(entrada), []);

    // Dentro dos limites, a mesma seleção passa: o zip em si não conta, só o conteúdo dele.
    const ok = await copiar({ ...folgado, maxArquivos: 4, maxBytesTotal: 20 });
    assert.deepEqual([ok.arquivos, ok.bytes], [4, 20]);
    assert.deepEqual(listar(path.join(pastaDoCliente, "material")), ["a.txt", "b.txt", "c/d.txt", "c/e.txt"]);
  });

  it("Word, Excel e PowerPoint viram texto que o agente lê, com as imagens embutidas ao lado", async () => {
    const { pastaDoCliente, entrada } = novaPasta();
    const foto = Buffer.alloc(9000, 1);
    const docx = createZip([
      {
        path: "word/document.xml",
        bytes: Buffer.from(
          '<w:document><w:body><w:p><w:r><w:t>Serviços &amp; preços</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Limpeza</w:t><w:tab/><w:t>predial</w:t><w:br/><w:t>e pós-obra</w:t></w:r></w:p>' +
            '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Pintura</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>R&#36; 30/m&#xB2;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
            "</w:body></w:document>",
        ),
      },
      { path: "word/media/image1.jpeg", bytes: foto },
      { path: "word/media/icone.png", bytes: Buffer.alloc(200, 2) },
    ]);
    const xlsx = createZip([
      { path: "xl/sharedStrings.xml", bytes: Buffer.from("<sst><si><t>Serviço</t></si><si><r><t>Pin</t></r><r><t>tura</t></r></si></sst>") },
      {
        path: "xl/worksheets/sheet1.xml",
        bytes: Buffer.from('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Preço</t></is></c></row><row><c r="A2" t="s"><v>1</v></c><c r="B2"><v>30</v></c></row><row><c r="A3"/></row></sheetData></worksheet>'),
      },
    ]);
    const pptx = createZip([
      { path: "ppt/slides/slide2.xml", bytes: Buffer.from("<p:sld><a:p><a:r><a:t>Segundo</a:t></a:r></a:p></p:sld>") },
      { path: "ppt/slides/slide1.xml", bytes: Buffer.from("<p:sld><a:p><a:r><a:t>Quem somos</a:t></a:r></a:p><a:p><a:r><a:t>Desde 2015</a:t></a:r></a:p></p:sld>") },
    ]);
    const arquivos = [
      arquivo("1", "Dados de Serviços.docx", { trail: ["Textos"], conteudo: docx }),
      arquivo("2", "precos.xlsx", { conteudo: xlsx }),
      arquivo("3", "apresentacao.pptx", { conteudo: pptx }),
      arquivo("4", "tudo.zip", { mimeType: "application/zip", conteudo: createZip([{ path: "dentro/lista.docx", bytes: docx }]) }),
      // Tem nome de Word, mas não é: segue como está, para a pessoa conferir.
      arquivo("5", "quebrado.docx", { conteudo: "isto não é um docx" }),
      arquivo("6", "vazio.docx", { conteudo: createZip([{ path: "word/document.xml", bytes: Buffer.from("<w:document><w:body/></w:document>") }]) }),
    ];
    const descricao = await descritos(arquivos);
    assert.deepEqual(descricao.slice(0, 3).map((file) => [file.recommended, file.convertedToText]), [[true, true], [true, true], [true, true]]);
    assert.match(descricao[0].attachWarning, /entrega ao Claude o texto e as imagens/);

    const resultado = await copiarMaterial({ pastaDoCliente, entrada, arquivos: descricao, origem: origemDe(arquivos) });
    const material = path.join(pastaDoCliente, "material");
    assert.deepEqual(listar(material), [
      "Textos/Dados de Serviços-imagens/image1.jpg",
      "Textos/Dados de Serviços.docx.txt",
      "apresentacao.pptx.txt",
      "precos.xlsx.txt",
      "quebrado.docx",
      "tudo/dentro/lista-imagens/image1-2.jpg",
      "tudo/dentro/lista.docx.txt",
    ].sort());
    assert.equal(
      fs.readFileSync(path.join(material, "Textos", "Dados de Serviços.docx.txt"), "utf8"),
      'Texto extraído pelo painel de "Dados de Serviços.docx".\n\nServiços & preços\nLimpeza\tpredial\ne pós-obra\nPintura\tR$ 30/m²\n',
    );
    assert.match(fs.readFileSync(path.join(material, "precos.xlsx.txt"), "utf8"), /# Planilha 1\n\nServiço\tPreço\nPintura\t30\n$/);
    assert.match(fs.readFileSync(path.join(material, "apresentacao.pptx.txt"), "utf8"), /# Slide 1\n\nQuem somos\nDesde 2015\n\n# Slide 2\n\nSegundo\n$/);
    assert.deepEqual(resultado.pulados, ["vazio.docx: o documento está vazio, ou o painel não achou texto nele."]);
    assert.equal(resultado.arquivos, 7);
    assert.deepEqual(fs.readdirSync(entrada), []);
  });

  it("arquivo que não é zip de verdade é recusado com a mensagem do painel", async () => {
    const { pastaDoCliente, entrada } = novaPasta();
    const arquivos = [arquivo("1", "fotos.zip", { mimeType: "application/zip", conteudo: "isto não é um zip, é só texto com nome de zip" })];
    await assert.rejects(
      copiarMaterial({ pastaDoCliente, entrada, arquivos: await descritos(arquivos), origem: origemDe(arquivos) }),
      (erro) => erro.status === 422 && /não é um \.zip/.test(erro.message),
    );
    assert.equal(fs.existsSync(path.join(pastaDoCliente, "material")), false);
    assert.deepEqual(fs.readdirSync(entrada), []);
  });
});
