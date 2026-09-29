/** Tipos de `access-permissions.js`, para a interface em TypeScript. */
export declare const ACCESS_PERMISSIONS: readonly [
  "organizar",
  "gerar",
  "publicar",
  "configurar",
  "administrar",
];

export type AccessPermission = (typeof ACCESS_PERMISSIONS)[number];
