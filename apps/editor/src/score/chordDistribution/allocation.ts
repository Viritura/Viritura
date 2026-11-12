/**
 * Allocation policy for chord distribution.
 *
 * Standard engraving practice for an exploded divisi is pitch-ordered: the
 * highest pitch takes the top staff, the next takes the staff below it, and so
 * on. When there are more pitches than staves the remainder chord-stacks on the
 * bottom staff rather than being discarded; when there are more staves than
 * pitches the surplus staves fall silent (rests). This mirrors the condensed
 * staff redistribution in `score/condensingChord.ts` so explode and condense
 * are exact inverses of one another when no sustained lines cross. Sustained
 * notes and complete tie chains keep their initial staff; new attacks fill the
 * remaining staves in pitch order.
 */

import { pitchToMidi, type Note, type Pitch } from "@viritura/core";
import type { SoundingNote } from "./beatGrid";
import type { DistributionSegment } from "./tupletSegments";

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

function segmentNotes(segments: readonly DistributionSegment[], notes: Set<Note>): void {
  for (const segment of segments) {
    if (segment.kind === "tuplet") segmentNotes(segment.inner, notes);
    else for (const slot of segment.grid.slots) for (const entry of slot.notes) notes.add(entry.note);
  }
}

/** Allocate a sustained note or tie chain once, including across tuplet timelines. */
export function createDistributionAllocator(
  segments: readonly DistributionSegment[],
  targetCount: number,
): (notes: readonly SoundingNote[]) => SoundingNote[][] {
  const notes = new Set<Note>();
  segmentNotes(segments, notes);
  const byId = new Map<string, Note>();
  for (const note of notes) if (note.id) byId.set(note.id, note);
  const parents = new Map<Note, Note>();
  function root(note: Note): Note {
    const parent = parents.get(note);
    if (!parent) return note;
    const result = root(parent);
    parents.set(note, result);
    return result;
  }
  for (const note of notes) {
    for (const tie of note.ties ?? []) {
      const partner = tie.target ? byId.get(tie.target) : undefined;
      if (!partner) continue;
      const from = root(note);
      const to = root(partner);
      if (from !== to) parents.set(to, from);
    }
  }

  const destinations = new Map<Note, number>();
  return (sounding) => {
    const allocations: SoundingNote[][] = Array.from({ length: targetCount }, () => []);
    const pending: SoundingNote[] = [];
    for (const entry of sortByPitchDescending(sounding)) {
      const destination = destinations.get(root(entry.note));
      if (destination === undefined) pending.push(entry);
      else allocations[destination]!.push(entry);
    }
    for (const entry of pending) {
      const available = allocations.findIndex((allocation) => allocation.length === 0);
      const destination = available < 0 ? targetCount - 1 : available;
      allocations[destination]!.push(entry);
      destinations.set(root(entry.note), destination);
    }
    return allocations;
  };
}

/** Order a pool highest-sounding first, which is the order `allocateTopDown` consumes. */
function sortByPitchDescending<T extends { pitch: Pitch }>(pool: readonly T[]): T[] {
  return [...pool].sort((left, right) => pitchToMidi(right.pitch) - pitchToMidi(left.pitch));
}

/** Stable identity for a pitch, used to follow a sustained note across slots. */
export function pitchKey(pitch: Pitch): string {
  return `${pitch.step}${pitch.alter ?? 0}/${pitch.octave}`;
}
