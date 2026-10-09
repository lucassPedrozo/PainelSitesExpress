import { StringDecoder } from "node:string_decoder";

/**
 * O que o `claude -p` escreve no stdout (`--output-format stream-json`): uma
 * linha de JSON por evento. Daqui saem as linhas legíveis do acompanhamento —
 * etapa atual, ferramenta em uso, comandos rodados — e o filtro do que pode ir
 * para a tela.
 *
 * O stream bruto fica em disco, inteiro. Ele carrega o conteúdo dos arquivos
 * que o agente leu e caminhos desta máquina; a tela recebe só as linhas
 * legíveis, e ainda assim filtradas.
 */

/**
 * @typedef {"sessao" | "etapa" | "ferramenta" | "comando" | "imagem" | "texto"
 *   | "saida" | "erro" | "aviso" | "resultado"} TipoDeLinha
 * @typedef {{ tipo: TipoDeLinha, texto: string }} Legivel
 */

/**
 * Junta os pedaços do stdout em linhas inteiras: uma linha (e um caractere
 * acentuado) pode chegar partida entre dois pedaços.
 *
 * @param {(linha: string) => void} onLinha
 */
export function leitorDeLinhas(onLinha) {
  const decoder = new StringDecoder("utf8");
  let resto = "";
  const consumir = (texto) => {
    resto += texto;
    for (let i = resto.indexOf("\n"); i >= 0; i = resto.indexOf("\n")) {
      const linha = resto.slice(0, i).replace(/\r$/, "");
      resto = resto.slice(i + 1);
      if (linha.trim()) onLinha(linha);
    }
  };
  return {
    /** @param {Buffer | string} pedaco */
    escrever: (pedaco) => consumir(typeof pedaco === "string" ? pedaco : decoder.write(pedaco)),
    fim: () => {
      consumir(decoder.end());
      if (resto.trim()) onLinha(resto.replace(/\r$/, ""));
      resto = "";
    },
  };
}

const cortar = (texto, n) => (texto.length > n ? `${texto.slice(0, n)}…` : texto);

/** "1m01s", "42s". */
export const duracao = (ms) => {
  const seg = Math.round(ms / 1000);
  return seg >= 60 ? `${Math.floor(seg / 60)}m${String(seg % 60).padStart(2, "0")}s` : `${seg}s`;
};

const textoDe = (conteudo) =>
  typeof conteudo === "string"
    ? conteudo
    : Array.isArray(conteudo)
      ? conteudo
          .map((bloco) => (bloco?.type === "text" ? String(bloco.text) : bloco?.type === "image" ? "(imagem)" : ""))
          .join("\n")
      : "";

/**
 * Linhas de um comando de Bash sem o corpo dos heredocs: o conteúdo de um
 * `write_file` não é progresso.
 * @param {string} comando
 */
