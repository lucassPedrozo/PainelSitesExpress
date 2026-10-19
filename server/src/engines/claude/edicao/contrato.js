/**
 * O contrato do `claude -p` na edição livre: o que o agente pode fazer num
 * site de repositório (feito no Lovable, ou vinculado de fora), e as regras
 * que ele recebe no prompt de sistema.
 *
 * É outro contrato que o do motor. O motor só deixa o agente mexer no site
 * pelas ferramentas dele, com sessão, conteúdo em `content.json` e validação
 * própria — nada disso existe num site do Lovable. Aqui o agente edita os
 * arquivos do clone diretamente, e o que segura a qualidade e a segurança é:
 *
 * - a pasta de trabalho é o clone, e nada fora dela é legível;
 * - o agente não roda `git`, não instala pacote, não apaga nem move arquivo
 *   pelo shell, e não toca no que mantém o site compatível com o Lovable e
 *   com a publicação (`package.json`, travas de dependência, configuração do
 *   Vite, `.github/`, `.env`);
 * - quem decide se o ajuste vai ao GitHub é o painel, depois: o build tem de
 *   passar, nenhum import pode estar fora do `package.json` e nenhuma
 *   credencial pode estar no código.
 */

/** @type {import("../command.js").Contrato} */
export const CONTRATO_DA_EDICAO = Object.freeze({
  ferramentas: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
  modo_de_permissao: "dontAsk",
  fontes_de_configuracao: "user",
  configuracoes: { permissions: { blockReadsOutsideWorkingDirectories: true } },
  permitir: ["Read(./**)", "Edit(./**)", "Bash(npm run build)", "Bash(npm run lint)", "Bash(npm run -s build)"],
  permitir_no_briefing: [],
  negar: [
    "Bash(git *)",
    "Bash(npm install *)",
    "Bash(npm i *)",
    "Bash(npm ci *)",
    "Bash(npx *)",
    "Bash(bun *)",
    "Bash(pnpm *)",
    "Bash(yarn *)",
    "Bash(rm *)",
    "Bash(rmdir *)",
    "Bash(mv *)",
    "Bash(cp *)",
    "Bash(sed *)",
    "Bash(mkdir *)",
    "Bash(touch *)",
    "Bash(tee *)",
    "Bash(curl *)",
    "Bash(wget *)",
    "Bash(ssh *)",
    "Bash(scp *)",
    "Bash(ftp *)",
    "Bash(sftp *)",
    "Bash(cat *)",
    "Bash(head *)",
    "Bash(tail *)",
    "Bash(grep *)",
    "Bash(find *)",
    "Bash(ls *)",
    "Bash(wc *)",
    "Bash(diff *)",
    "Bash(stat *)",
    "Bash(du *)",
    "Edit(./.git/**)",
    "Edit(./.github/**)",
    "Edit(./package.json)",
    "Edit(./package-lock.json)",
    "Edit(./bun.lockb)",
    "Edit(./bun.lock)",
    "Edit(./pnpm-lock.yaml)",
    "Edit(./yarn.lock)",
    "Edit(./vite.config.*)",
    "Edit(./node_modules/**)",
    "Edit(./.env)",
    "Edit(./.env.*)",
    "Read(./.git/**)",
    "Read(//**/.env)",
    "Read(//**/.env.*)",
  ],
  variaveis_removidas: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ],
  variaveis_definidas: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
  esforco: { criacao: "high", ajuste: "high", briefing: "high" },
  cancelamento_espera_ms: 8000,
});

/**
 * Arquivos que o ajuste nunca muda. O contrato já os nega ao agente; o
 * painel confere de novo antes do commit.
 */
export const INTOCAVEIS = [
  /^\.git\//,
  /^\.github\//,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^bun\.lockb?$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^\.env(\..*)?$/,
  /(^|\/)node_modules\//,
];

/** O modelo e o esforço quando nem as Configurações dizem: qualidade primeiro. */
export const MODELO_PADRAO = "claude-opus-5-5";
export const ESFORCO_PADRAO = "high";

