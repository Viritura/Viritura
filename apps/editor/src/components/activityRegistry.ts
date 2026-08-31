import {
  BookOpenText,
  Pencil,
  Ruler,
  Play,
  Piano,
  Clapperboard,
  FileDiff,
  Rocket,
  type LucideIcon,
} from "lucide-react";

export type ActivityView = "setup" | "write" | "engrave" | "play" | "roll" | "picture" | "review" | "publish";

export interface ActivityDefinition {
  readonly view: ActivityView;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly keywords: readonly string[];
}

/** Shared activity metadata for the Activity Bar and command destinations. */
export const ACTIVITY_DEFINITIONS: readonly ActivityDefinition[] = [
  { view: "setup", label: "Setup", icon: BookOpenText, keywords: ["project", "instruments", "layouts"] },
  { view: "write", label: "Write", icon: Pencil, keywords: ["notation", "note entry", "edit"] },
  { view: "engrave", label: "Engrave", icon: Ruler, keywords: ["layout", "house style", "page"] },
  { view: "play", label: "Play", icon: Play, keywords: ["playback", "mixer", "audio"] },
  { view: "roll", label: "Roll", icon: Piano, keywords: ["piano roll", "visualization"] },
  { view: "picture", label: "Picture", icon: Clapperboard, keywords: ["video", "timecode", "spotting"] },
  { view: "review", label: "Review", icon: FileDiff, keywords: ["history", "diff", "git"] },
  { view: "publish", label: "Publish", icon: Rocket, keywords: ["export", "pdf", "print"] },
];
