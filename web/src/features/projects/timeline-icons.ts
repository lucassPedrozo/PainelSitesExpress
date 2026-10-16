import { ClaudeIcon, LovableIcon, type IconComponent } from "@/components/brand-icons";
import {
  Eye,
  FilePlus2,
  FileText,
  Globe,
  Hammer,
  Inbox,
  Link2,
  Replace,
  Rocket,
  Send,
  Settings2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { TimelineIcon, TimelineTone } from "./project-timeline";

/**
 * Os mesmos ícones das ações do projeto: gerar, prévia, enviar, publicar. O
 * que o Lovable e o Claude fizeram leva a marca de cada um.
 */
export const timelineIcons: Record<TimelineIcon, IconComponent> = {
  received: Inbox,
  brief: FileText,
  material: FilePlus2,
  generated: Sparkles,
  linked: Link2,
  built: Hammer,
  changed: Replace,
  approval: Eye,
  delivered: Send,
  configured: Settings2,
  deploy: Rocket,
  live: Globe,
  failed: TriangleAlert,
  claude: ClaudeIcon,
  lovable: LovableIcon,
};

/** O círculo do ícone, no tom do acontecimento. */
export const timelineToneClass: Record<TimelineTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  danger: "bg-destructive-soft text-destructive",
};
