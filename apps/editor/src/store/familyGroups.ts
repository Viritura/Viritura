/**
 * familyGroups — derive grouped part listings by instrument family.
 *
 * Shared between MixerPanel (UI rendering) and PlayView/MixerProvider
 * (so the playback bridge can apply DAW-style group bus gain).
 *
 * Parts are classified by name via `getInstrumentSection` (the SAME canonical
 * classifier that assigns parts to the spatial section synths and section-gain
 * buses, and that the play-view dot colours derive from). This means the mixer
 * families line up exactly with the audio routing and the orchestra view —
 * rather than depending on engraving labels, which orchestral family brackets
 * deliberately omit (so every non-multi-staff part used to fall to "Other").
 */

import { getInstrumentSection, type OrchestraSection } from "@viritura/audio";
import type { Score } from "@viritura/core";

// ═══════════════════════════════════════════
// Family colors — used only as a 3px stripe accent in the group header.
// Desaturated palette so they read as muted dye markers rather than
// competing with the viridian primary accent.
// ═══════════════════════════════════════════

const FAMILY_COLORS: Record<string, string> = {
  Woodwinds: "rgba( 90, 165, 130, 0.85)",
  Brass: "rgba(212, 165,  90, 0.85)",
  Percussion: "rgba(150, 120, 200, 0.85)",
  Strings: "rgba( 95, 150, 200, 0.85)",
  Keys: "rgba(210, 120, 160, 0.85)",
  Vocals: "rgba( 80, 170, 195, 0.85)",
  Choir: "rgba( 80, 170, 195, 0.85)",
  Harp: "rgba(210, 145, 100, 0.85)",
};
const DEFAULT_FAMILY_COLOR = "rgba(120, 120, 130, 0.7)";

function familyColor(familyLabel: string): string {
  const c = FAMILY_COLORS[familyLabel];
  if (c) return c;
  const lower = familyLabel.toLowerCase();
  for (const [key, color] of Object.entries(FAMILY_COLORS)) {
    if (lower.includes(key.toLowerCase())) return color;
  }
  return DEFAULT_FAMILY_COLOR;
}

/** Orchestra section → mixer group display label. */
const SECTION_LABEL: Record<OrchestraSection, string> = {
  woodwinds: "Woodwinds",
  brass: "Brass",
  percussion: "Percussion",
  keys: "Keys",
  strings: "Strings",
  voices: "Vocals",
  other: "Other",
};

/** Canonical orchestral score order (top → bottom). */
const SECTION_ORDER: readonly OrchestraSection[] = [
  "woodwinds",
  "brass",
  "percussion",
  "keys",
  "strings",
  "voices",
  "other",
];

// ═══════════════════════════════════════════
// Group extraction
// ═══════════════════════════════════════════

export interface FamilyGroup {
  /** Stable id (also the display label). */
  label: string;
  color: string;
  /** Indices into Score.parts[]. */
  partIndices: number[];
}

export interface PartRef {
  index: number;
  /** Resolved display name; falls back to `Score.parts[index].name`. */
  name?: string;
}

/**
 * Group parts into instrument families by classifying each part's name with
 * `getInstrumentSection`. Families are emitted in canonical orchestral order;
 * parts keep document order within each family. Returns a single "All Parts"
 * group when there is no score to read names from.
 */
export function extractFamilyGroups(score: Score | null | undefined, parts: PartRef[]): FamilyGroup[] {
  if (!score) {
    return [
      {
        label: "All Parts",
        color: DEFAULT_FAMILY_COLOR,
        partIndices: parts.map((p) => p.index),
      },
    ];
  }

  const bySection = new Map<OrchestraSection, number[]>();
  for (const p of parts) {
    const name = p.name ?? score.parts[p.index]?.name ?? "";
    const section = getInstrumentSection(name);
    let list = bySection.get(section);
    if (!list) {
      list = [];
      bySection.set(section, list);
    }
    list.push(p.index);
  }

  const groups: FamilyGroup[] = [];
  for (const section of SECTION_ORDER) {
    const indices = bySection.get(section);
    if (!indices || indices.length === 0) continue;
    const label = SECTION_LABEL[section];
    groups.push({ label, color: familyColor(label), partIndices: indices });
  }

  return groups.length > 0
    ? groups
    : [
        {
          label: "All Parts",
          color: DEFAULT_FAMILY_COLOR,
          partIndices: parts.map((p) => p.index),
        },
      ];
}

/**
 * Build a flat `partGroups` array (group id per part index, "" if a part
 * isn't represented by any group) suitable for SYNC_GROUPS.
 */
export function buildPartGroups(partCount: number, groups: FamilyGroup[]): string[] {
  const result: string[] = Array.from({ length: partCount }, () => "");
  for (const g of groups) {
    for (const i of g.partIndices) {
      if (i >= 0 && i < partCount) result[i] = g.label;
    }
  }
  return result;
}
