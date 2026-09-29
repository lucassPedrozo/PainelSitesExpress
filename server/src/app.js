import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { deployRouter } from "./deploy/routes.js";
import { settingsRouter } from "./settings/routes.js";
import { errorHandler } from "./http.js";
import { lovableRouter } from "./lovable/routes.js";
import { accessRouter } from "./routes/access.js";
import { filesRouter } from "./routes/files.js";
import { projectsRouter } from "./routes/projects.js";
import { tagsRouter } from "./routes/tags.js";
import { createAuthentication } from "./security/authenticate.js";
import { localNetworkOnly } from "./security/network.js";

/**
 * Monta a aplicação sem abrir porta nenhuma.
 *
 * Separado do `index.js` para que os testes exercitem as rotas de verdade —
 * política de rede, autenticação, permissões — sem subir o painel inteiro, sem
 * a varredura de links e sem depender do Drive.
 *
 * @param {{ authentication?: Parameters<typeof createAuthentication>[0] }} [options]
 */
export function createApp({ authentication } = {}) {
  const app = express();

  app.disable("x-powered-by");

  // O painel guarda a chave da service account do Drive, o refresh_token do
  // Lovable e o token do GitHub. Nada disso deve ser alcançável de fora da
  // máquina — nem por origem cruzada, nem através de um proxy.
  app.use(localNetworkOnly(config.allowedHosts));

  app.use((_req, res, next) => {
    res.set({
      // 'unsafe-inline' em style-src é exigido pelo Radix, que posiciona
      // popovers e diálogos por atributo style.
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; " +
        "frame-ancestors 'none'; frame-src 'self'; img-src 'self' data: blob:; " +
        "media-src 'self' blob:; object-src 'none'; script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Permissions-Policy":
        "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
    });
    next();
  });

  app.use(express.json({ limit: "64kb" }));
  app.use(createAuthentication(authentication));

  app.use("/api", accessRouter);
  app.use("/api", projectsRouter);
  app.use("/api", tagsRouter);
  app.use("/api", filesRouter);
  /* Conexão com o Lovable e geração do site a partir do briefing. */
  app.use("/api", lovableRouter);
  /* Publicação dos repositórios via GitHub Actions + FTP. */
  app.use("/api/deploy", deployRouter);
  /* A tela de configuração do .env — só nesta máquina, só administrador. */
  app.use("/api", settingsRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Rota não encontrada" });
  });

  /**
   * Em produção o mesmo processo serve a interface: `npm run build && npm start`
   * sobe painel e API na mesma porta, sem outro servidor no meio.
   */
  if (existsSync(path.join(config.webDistPath, "index.html"))) {
    app.use(
      express.static(config.webDistPath, {
        index: false,
        setHeaders: (res, filePath) => {
          // Os assets levam hash no nome; o index.html não pode ser cacheado.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.set("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.get(/.*/, (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(config.webDistPath, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
