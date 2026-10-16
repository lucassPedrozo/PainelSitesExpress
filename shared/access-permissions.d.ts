/** Tipos de `access-permissions.js`, lidos pela interface e pelo typecheck da API. */
export declare const ACCESS_PERMISSIONS: readonly [
  "organizar",
  "gerar",
  "publicar",
  "configurar",
  "administrar",
];

export type AccessPermission = (typeof ACCESS_PERMISSIONS)[number];
