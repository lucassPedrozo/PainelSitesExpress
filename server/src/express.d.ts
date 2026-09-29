import type { Identity } from "./security/authenticate.js";

/**
 * `req.identity` é preenchido pelo middleware de autenticação. Fica ausente
 * quando o painel não pede chave nenhuma (uso local de dono único).
 */
declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}

export {};
