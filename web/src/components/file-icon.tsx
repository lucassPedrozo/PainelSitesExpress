import {
  Archive,
  File,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  Image,
  Music,
  Presentation,
  Video,
} from "lucide-react";
import type { FileKind } from "@/lib/api";
import { cn } from "@/lib/utils";

const icons: Record<FileKind, typeof File> = {
  folder: Folder,
  image: Image,
  video: Video,
  audio: Music,
  pdf: FileType,
  sheet: FileSpreadsheet,
  slides: Presentation,
  doc: FileText,
  archive: Archive,
  other: File,
};

const tones: Record<FileKind, string> = {
  folder: "text-amber-500",
  image: "text-violet-500",
  video: "text-rose-500",
  audio: "text-cyan-500",
  pdf: "text-red-500",
  sheet: "text-emerald-500",
  slides: "text-orange-500",
  doc: "text-blue-500",
  archive: "text-zinc-500",
  other: "text-muted-foreground",
};

export function FileIcon({
  kind,
  className,
}: {
  kind: FileKind;
  className?: string;
}) {
  const Icon = icons[kind] ?? File;
  return <Icon className={cn("size-4 shrink-0", tones[kind], className)} />;
}
