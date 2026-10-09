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
  type LucideIcon,
} from "lucide-react";
import type { TimelineIcon } from "./project-timeline";

/** Os mesmos ícones das ações do card: gerar, prévia, enviar, publicar. */
export const timelineIcons: Record<TimelineIcon, LucideIcon> = {
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
};
