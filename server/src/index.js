import path from "node:path";
import { createApp } from "./app.js";
import { assertStartupConfig, config, runtimeConfig } from "./config.js";
import { startDeployWatch } from "./deploy/watch.js";
import { startDevAreaWatch } from "./devarea/service.js";
import { resumeGenerationWatch } from "./lovable/progress.js";
import { startSharePreviewWatch } from "./preview/service.js";
import { configureSessionPersistence } from "./security/access.js";

/**
 * Partida do painel: confere a configuração, retoma as sessões e abre a porta.
 * As rotas e os middlewares moram em `app.js`, e cada grupo de rotas no seu
 * router em `routes/`.
 */

assertStartupConfig();

// Sessões sobrevivem ao reinício da API; em disco fica só o hash de cada id.
const sessoesCarregadas = configureSessionPersistence({
  file: path.join(config.dataDir, "sessions.json"),
});
if (sessoesCarregadas) {
  console.log(`[sessões] ${sessoesCarregadas} sessão(ões) retomada(s).`);
}

const server = createApp().listen(config.port, config.serverHost);

// O callback de `listen` do Express 5 dispara mesmo quando o bind falha, então
// o banner sai do evento `listening` — o único que só ocorre de fato ouvindo.
// Sem o handler de `error` abaixo, uma porta ocupada derrubava o processo em
// silêncio (código 0) logo depois de anunciar que a API tinha subido.
server.on("error", (/** @type {NodeJS.ErrnoException} */ err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `A porta ${config.port} já está em uso — provavelmente um \`npm run dev\` anterior ficou aberto.`,
    );
    console.error(
      `Descubra o processo com \`netstat -ano | findstr :${config.port}\` e encerre com \`taskkill /PID <pid> /F\`, ou defina outra porta em PORT no .env.`,
    );
  } else {
    console.error("Falha ao subir a API:", err?.message ?? err);
  }
  process.exit(1);
});

server.on("listening", () => {
  startSharePreviewWatch();
  void resumeGenerationWatch().catch((err) =>
    console.warn("[lovable] não retomou o acompanhamento:", err?.message ?? err),
  );
  startDeployWatch();
  startDevAreaWatch();
  console.log(`Painel Gerenciador em http://localhost:${config.port}`);
  console.log(`Pasta raiz: ${config.rootFolderId}`);
  console.log(
    "Política de rede: somente loopback e endereços privados; proxies são bloqueados.",
  );
  if (
    !runtimeConfig().panelAccessToken &&
    config.serverHost !== "127.0.0.1" &&
    config.serverHost !== "localhost"
  ) {
    console.warn(
      "Aviso: o painel está exposto à rede sem PANEL_ACCESS_TOKEN. Defina uma chave no .env.",
    );
  }
});
