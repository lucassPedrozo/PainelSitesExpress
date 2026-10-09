import { get, send } from "./http";

/* ---- Assistente (Gemini) da tela de geração ------------------------- */

export type AssistantStatus = {
  /** Há chave do Gemini no servidor — o botão de analisar aparece. */
  configured: boolean;
  preferredModel: string | null;
  /** Os modelos que o painel tenta, na ordem. */
  models: string[];
};

export type BriefingAnalysis = {
  /** Que negócio é, onde atua e para quem — só com o que o briefing diz. */
  summary: string;
  /** O que o briefing não traz e um site institucional precisa. */
  missing: { label: string; detail: string }[];
  /** Instruções prontas para as observações; entram só quando inseridas. */
  suggestions: { title: string; text: string }[];
  /** Buscas para o banco de imagens, uma por seção do site. */
  imageQueries: { term: string; section: string; quantity: number; reason: string | null }[];
  model: string;
  analyzedAt: string;
  /** A mesma entrada já tinha sido analisada nas últimas 24 h. */
  cached: boolean;
};

export const fetchAssistantStatus = () => get<AssistantStatus>("/api/assistant/status");

/**
 * Analisa o briefing como está na tela. Não chama o Lovable nem gasta crédito
 * dele; usa a cota gratuita do Gemini, uma chamada por clique.
 */
export const analyzeBriefing = (
  projectId: string,
  body: { briefing: string; observations: string; projectName?: string; fileNames?: string[] },
) => send<BriefingAnalysis>("POST", `/api/projects/${projectId}/assistant/briefing`, body);
