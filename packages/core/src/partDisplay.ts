/**
 * Part display name utilities — auto-derives transposition key names
 * and instance numbering from the Part model.
 *
 * Convention:
 * - Part.name stores the base instrument name (e.g., "Clarinet")
 * - Part.shortName stores the base abbreviation (e.g., "Cl.")
 * - Transposition text is derived from Part.transposition.interval.halfSteps
 * - Instance numbering is derived from parts sharing the same (name, transpositionKey)
 */

import type { Part, Transposition } from "./model/part";

// ─── Pitch names by pitch class (using conventional enharmonic spelling) ──

const PITCH_NAMES: Record<number, string> = {
  0: "C",
  1: "D♭",
  2: "D",
  3: "E♭",
  4: "E",
  5: "F",
  6: "F♯",
  7: "G",
  8: "A♭",
  9: "A",
  10: "B♭",
  11: "B",
};

/**
 * Convert a transposition interval (halfSteps) to a key name string.
 * Returns null for non-transposing or pure-octave transpositions.
 *
 * halfSteps = (written - sounding) in semitones, so:
 *   - B♭ instrument: halfSteps = 2 (sounds a major 2nd lower than written)
 *   - F instrument: halfSteps = 7 (sounds a perfect 5th lower)
 *
 * The key name = the note that sounds when the player reads C:
 *   pitchClass = (0 - halfSteps) mod 12
 */
export function transpositionKeyName(halfSteps: number): string | null {
  // Pure octave transpositions don't get a key name
  if (halfSteps % 12 === 0) return null;
  const pitchClass = (((0 - halfSteps) % 12) + 12) % 12;
  return PITCH_NAMES[pitchClass] ?? null;
}

/**
 * Format the transposition suffix for display (e.g., "in B♭").
 * Returns empty string if not transposing or octave-only.
 */
export function transpositionSuffix(transposition?: Transposition): string {
  if (!transposition) return "";
  const key = transpositionKeyName(transposition.interval.halfSteps);
  return key ? `in ${key}` : "";
}

/** Result of resolving a part's display name. */
export interface PartDisplayInfo {
  /** Full display name (e.g., "Clarinet in B♭ 2") */
  displayName: string;
  /** Short display name (e.g., "Cl. in B♭ 2") */
  displayShortName: string;
  /** The transposition suffix alone (e.g., "in B♭") or "" */
  keySuffix: string;
  /** Instance number (undefined if only one of its kind) */
  instanceNumber: number | undefined;
}

/**
 * Resolve display names for all parts in a score, with auto-numbering
 * and auto-transposition text.
 *
 * Numbering groups parts by (name, transpositionKey). If multiple parts
 * share the same group, they get sequential numbers.
 *
 * Examples:
 *   - 1× Flute → "Flute"
 *   - 2× Flute → "Flute 1", "Flute 2"
 *   - 1× Clarinet (halfSteps=2) + 1× Clarinet (halfSteps=3) → "Clarinet in B♭", "Clarinet in A"
 *   - 2× Clarinet (halfSteps=2) → "Clarinet in B♭ 1", "Clarinet in B♭ 2"
 */
export function resolvePartDisplayNames(
  parts: readonly Pick<Part, "id" | "name" | "shortName" | "transposition">[],
): PartDisplayInfo[] {
  // Group key = baseName + "|" + transpositionKey (or "")
  const groupKey = (p: Pick<Part, "name" | "transposition">) => {
    const key = transpositionKeyName(p.transposition?.interval?.halfSteps ?? 0);
    return `${p.name}|${key ?? ""}`;
  };

  // Count occurrences per group
  const groupCounts = new Map<string, number>();
  for (const p of parts) {
    const k = groupKey(p);
    groupCounts.set(k, (groupCounts.get(k) ?? 0) + 1);
  }

  // Assign numbers
  const groupIndices = new Map<string, number>();
  return parts.map((p) => {
    const keySuffix = transpositionSuffix(p.transposition);
    const k = groupKey(p);
    const total = groupCounts.get(k) ?? 1;

    let instanceNumber: number | undefined;
    if (total > 1) {
      const idx = (groupIndices.get(k) ?? 0) + 1;
      groupIndices.set(k, idx);
      instanceNumber = idx;
    }

    const nameParts = [p.name];
    if (keySuffix) nameParts.push(keySuffix);
    if (instanceNumber !== undefined) nameParts.push(String(instanceNumber));
    const displayName = nameParts.join(" ");

    const shortBase = p.shortName ?? abbreviatePartName(p.name);
    const shortParts = [shortBase];
    if (keySuffix) shortParts.push(keySuffix);
    if (instanceNumber !== undefined) shortParts.push(String(instanceNumber));
    const displayShortName = shortParts.join(" ");

    return { displayName, displayShortName, keySuffix, instanceNumber };
  });
}

/**
 * Resolve display name for a single part given all parts in the score.
 * Convenience wrapper around resolvePartDisplayNames.
 */
export function resolvePartDisplayName(
  partId: string,
  parts: readonly Pick<Part, "id" | "name" | "shortName" | "transposition">[],
): PartDisplayInfo | undefined {
  const infos = resolvePartDisplayNames(parts);
  const idx = parts.findIndex((p) => p.id === partId);
  return idx >= 0 ? infos[idx] : undefined;
}

/**
 * Simple abbreviation: take first consonants + ".".
 * Examples: "Violin" → "Vln.", "Flute" → "Fl.", "Clarinet" → "Cl."
 */
function abbreviatePartName(name: string): string {
  // Keep first char + consonants, add period
  const consonants = name[0] + name.slice(1).replace(/[aeiou\s]/gi, "");
  const abbr = consonants.slice(0, 4);
  return abbr.endsWith(".") ? abbr : `${abbr}.`;
}
