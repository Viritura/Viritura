/**
 * Signature/structure helpers — resolve the measure/part referenced by a
 * selection element ID, plus the ending (volta) presets surfaced in the palette.
 *
 * The actual mutations (setTimeSignature, setKeySignature, …) are applied by
 * callers using the core mutators directly; this module only maps element IDs
 * to indices.
 */

import type { Ending, Score } from "@viritura/core";
import { setKeySignature } from "@viritura/core";

/**
 * Extract the measure index referenced by an element ID.
 * Element IDs follow the pattern "p{part}/m{measure}/…" or global "m{N}/…".
 * A barline rendered at the start of measure N is the ending barline of
 * measure N-1, so "/barline" IDs resolve to N-1.
 */
export function measureIndexFromElementId(elementId: string | null, score: Score): number | null {
  if (!elementId) return null;

  // Global-level element IDs like "m{N}/barline", "m{N}/tempo0", etc.
  const globalMatch = elementId.match(/^m(\d+)\//);
  if (globalMatch) {
    const idx = parseInt(globalMatch[1]!, 10);
    if (elementId.endsWith("/barline")) {
      const adjustedIdx = Math.max(0, idx - 1);
      if (adjustedIdx >= score.global.measures.length) return null;
      return adjustedIdx;
    }
    if (idx < 0 || idx >= score.global.measures.length) return null;
    return idx;
  }

  // Part-scoped element IDs like "p{N}/m{N}/…".
  const parts = elementId.split("/");
  if (parts.length < 2) return null;
  const match = parts[1]?.match(/^m(\d+)$/);
  if (!match) return null;
  const idx = parseInt(match[1]!, 10);
  if (idx < 0 || idx >= score.global.measures.length) return null;
  return idx;
}

/** Extract the part index referenced by an element ID ("p{part}/…"). */
export function partIndexFromElementId(elementId: string | null, score: Score): number | null {
  if (!elementId) return null;
  const parts = elementId.split("/");
  const match = parts[0]?.match(/^p(\d+)$/);
  if (!match) return null;
  const idx = parseInt(match[1]!, 10);
  if (idx < 0 || idx >= score.parts.length) return null;
  return idx;
}

/**
 * Remove the explicit global key signature selected through any rendered staff
 * copy. Notes retain their pitches; layout derives the newly required
 * accidentals from the inherited key signature on the next render.
 *
 * A continuation signature at a system start has no key entry on that measure,
 * so there is no model object to delete and the operation is a no-op.
 */
export function deleteKeySignatureByElementId(score: Score, elementId: string): Score | null {
  if (!elementId.endsWith("/key")) return null;
  const measureIndex = measureIndexFromElementId(elementId, score);
  if (measureIndex === null || score.global.measures[measureIndex]?.key === undefined) return null;
  return setKeySignature(score, measureIndex, null);
}

/**
 * Measure range referenced by an element ID. A single element spans exactly
 * its own measure.
 */
export function measureRangeFromElementId(
  elementId: string | null,
  score: Score,
): { start: number; end: number } | null {
  const idx = measureIndexFromElementId(elementId, score);
  if (idx === null) return null;
  return { start: idx, end: idx };
}

/**
 * Resolve the index at which to splice newly-inserted measures, given the
 * current single-selection element ID. A selected barline `m{N}/barline` sits
 * at the boundary before measure N, so insertion goes at index N. A selected
 * note/measure M inserts *after* its measure (M + 1). With no resolvable
 * selection the new measures append to the end of the score.
 */
export function resolveInsertMeasureIndex(elementId: string | null, score: Score): number {
  const total = score.global.measures.length;
  if (!elementId) return total;
  const barlineMatch = elementId.match(/^m(\d+)\/barline$/);
  if (barlineMatch) {
    return Math.min(parseInt(barlineMatch[1]!, 10), total);
  }
  const idx = measureIndexFromElementId(elementId, score);
  return idx !== null ? idx + 1 : total;
}

/** Ending (volta) presets surfaced in the palette. */
export const ENDING_PRESETS: { label: string; ending: Ending }[] = [
  { label: "1st Ending", ending: { duration: 1, numbers: [1] } },
  { label: "2nd Ending", ending: { duration: 1, numbers: [2], open: true } },
  { label: "1st+2nd Ending", ending: { duration: 1, numbers: [1, 2] } },
];
