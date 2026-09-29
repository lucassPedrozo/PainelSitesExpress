import { config } from "../config.js";
import { aiConfig } from "../ai/providers.js";
import { getStatus as lovableStatus } from "../lovable/oauth.js";

/**
 * Os motores que produzem os sites. Hoje só o Lovable gera; o "Lovable
 * próprio" — o modelo de IA configurado escrevendo o código e publicando pelo
 * mesmo caminho do GitHub e da área de aprovação — está em preparação.
 *
 * Este registro só descreve e informa o estado de cada motor. A geração em si
 * continua nas rotas do Lovable, sem passar por aqui: escolher o motor não
 * muda nada até o motor próprio ser ligado.
 *
 * O caminho previsto do motor próprio, do briefing ao link de aprovação:
 *
 * 1. Entrada — o mesmo pacote do Lovable (`lovable/package.js`): briefing do
 *    Drive, observações e anexos recomendados.
 * 2. Projeto — cópia de um repositório-modelo da organização (Vite, React,
 *    TypeScript, Tailwind, com a assinatura e o modo SPA prontos), carregada
 *    no espaço de trabalho em memória (`own/workspace.js`). Os anexos do
 *    cliente entram em `src/assets/`.
 * 3. Geração — o modelo escreve src/, public/ e index.html pelas ferramentas
 *    de arquivo (`own/generate.js`). A configuração do projeto não muda.
 * 4. Repositório — um repositório novo na organização, com todos os arquivos
 *    num commit só. Não há "conectar ao GitHub": o repositório nasce ligado.
 * 5. Publicação — o workflow da área de aprovação, como nos sites do Lovable;
 *    daí em diante (link, envio, publicação no domínio) nada muda.
 * 6. Ajustes — "Responder" manda o pedido com os arquivos atuais; o modelo
 *    edita, o painel faz um commit, o push publica de novo.
 *
 * A geração fica registrada com `engine: "own"`; as do Lovable continuam sem o
 * campo, e o painel as trata como `lovable`.
 */

/** @typedef {{ id: string, label: string, description: string, available: boolean, reason: string | null, details: Record<string, unknown> }} EngineStatus */

export const ENGINE_IDS = ["lovable", "own"];

/** O motor escolhido no `.env`. Enquanto o próprio não gera, vale o Lovable. */
export function activeEngineId() {
  const escolhido = (process.env.GENERATION_ENGINE ?? "").trim();
  return escolhido === "own" ? "own" : "lovable";
}

/** @returns {Promise<EngineStatus[]>} */
export async function engineStatuses() {
  const lovable = await lovableStatus().catch(() => ({ connected: false }));
  const ia = aiConfig();

  return [
    {
      id: "lovable",
      label: "Lovable",
      description: "Gera o site no Lovable pelo MCP; o repositório nasce ao conectar o projeto ao GitHub lá.",
      available: Boolean(lovable.connected),
      reason: lovable.connected ? null : "O painel não está conectado ao Lovable.",
      details: { connected: Boolean(lovable.connected), creditEnabled: config.lovable.enableGeneration },
    },
    {
      id: "own",
      label: "Lovable próprio",
      description:
        "O modelo de IA configurado escreve o site num projeto-modelo da organização, e o painel publica pelo mesmo caminho da área de aprovação.",
      available: false,
      reason: "Em preparação: a arquitetura e o laço de geração estão prontos, mas ainda não ligados.",
      details: {
        aiConfigured: ia.configured,
        provider: ia.provider?.label ?? null,
        model: ia.model || null,
      },
    },
  ];
}
