import { Eye, Link2, Network, Settings2, Sparkles } from "lucide-react";
import { ClaudeIcon, GeminiIcon, GitHubIcon, GoogleDriveIcon, type IconComponent } from "@/components/brand-icons";

/**
 * O ícone de cada seção das Configurações: a marca do serviço quando a seção
 * é de um (Drive, Claude, Gemini, GitHub), senão o mesmo ícone que a ação
 * correspondente tem no resto do painel (a área de aprovação é o olho de
 * "Publicar prévia"; o encurtador, o link do cliente).
 */
const icons: Record<string, IconComponent> = {
  drive: GoogleDriveIcon,
  generation: Sparkles,
  claude: ClaudeIcon,
  assistant: GeminiIcon,
  github: GitHubIcon,
  "dev-area": Eye,
  shortlinks: Link2,
  network: Network,
};

/** Seção nova, ainda sem ícone escolhido: a engrenagem das configurações. */
export const sectionIcon = (id: string): IconComponent => icons[id] ?? Settings2;
