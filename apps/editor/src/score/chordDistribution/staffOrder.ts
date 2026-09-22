/**
 * Physical staff addressing for chord distribution.
 *
 * Explode / reduce / redistribute all operate on *staves* in score order, not
 * on parts: a grand-staff part contributes two distribution targets, and a
 * one-staff part contributes one. `StaffRef` is that address, and the helpers
 * here translate between it, the document's sequence arrays, and a selection.
 */

import type { Score } from "@viritura/core";
import type { EventLocation } from "../ElementPath";

/** A physical staff: a part plus its one-based staff number. */
export interface StaffRef {
  partIndex: number;
  staff: number;
}

/** Every staff in the document, top to bottom. */
export function scoreStaffOrder(score: Score): StaffRef[] {
  return score.parts.flatMap((part, partIndex) =>
    Array.from({ length: Math.max(1, part.staves ?? 1) }, (_, index) => ({ partIndex, staff: index + 1 })),
  );
}

export function sameStaff(left: StaffRef, right: StaffRef): boolean {
  return left.partIndex === right.partIndex && left.staff === right.staff;
}

function compareStaffRefs(left: StaffRef, right: StaffRef): number {
  return left.partIndex - right.partIndex || left.staff - right.staff;
}

/**
 * Index of the primary (first) sequence on `ref` within `measureIndex`, or -1
 * when the staff has no sequence there. Single-staff parts routinely omit
 * `sequence.staff`, so an absent value is read as staff 1.
 */
export function staffSequenceIndex(score: Score, ref: StaffRef, measureIndex: number): number {
  const sequences = score.parts[ref.partIndex]?.measures[measureIndex]?.sequences;
  if (!sequences) return -1;
  return sequences.findIndex((sequence) => (sequence.staff ?? 1) === ref.staff);
}

/** How many sequences (voices) the staff owns in this measure. */
export function staffVoiceCount(score: Score, ref: StaffRef, measureIndex: number): number {
  const sequences = score.parts[ref.partIndex]?.measures[measureIndex]?.sequences ?? [];
  return sequences.filter((sequence) => (sequence.staff ?? 1) === ref.staff).length;
}

/** The distinct staves a selection touches, ordered top to bottom. */
export function eventStaffRefs(score: Score, locations: readonly EventLocation[]): StaffRef[] {
  const refs = new Map<string, StaffRef>();
  for (const loc of locations) {
    const staff = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.staff ?? 1;
    refs.set(`${loc.partIndex}/${staff}`, { partIndex: loc.partIndex, staff });
  }
  return [...refs.values()].sort(compareStaffRefs);
}