/** As regras do ajuste, anexadas ao prompt de sistema. */
export const REGRAS_DA_EDICAO = `# Ajuste de um site institucional pelo Painel Sites Express

Você está dentro do repositório de um site institucional de um cliente da Joinvix. O site foi feito no Lovable (React, Vite, TypeScript, Tailwind e, quase sempre, os componentes shadcn/ui em \`src/components/ui\`) e continua sendo editado lá: o Lovable e você trabalham no mesmo código, um de cada vez. Uma pessoa da Joinvix pediu uma alteração. Faça-a com o acabamento de quem fez o resto do site.

## Como trabalhar

- **Veja antes de mexer.** Ache onde está o que o pedido cita (Glob e Grep) e leia os arquivos envolvidos e os vizinhos que dão o padrão — a página, a seção, os componentes que ela usa, \`src/index.css\` e \`tailwind.config\`. Entenda como o site já resolve cores, espaçamentos, tipografia e movimento antes de escrever.
- **Entenda o que a pessoa quer ver.** Um pedido curto ("melhore o rodapé") pede uma solução de desenho, não a menor alteração possível: proponha uma composição melhor, dentro da linguagem visual do site, e construa. Quando o pedido diz do que ela não gostou, resolva isso e confira que o mesmo problema não aparece em outro lugar.
- **Preserve a identidade.** Use as cores, fontes, raios, sombras e componentes que o site já tem (as variáveis do tema, as classes do Tailwind configuradas, os componentes de \`src/components/ui\`). Não invente uma paleta nova nem misture outra família de fonte. Se o pedido exigir mudar a identidade, faça só o que ele pede e diga no resumo o que mudou.
- **Pense no celular.** Toda alteração precisa funcionar de 360 px a telas largas; confira as classes responsivas do que você escreveu e do que estava em volta.
- **Textos** em português do Brasil, com acentuação correta, no tom que o site já usa. Não invente dados do cliente (telefone, endereço, números, depoimentos): use os que já estão no site, ou deixe claro no resumo o que falta.

## O que não muda

- **Nada de dependências novas.** Use só o que está no \`package.json\`. Um import de pacote que não está lá quebra o build no GitHub e o painel recusa o envio. Ícones: os do pacote que o site já usa (normalmente \`lucide-react\`).
- **A estrutura do projeto fica.** Não mexa em \`package.json\`, nas travas de dependência, em \`vite.config\`, em \`.github/\` nem em \`.env\`; não renomeie nem mova pastas; não troque o roteador nem a forma como as páginas são montadas. É isso que mantém o site editável no Lovable depois do seu ajuste.
- **A assinatura da Joinvix** (a logo com link para joinvix.com.br no rodapé) continua lá, do mesmo tamanho. Nunca a remova.
- **Sem git.** O painel faz o commit e o envio depois que você terminar; você não roda git.
- **Nada de arquivos fora do pedido**: nada de README, notas, testes ou componentes de exemplo que o pedido não pediu.

## Imagens anexadas

Se o pedido trouxer imagens, elas estão listadas no pedido. As de **referência** ficam em \`.painel-anexos/\`: abra-as com Read para entender o pedido (uma captura do problema, um exemplo do resultado), mas não as copie para o site. As marcadas **para usar no site** já estão em \`public/\`, no caminho informado: use esse caminho.

## Antes de encerrar

1. Rode \`npm run build\` e corrija o que ele apontar, até passar sem erro.
2. Releia o que você mudou procurando o que um olho atento veria: alinhamento, espaçamento, contraste, quebra no celular, texto sem acento.
3. Encerre com um resumo curto, em português, para a pessoa que pediu: o que mudou, em quais arquivos, e qualquer dúvida ou limitação (por exemplo, um dado do cliente que faltou).
`;

/**
 * O pedido que vai ao claude pelo stdin: o que a pessoa escreveu, de onde o
 * ajuste parte e a memória dos ajustes anteriores neste site.
 *
 * @param {{
 *   pedido: string,
 *   base: { origin: string, author: string, message: string, at: string } | null,
 *   anteriores: Array<{ request: string, summary: string | null, status: string, finishedAt: string | null }>,
 *   anexos: Array<{ nome: string, caminho: string, usar: boolean }>,
 * }} params
 */
export function montarPedido({ pedido, base, anteriores, anexos }) {
  const partes = [`# Pedido de ajuste\n\n${pedido.trim()}`];

  if (base) {
    const quem = { lovable: "no Lovable", claude: "por você (Claude), num ajuste anterior pelo painel", person: `por ${base.author}`, panel: "pelo painel" }[base.origin] ?? "";
    partes.push(
      `## De onde você parte\n\nO repositório está na última versão do GitHub. A alteração mais recente no site foi feita ${quem} (${base.at.slice(0, 10)}): "${base.message}". Se ela foi feita no Lovable, o código pode ter mudado desde o seu último ajuste: leia o que está lá agora, não o que você lembra.`,
    );
  }

  const feitos = anteriores.filter((item) => item.status === "pushed" || item.status === "unchanged").slice(0, 8);
  if (feitos.length) {
    partes.push(
      `## Ajustes anteriores neste site (do mais recente para o mais antigo)\n\n${feitos
        .map((item) => `- ${(item.finishedAt ?? "").slice(0, 10)} — pedido: "${item.request.trim().slice(0, 400)}"${item.summary ? `\n  o que foi feito: ${item.summary.trim().slice(0, 500)}` : ""}`)
        .join("\n")}\n\nUse isso como contexto: não desfaça um ajuste anterior a não ser que o pedido peça.`,
    );
  }

  if (anexos.length) {
    partes.push(
      `## Imagens anexadas\n\n${anexos
        .map((anexo) => (anexo.usar ? `- ${anexo.nome}: para usar no site, já está em \`${anexo.caminho}\`` : `- ${anexo.nome}: referência, em \`${anexo.caminho}\``))
        .join("\n")}`,
    );
  }
  return `${partes.join("\n\n")}\n`;
}
