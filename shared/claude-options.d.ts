/** Tipos de `claude-options.js`. */
export const EFFORT_LABELS: Record<"low" | "medium" | "high" | "xhigh" | "max", string>;

export type LevelOption = { value: string; label: string };

export const ART_DIRECTION_LEVELS: LevelOption[];

export const MOTION_LEVELS: LevelOption[];

export const MAX_ADJUST_ATTACHMENTS: number;

export const MAX_ADJUST_ATTACHMENT_BYTES: number;
