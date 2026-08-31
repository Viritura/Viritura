import type {
  TimeSignatureDistribution,
  TimeSignatureGrandStaff,
  TimeSignaturePosition,
  TimeSignatureRenderStyle,
  SenzaMisuraDisplay,
  TimeSignatureSettings,
  TimeSignatureStyles,
} from "@viritura/core";

const DEFAULT_SETTINGS: Required<TimeSignatureSettings> = {
  renderStyle: "standard",
  distribution: "perStaff",
  grandStaff: "include",
  position: "center",
  scale: 1,
  senzaMisura: "open",
};

export type TimeSignaturePresetId = "standard" | "largePerStaff" | "filmScore" | "aboveGroup" | "custom";

export interface TimeSignaturePreset {
  readonly id: Exclude<TimeSignaturePresetId, "custom">;
  readonly label: string;
  readonly description: string;
  readonly settings: Required<TimeSignatureSettings>;
}

export const TIME_SIGNATURE_PRESETS: readonly TimeSignaturePreset[] = [
  {
    id: "standard",
    label: "Standard",
    description: "Conventional stacked digits on every staff.",
    settings: DEFAULT_SETTINGS,
  },
  {
    id: "largePerStaff",
    label: "Large on each staff",
    description: "Standard digits enlarged to 1.5× on every staff.",
    settings: { ...DEFAULT_SETTINGS, scale: 1.5 },
  },
  {
    id: "filmScore",
    label: "Film score",
    description: "Tall condensed numerals, one per staff group, at a practical 8× starting size.",
    settings: {
      ...DEFAULT_SETTINGS,
      renderStyle: "outsideStaff",
      distribution: "perGroup",
      scale: 8,
    },
  },
  {
    id: "aboveGroup",
    label: "Above each group",
    description: "Standard digits floated above each staff group.",
    settings: {
      ...DEFAULT_SETTINGS,
      distribution: "perGroup",
      position: "above",
    },
  },
];

export const RENDER_STYLE_OPTIONS: readonly { value: TimeSignatureRenderStyle; label: string }[] = [
  { value: "standard", label: "Standard digits" },
  { value: "narrow", label: "Condensed digits" },
  { value: "outsideStaff", label: "Film-score numerals" },
  { value: "singleNumber", label: "Beat count only" },
  { value: "noteValue", label: "Note-value denominator" },
];

export const DISTRIBUTION_OPTIONS: readonly { value: TimeSignatureDistribution; label: string }[] = [
  { value: "perStaff", label: "One per staff" },
  { value: "perGroup", label: "One per staff group" },
];

export const GRAND_STAFF_OPTIONS: readonly { value: TimeSignatureGrandStaff; label: string }[] = [
  { value: "include", label: "Include grand staves" },
  { value: "exclude", label: "Split grand staves" },
];

export const POSITION_OPTIONS: readonly { value: TimeSignaturePosition; label: string }[] = [
  { value: "center", label: "Vertically centered" },
  { value: "top", label: "Aligned to top" },
  { value: "bottom", label: "Aligned to bottom" },
  { value: "above", label: "Above staff or group" },
];

export const SENZA_MISURA_OPTIONS: readonly { value: SenzaMisuraDisplay; label: string }[] = [
  { value: "open", label: "Open-meter X" },
  { value: "hidden", label: "Hidden" },
];

export type TimeSignatureScope = "score" | "parts";

export function presetFor(settings: Required<TimeSignatureSettings>): TimeSignaturePresetId {
  return TIME_SIGNATURE_PRESETS.find((preset) => settingsEqual(preset.settings, settings))?.id ?? "custom";
}

export function settingsForPreset(id: TimeSignaturePresetId): Required<TimeSignatureSettings> | undefined {
  return TIME_SIGNATURE_PRESETS.find((preset) => preset.id === id)?.settings;
}

export function descriptionForPreset(id: TimeSignaturePresetId): string {
  return id === "custom"
    ? "Advanced controls differ from the built-in styles."
    : (TIME_SIGNATURE_PRESETS.find((preset) => preset.id === id)?.description ?? "");
}

export function settingsFor(
  styles: TimeSignatureStyles | undefined,
  scope: TimeSignatureScope,
): Required<TimeSignatureSettings> {
  return { ...DEFAULT_SETTINGS, ...styles?.[scope] };
}

export function setSettings(
  styles: TimeSignatureStyles | undefined,
  scope: TimeSignatureScope,
  settings: Required<TimeSignatureSettings>,
): TimeSignatureStyles {
  const compact = compactSettings(settings);
  const next: TimeSignatureStyles = { ...styles };
  if (Object.keys(compact).length === 0) delete next[scope];
  else next[scope] = compact;
  return next;
}

function compactSettings(settings: Required<TimeSignatureSettings>): TimeSignatureSettings {
  const compact: TimeSignatureSettings = {};
  if (settings.renderStyle !== DEFAULT_SETTINGS.renderStyle) compact.renderStyle = settings.renderStyle;
  if (settings.distribution !== DEFAULT_SETTINGS.distribution) compact.distribution = settings.distribution;
  if (settings.grandStaff !== DEFAULT_SETTINGS.grandStaff) compact.grandStaff = settings.grandStaff;
  if (settings.position !== DEFAULT_SETTINGS.position) compact.position = settings.position;
  if (settings.scale !== DEFAULT_SETTINGS.scale) compact.scale = settings.scale;
  if (settings.senzaMisura !== DEFAULT_SETTINGS.senzaMisura) compact.senzaMisura = settings.senzaMisura;
  return compact;
}

function settingsEqual(left: Required<TimeSignatureSettings>, right: Required<TimeSignatureSettings>): boolean {
  return (
    left.renderStyle === right.renderStyle &&
    left.distribution === right.distribution &&
    left.grandStaff === right.grandStaff &&
    left.position === right.position &&
    left.scale === right.scale &&
    left.senzaMisura === right.senzaMisura
  );
}
