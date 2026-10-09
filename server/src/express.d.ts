import type { Identity } from "./security/authenticate.js";

/**
 * `req.identity` é preenchido pelo middleware de autenticação. Fica ausente
 * quando o painel não pede chave nenhuma (uso local de dono único).
 */
declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
      /** O projeto criado no painel a que o `:id` da rota se refere. */
      localProject?: { id: string; name: string; kind?: string; createdAt: string; createdBy: string | null };
    }
  }
}

export {};
