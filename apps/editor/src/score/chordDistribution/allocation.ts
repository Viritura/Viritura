/**
 * Allocation policy for chord distribution.
 *
 * Standard engraving practice for an exploded divisi is pitch-ordered: the
 * highest pitch takes the top staff, the next takes the staff below it, and so
 * on. When there are more pitches than staves the remainder chord-stacks on the
 * bottom staff rather than being discarded; when there are more staves than
 * pitches the surplus staves fall silent (rests). This mirrors the condensed
 * staff redistribution in `score/condensingChord.ts` so explode and condense
 * are exact inverses of one another.
 */

import { pitchToMidi, type Pitch } from "@viritura/core";

/**
 * Split a top-to-bottom ordered pool across `targetCount` slots. Slots before
 * the last take one entry each; the last takes everything that remains.
 */
export function allocateTopDown<T>(pool: readonly T[], targetCount: number): T[][] {
  if (targetCount <= 0) return [];
  const last = targetCount - 1;
  return Array.from({ length: targetCount }, (_, index) =>
    index < last ? (pool[index] ? [pool[index]!] : []) : pool.slice(last),
  );
}

/** Order a pool highest-sounding first, which is the order `allocateTopDown` consumes. */
export function sortByPitchDescending<T extends { pitch: Pitch }>(pool: readonly T[]): T[] {
  return [...pool].sort((left, right) => pitchToMidi(right.pitch) - pitchToMidi(left.pitch));
}

/** Stable identity for a pitch, used to follow a sustained note across slots. */
export function pitchKey(pitch: Pitch): string {
  return `${pitch.step}${pitch.alter ?? 0}/${pitch.octave}`;
}
