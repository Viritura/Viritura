import type { OrchestraSection, SoundSourceId } from "../types";
import { VIRITURA_SOUNDS_INSTRUMENT_RULES } from "./instrumentRules";
import { virituraSoundsSourceId } from "./sourceIds";

export interface VirituraSoundsSourceOption {
  readonly sourceId: SoundSourceId;
  readonly instrumentId: string;
  readonly section: OrchestraSection;
  readonly label: string;
}

/** Standard score order for presenting orchestral sound choices. */
export const ORCHESTRA_SECTION_ORDER: readonly OrchestraSection[] = [
  "woodwinds",
  "brass",
  "percussion",
  "keys",
  "strings",
  "voices",
  "other",
];

/** Reader-friendly names for the profile's routing sections. */
export const ORCHESTRA_SECTION_LABELS: Readonly<Record<OrchestraSection, string>> = {
  strings: "Strings",
  woodwinds: "Winds",
  brass: "Brass",
  percussion: "Percussion",
  keys: "Keys",
  voices: "Voices",
  other: "Other",
};

function sourceLabel(instrumentId: string): string {
  return instrumentId
    .split("-")
    .map((word) => {
      if (word === "bflat") return "B-flat";
      if (word === "eflat") return "E-flat";
      if (word === "c") return "C";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Canonical VirituraSounds choices in orchestra order. Each entry is a
 * profile-defined playable identity, independent from a score part's notation.
 */
export const VIRITURA_SOUNDS_SOURCE_OPTIONS: readonly VirituraSoundsSourceOption[] = [
  ...VIRITURA_SOUNDS_INSTRUMENT_RULES,
]
  .map((rule) => ({
    sourceId: virituraSoundsSourceId(rule.instrumentId),
    instrumentId: rule.instrumentId,
    section: rule.routing.section,
    label: sourceLabel(rule.instrumentId),
  }))
  .sort(
    (left, right) => ORCHESTRA_SECTION_ORDER.indexOf(left.section) - ORCHESTRA_SECTION_ORDER.indexOf(right.section),
  );
