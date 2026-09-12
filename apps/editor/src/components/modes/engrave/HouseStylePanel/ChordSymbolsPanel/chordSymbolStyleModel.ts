import { DEFAULT_CHORD_SYMBOL_STYLE, type ChordSymbolStyle } from "@viritura/core";

export type ChordSymbolPresetId = "conventional" | "jazz" | "plainText" | "lowercaseMinor" | "custom";

export interface ChordSymbolPreset {
  id: Exclude<ChordSymbolPresetId, "custom">;
  label: string;
  settings: Required<ChordSymbolStyle>;
}

export const CHORD_SYMBOL_PRESETS: readonly ChordSymbolPreset[] = [
  {
    id: "conventional",
    label: "Conventional",
    settings: DEFAULT_CHORD_SYMBOL_STYLE,
  },
  {
    id: "jazz",
    label: "Jazz symbols",
    settings: { ...DEFAULT_CHORD_SYMBOL_STYLE, minor: "minus" },
  },
  {
    id: "plainText",
    label: "Plain text",
    settings: {
      ...DEFAULT_CHORD_SYMBOL_STYLE,
      majorSeventh: "maj",
      minor: "min",
      diminished: "dim",
      halfDiminished: "minorFlatFive",
      augmented: "aug",
      extensions: "baseline",
    },
  },
  {
    id: "lowercaseMinor",
    label: "Lowercase minor roots",
    settings: {
      ...DEFAULT_CHORD_SYMBOL_STYLE,
      rootCase: "lowercaseMinor",
      minor: "none",
    },
  },
];

export function chordSymbolSettings(style?: ChordSymbolStyle): Required<ChordSymbolStyle> {
  return {
    rootCase: style?.rootCase ?? DEFAULT_CHORD_SYMBOL_STYLE.rootCase,
    majorSeventh: style?.majorSeventh ?? DEFAULT_CHORD_SYMBOL_STYLE.majorSeventh,
    minor: style?.minor ?? DEFAULT_CHORD_SYMBOL_STYLE.minor,
    diminished: style?.diminished ?? DEFAULT_CHORD_SYMBOL_STYLE.diminished,
    halfDiminished: style?.halfDiminished ?? DEFAULT_CHORD_SYMBOL_STYLE.halfDiminished,
    augmented: style?.augmented ?? DEFAULT_CHORD_SYMBOL_STYLE.augmented,
    extensions: style?.extensions ?? DEFAULT_CHORD_SYMBOL_STYLE.extensions,
  };
}

export function chordSymbolPresetFor(style: Required<ChordSymbolStyle>): ChordSymbolPresetId {
  return CHORD_SYMBOL_PRESETS.find((preset) => stylesEqual(preset.settings, style))?.id ?? "custom";
}

export function compactChordSymbolStyle(style: Required<ChordSymbolStyle>): ChordSymbolStyle {
  const compact: ChordSymbolStyle = {};
  for (const key of Object.keys(DEFAULT_CHORD_SYMBOL_STYLE) as Array<keyof ChordSymbolStyle>) {
    if (style[key] !== DEFAULT_CHORD_SYMBOL_STYLE[key]) {
      Object.assign(compact, { [key]: style[key] });
    }
  }
  return compact;
}

function stylesEqual(left: Required<ChordSymbolStyle>, right: Required<ChordSymbolStyle>): boolean {
  return (Object.keys(DEFAULT_CHORD_SYMBOL_STYLE) as Array<keyof ChordSymbolStyle>).every(
    (key) => left[key] === right[key],
  );
}
