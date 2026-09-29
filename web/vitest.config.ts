import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Configuração dos testes em arquivo separado de propósito: declarar `test`
 * dentro do `vite.config.ts` obriga a usar o `defineConfig` do Vitest, e a
 * tipagem dos plugins do Vite 8 não casa com a que ele espera — o build
 * passava a falhar por um detalhe que nada tem a ver com o build.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  test: {
    // jsdom porque há teste de componente: a trava que impede mandar link
    // quebrado ao cliente só se prova renderizando.
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
