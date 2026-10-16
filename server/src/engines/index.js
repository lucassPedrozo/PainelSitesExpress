import { config } from "../config.js";
import { getStatus as lovableStatus } from "../lovable/oauth.js";
import { servicoClaude } from "./claude/service.js";

/**
 * Os motores que produzem os sites: o Lovable e o Claude — o Claude Code desta
 * máquina, pelo login da assinatura.
 *
 * Este registro só descreve e informa o estado de cada motor, para a tela de
 * Configurações. A geração em si mora nas rotas de cada um (`lovable/` e
 * `engines/claude/`), e cada geração escolhe o motor na própria tela.
 *
 * As gerações do Claude ficam registradas com `engine: "claude"`; as do
 * Lovable continuam sem o campo, e o painel as trata como `lovable`.
 */

/** @typedef {{ id: string, label: string, description: string, available: boolean, reason: string | null, details: Record<string, unknown> }} EngineStatus */

/**
 * O motor que a tela de geração traz marcado. Cada geração escolhe o seu; o
 * `.env` só diz qual vem pré-selecionado.
 */
export function activeEngineId() {
  const escolhido = (process.env.GENERATION_ENGINE ?? "").trim();
  return escolhido === "claude" ? "claude" : "lovable";
}

/** @returns {Promise<EngineStatus[]>} */
export async function engineStatuses() {
  const lovable = await lovableStatus().catch(() => ({ connected: false }));

  return [
    {
      id: "lovable",
      label: "Lovable",
      description: "Gera o site no Lovable pelo MCP; o repositório nasce ao conectar o projeto ao GitHub lá.",
      available: Boolean(lovable.connected),
      reason: lovable.connected ? null : "O painel não está conectado ao Lovable.",
      details: { connected: Boolean(lovable.connected), creditEnabled: config.lovable.enableGeneration },
    },
    claudeStatus(),
  ];
}

/**
 * O motor Claude: o pacote `joinvixable/` rodando o Claude Code desta
 * máquina. Disponível quando o pacote está instalado; gastar ainda depende da
 * trava dele (`CLAUDE_ENABLE_GENERATION`).
 *
 * @returns {EngineStatus}
 */
function claudeStatus() {
  const servico = servicoClaude();
  const pacote = servico.pacote();
  return {
    id: "claude",
    label: "Claude",
    description:
      "O Claude Code desta máquina escreve o briefing e o site, pelo login da assinatura; o painel envia o código ao GitHub e publica na área de aprovação.",
    available: pacote.instalado,
    reason: pacote.motivo,
    details: { installed: pacote.instalado, enabled: servico.liberacao().enabled },
  };
}
