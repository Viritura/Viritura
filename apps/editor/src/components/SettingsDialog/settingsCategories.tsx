import type { ComponentType, ReactNode } from "react";
import { Bug, CircleUserRound, FileInput, Gauge, Music, Palette, Volume2, Waves } from "lucide-react";
import {
  InstrumentProfilesPanel,
  AudioRenderModeSettings,
  DefaultReverbSettings,
  isDesktopHost,
} from "../../instrumentProfiles";
import { AppearancePanel } from "./panels/AppearancePanel";
import { ImportPanel } from "./panels/ImportPanel";
import { RenderingPanel } from "./panels/RenderingPanel";
import { LayoutDebugPanel } from "./panels/LayoutDebugPanel";
import { AccountPanel } from "./panels/AccountPanel";

/** Rail groups, in display order. */
export const SETTINGS_GROUPS = ["General", "Audio", "Files", "Advanced"] as const;

type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
export interface SettingsCategory {
  /** Stable id — also the nav value and the panel's DOM id suffix. */
  id: string;
  /** Rail row label and detail-pane title. */
  label: string;
  group: SettingsGroup;
  icon: ReactNode;
  /** One line under the detail title saying what this category covers. */
  description: string;
  /**
   * Extra search terms that don't appear in the label — the words a user is
   * likely to type when they can't remember what the category is called.
   */
  keywords: readonly string[];
  Panel: ComponentType;
  /**
   * Optional gate. Categories that aren't available are omitted from the rail
   * entirely rather than shown disabled: a VST-only setting has nothing
   * useful to say in the browser build.
   */
  isAvailable?: () => boolean;
}

/**
 * The single source of truth for the settings dialog.
 *
 * The rail, the search index, and the detail pane are all derived from this
 * list, so adding a category is a one-entry change rather than an edit in
 * four places. Availability lives here too, which is what retired the inline
 * `isDesktopHost() && <section>` guards the flat dialog used.
 */
const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "account",
    label: "Account",
    group: "General",
    icon: <CircleUserRound size={14} />,
    description: "Identity, connected accounts, sign-in security, and account management.",
    keywords: ["profile", "email", "password", "github", "google", "two-factor", "2fa", "sign out"],
    Panel: AccountPanel,
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "General",
    icon: <Palette size={14} />,
    description: "Editor chrome and colour theme.",
    keywords: ["theme", "dark", "light", "midnight", "colour", "color", "contrast"],
    Panel: AppearancePanel,
  },
  {
    id: "instrument-profiles",
    label: "Instrument Profiles",
    group: "Audio",
    icon: <Music size={14} />,
    description: "Sound sources used for playback, including VST profiles.",
    keywords: ["vst", "plugin", "soundfont", "virituraSounds", "sampler", "instrument"],
    Panel: InstrumentProfilesPanel,
  },
  {
    id: "audio-output",
    label: "Audio Output",
    group: "Audio",
    icon: <Volume2 size={14} />,
    description: "Whether playback runs in the browser or through the native mixer.",
    keywords: ["render", "native", "web", "playback", "mixer", "vst"],
    Panel: AudioRenderModeSettings,
    isAvailable: isDesktopHost,
  },
  {
    id: "default-reverb",
    label: "Default Reverb",
    group: "Audio",
    icon: <Waves size={14} />,
    description: "The plugin used to seed a new score's reverb chain.",
    keywords: ["reverb", "fx", "effect", "plugin", "hall", "space"],
    Panel: DefaultReverbSettings,
    isAvailable: isDesktopHost,
  },
  {
    id: "import",
    label: "Import",
    group: "Files",
    icon: <FileInput size={14} />,
    description: "How MNX and MusicXML files are interpreted when opened.",
    keywords: ["mnx", "musicxml", "open", "vendor", "extensions", "stems", "metronome"],
    Panel: ImportPanel,
  },
  {
    id: "rendering",
    label: "Rendering",
    group: "Advanced",
    icon: <Gauge size={14} />,
    description: "Diagnostic overlays for the canvas renderer.",
    keywords: ["performance", "fps", "hitbox", "tile", "cache", "debug", "overlay"],
    Panel: RenderingPanel,
  },
  {
    id: "layout-debug",
    label: "Layout Debug",
    group: "Advanced",
    icon: <Bug size={14} />,
    description: "Spacing and placement guides from the engraving engine.",
    keywords: ["spacing", "bbox", "system", "staff", "gap", "debug", "overlay", "engrave"],
    Panel: LayoutDebugPanel,
  },
];

/** The categories available in the current host, in registry order. */
export function availableCategories(): SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter((category) => category.isAvailable?.() ?? true);
}
