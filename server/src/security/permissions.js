/**
 * O que cada chave de acesso pode fazer. A lista mora em `shared/`, junto da
 * interface; aqui ficam as regras que o servidor aplica sobre ela.
 */
import { ACCESS_PERMISSIONS } from "../../../shared/access-permissions.js";

export { ACCESS_PERMISSIONS };

export const PERMISSION_LABELS = {
  organizar: "organizar projetos (tags e nomes)",
  gerar: "gerar sites no Lovable",
  publicar: "publicar sites",
  configurar: "configurar o painel",
  administrar: "administrar chaves de acesso",
};

/**
 * Chave gravada antes das permissões existirem não tem o campo, e é lida como
 * "pode tudo" — quem já usava o painel não perde acesso quando esta versão
 * sobe. Só a ausência do campo significa isso: lista vazia é a escolha
 * deliberada de não conceder nada além de ver.
 */
export const permissionsOf = (user) =>
  Array.isArray(user?.permissions)
    ? user.permissions
    : [...ACCESS_PERMISSIONS];

/** Descarta o que não é permissão conhecida, remove repetições e ordena. */
export const sanitizePermissions = (raw) => {
  if (!Array.isArray(raw)) return { error: "Informe a lista de permissões da chave." };
  const desconhecida = raw.find((item) => !ACCESS_PERMISSIONS.includes(item));
  if (desconhecida !== undefined) {
    return { error: `Permissão desconhecida: "${desconhecida}".` };
  }
  return { permissions: ACCESS_PERMISSIONS.filter((item) => raw.includes(item)) };
};

/**
 * Autoriza uma ação.
 *
 * Identidade ausente significa painel sem chave nenhuma — uso local de dono
 * único. Barrar ali quebraria quem roda tudo em 127.0.0.1 e nunca criou chave,
 * e não protegeria nada: quem está na máquina já lê o `.env`.
 */
export const identityAllows = (identity, permission) =>
  !identity || permissionsOf(identity).includes(permission);

/**
 * Middleware: exige uma permissão da chave que está falando.
 *
 * A tela desabilita o que a chave não pode, mas isso é conveniência — esconder
 * um botão não impede ninguém de chamar a API na mão. A recusa mora aqui.
 */
export const requirePermission = (permission) => (req, res, next) => {
  if (identityAllows(req.identity, permission)) return next();
  res.status(403).json({
    error: `Esta chave de acesso não tem permissão para ${PERMISSION_LABELS[permission]}.`,
  });
};