function linhasDoComando(comando) {
  const linhas = [];
  let fim;
  for (const linha of comando.split("\n")) {
    if (fim) {
      if (linha.trim() === fim) fim = undefined;
      continue;
    }
    const heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(linha);
    if (heredoc) fim = heredoc[1];
    const limpa = linha.replace(/\s*<<-?\s*['"]?\w+['"]?.*$/, "").trim();
    if (limpa) linhas.push(limpa);
  }
  return linhas;
}

/** @returns {Legivel} */
function comandoLegivel(linha) {
  const inicio = /npm run (?:-s )?step -- start (\w+) (\S+)/.exec(linha);
  if (inicio) return { tipo: "etapa", texto: `Etapa ${inicio[1]} (${inicio[2]})` };
  const fim = /npm run (?:-s )?step -- end (\w+)/.exec(linha);
  if (fim) return { tipo: "comando", texto: `encerrando a etapa ${fim[1]}` };
  const ferramenta = /npm run (?:-s )?tool -- (\w+)(.*)$/.exec(linha);
  if (ferramenta) return { tipo: "ferramenta", texto: cortar(`${ferramenta[1]}${ferramenta[2]}`, 160) };
  return { tipo: "comando", texto: cortar(linha, 200) };
}

/**
 * Traduz os eventos do stream em linhas de progresso. Guarda o nome de cada
 * ferramenta nativa chamada, para não despejar o conteúdo dos arquivos que o
 * agente lê: de uma leitura sai só o caminho, nunca o que veio dela.
 *
 * @param {{ raiz?: string }} [opcoes] `raiz`: a pasta de trabalho do agente —
 *   os caminhos aparecem relativos a ela
 * @returns {(evento: unknown) => Legivel[]}
 */
export function criarFormatador({ raiz = "" } = {}) {
  const usos = new Map();
  const base = raiz ? `${raiz.replace(/\\/g, "/").replace(/\/+$/, "")}/` : "";
  const relativo = (caminho) => {
    const normal = String(caminho ?? "").replace(/\\/g, "/");
    return base && normal.toLowerCase().startsWith(base.toLowerCase()) ? normal.slice(base.length) : normal;
  };

  return (bruto) => {
    const ev = /** @type {any} */ (bruto);
    if (!ev || typeof ev !== "object") return [];
    if (ev.type === "joinvixable") {
      return ev.subtype === "aviso" ? [{ tipo: "aviso", texto: String(ev.texto) }] : [];
    }
    if (ev.type === "system" && ev.subtype === "init") {
      const mcp = (ev.mcp_servers ?? []).map((m) => `${m.name}${m.status ? ` (${m.status})` : ""}`);
      return [
        {
          tipo: "sessao",
          texto: `Sessão ${ev.session_id} · modelo ${ev.model} · servidores MCP: ${mcp.join(", ") || "nenhum"}`,
        },
      ];
    }
    if (ev.type === "assistant") {
      /** @type {Legivel[]} */
      const linhas = [];
      for (const bloco of ev.message?.content ?? []) {
        if (bloco.type === "text" && String(bloco.text).trim()) {
          linhas.push({ tipo: "texto", texto: String(bloco.text).trim() });
        }
        if (bloco.type !== "tool_use") continue;
        usos.set(bloco.id, bloco.name);
        if (bloco.name === "Bash") {
          linhas.push(...linhasDoComando(String(bloco.input?.command ?? "")).map(comandoLegivel));
        } else if (bloco.name === "Read" && /\.(png|jpe?g|webp|gif)$/i.test(String(bloco.input?.file_path))) {
          linhas.push({ tipo: "imagem", texto: relativo(bloco.input.file_path) });
        } else {
          const alvo = bloco.input?.file_path ?? bloco.input?.pattern ?? bloco.input?.path ?? bloco.input?.url ?? "";
          linhas.push({ tipo: "ferramenta", texto: cortar(`${bloco.name} ${relativo(alvo)}`.trim(), 160) });
        }
      }
      return linhas;
    }
    if (ev.type === "user") {
      /** @type {Legivel[]} */
      const linhas = [];
      for (const bloco of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (bloco.type !== "tool_result") continue;
        const texto = textoDe(bloco.content)
          .split("\n")
          .map((linha) => linha.trim())
          .filter(Boolean);
        if (bloco.is_error) {
          linhas.push({
            tipo: "erro",
            texto: cortar(texto.slice(0, 4).join(" · ") || "a ferramenta devolveu erro", 400),
          });
        } else if (usos.get(bloco.tool_use_id) === "Bash" && texto.length) {
          linhas.push({ tipo: "saida", texto: cortar(texto[0], 200) });
        }
      }
      return linhas;
    }
    if (ev.type === "result") {
      const custo =
        typeof ev.total_cost_usd === "number"
          ? ` · estimativa do Claude Code: US$ ${ev.total_cost_usd.toFixed(4)} (o consumo sai da assinatura)`
          : "";
      const resumo = `${duracao(Number(ev.duration_ms ?? 0))} · ${ev.num_turns ?? "?"} turnos${custo}`;
      return [
        ev.is_error || ev.subtype !== "success"
          ? {
              tipo: "erro",
              texto: `O claude terminou com erro (${ev.subtype}) em ${resumo}: ${cortar(String(ev.result ?? ""), 400)}`,
            }
          : { tipo: "resultado", texto: `O claude terminou em ${resumo}` },
      ];
    }
    return [];
  };
}

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O filtro do que vai para a tela.
 *
 * Mesmo as linhas legíveis podem trazer um caminho desta máquina (numa
 * mensagem de erro, na fala do agente) ou, no pior caso, um valor que não
 * deveria ter sido lido. Cada pasta conhecida vira um rótulo curto, e cada
 * segredo do painel que aparecer é coberto — o valor nunca chega ao navegador.
 *
 * @param {{
 *   pastas?: Array<[rotulo: string, caminho: string | null | undefined]>,
 *   segredos?: Array<string | null | undefined>,
 * }} [opcoes]
 * @returns {(texto: string) => string}
 */
export function criarFiltro({ pastas = [], segredos = [] } = {}) {
  // Da mais funda para a mais rasa: a pasta de trabalho fica dentro da do painel.
  const trocas = pastas
    .filter(([, caminho]) => typeof caminho === "string" && caminho.length > 3)
    .map(([rotulo, caminho]) => [rotulo, /** @type {string} */ (caminho).replace(/[\\/]+$/, "")])
    .sort((a, b) => b[1].length - a[1].length)
    .map(([rotulo, caminho]) => {
      // O mesmo caminho aparece com barra normal, invertida ou dobrada (dentro de um JSON).
      const partes = caminho.split(/[\\/]+/).map(escapar);
      return [rotulo, new RegExp(partes.join("(?:\\\\\\\\|\\\\|/)+"), "gi")];
    });
  const valores = [...new Set(segredos.filter((valor) => typeof valor === "string" && valor.length >= 8))].sort(
    (a, b) => /** @type {string} */ (b).length - /** @type {string} */ (a).length,
  );

  return (texto) => {
    let limpo = String(texto ?? "");
    for (const valor of valores) limpo = limpo.split(/** @type {string} */ (valor)).join("•••");
    for (const [rotulo, padrao] of trocas) limpo = limpo.replace(/** @type {RegExp} */ (padrao), /** @type {string} */ (rotulo));
    return limpo;
  };
}

/**
 * Aplica o filtro a uma lista de linhas legíveis.
 * @param {Legivel[]} legiveis
 * @param {(texto: string) => string} filtro
 * @returns {Legivel[]}
 */
export const filtrarLegiveis = (legiveis, filtro) =>
  legiveis.map((linha) => ({ tipo: linha.tipo, texto: filtro(linha.texto) }));
