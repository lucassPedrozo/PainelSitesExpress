import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import { PanelGate } from "@/features/access/panel-gate";
import { forgetStoredAccessToken } from "./lib/access-token.ts";
import { createQueryClient } from "./lib/query.ts";
import "./index.css";

// Versões anteriores guardavam a chave de acesso no sessionStorage; ela sai
// daqui, antes de a interface montar.
forgetStoredAccessToken();

const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {/* Dentro do portão: as consultas da API só rodam depois que a sessão
            está aberta, porque é o portão que decide quando montar o painel. */}
        <PanelGate>
          <App />
        </PanelGate>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
