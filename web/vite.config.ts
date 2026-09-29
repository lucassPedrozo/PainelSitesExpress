import path from "path"
import { defineConfig, searchForWorkspaceRoot } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    // O código compartilhado com a API mora fora de web/. Libera só essa
    // pasta — e não a raiz do projeto, onde estão o .env e a chave do Drive.
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        path.resolve(import.meta.dirname, "../shared"),
      ],
    },
    proxy: {
      // `changeOrigin` fica desligado de propósito: a API só aceita requisições
      // cujo Origin bate com o Host, e reescrever o Host aqui derrubaria toda
      // chamada do dev server com 403.
      "/api": {
        target: "http://localhost:3333",
        changeOrigin: false,
      },
    },
  },
})
