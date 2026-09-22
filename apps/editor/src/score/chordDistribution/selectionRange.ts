/**
 * The beat window a distribution is allowed to rewrite.
 *
 * Distribution must not disturb music the user did not select: exploding one
 * chord may not wipe the rest of the measure, and it may not discard whatever
 * the staves below already hold outside the selected span. So every operation
 * is scoped to a half-open beat window per measure, derived from the selected
 * events.
 *
 * Windows are snapped *outward* to event boundaries. A window that began or
 * ended mid-event would force the writer to split music it was never asked to
 * touch; growing to the enclosing event keeps every splice aligned to real
 * note boundaries.
 */

import { measureBeats, type Score, type Sequence } from "@viritura/core";
import { getEffectiveTimeSignature, sequenceContentBeats } from "../../commands/noteCommands";
import { resolveSelectionEvents } from "../../store/selectionUtils";
import type { Selection } from "../../store/selectionStore";
import { staffSequenceIndex, type StaffRef } from "./staffOrder";

const EPSILON = 1e-9;

/** An inclusive-start, exclusive-end beat span within one measure. */
export interface MeasureWindow {
  measureIndex: number;
  start: number;
  end: number;
}

function round(beat: number): number {
  return Math.round(beat * 1e6) / 1e6;
}

/** Beat offset of `eventIndex` within a sequence, or null when out of range. */
function beatOffset(sequence: Sequence, eventIndex: number): { start: number; end: number } | null {
  let beat = 0;
  for (const [index, item] of sequence.content.entries()) {
    const beats = sequenceContentBeats(item);
    if (index === eventIndex) return { start: beat, end: beat + beats };
    beat += beats;
  }
  return null;
}

/**
 * Grow `window` so it never starts or ends inside one of `sequence`'s events.
 * Returns true when the window actually moved.
 */
function snapToSequence(sequence: Sequence, window: MeasureWindow): boolean {
  let beat = 0;
  let moved = false;
  for (const item of sequence.content) {
    const itemStart = beat;
    const itemEnd = beat + sequenceContentBeats(item);
    beat = itemEnd;
    if (itemStart < window.start - EPSILON && itemEnd > window.start + EPSILON) {
      window.start = itemStart;
      moved = true;
    }
    if (itemStart < window.end - EPSILON && itemEnd > window.end + EPSILON) {
      window.end = itemEnd;
      moved = true;
    }
  }
  return moved;
}

/**
 * Snap `window` outward across every given staff until it is stable. Growing
 * for one staff can straddle an event on another, so this iterates; the window
 * only ever grows and is capped by the measure, so it always terminates.
 */
export function snapWindow(score: Score, window: MeasureWindow, staves: readonly StaffRef[]): MeasureWindow {
  const snapped = { ...window };
  for (let pass = 0; pass < staves.length + 1; pass++) {
    let moved = false;
    for (const ref of staves) {
      const index = staffSequenceIndex(score, ref, snapped.measureIndex);
      const sequence = score.parts[ref.partIndex]?.measures[snapped.measureIndex]?.sequences[index];
      if (sequence && snapToSequence(sequence, snapped)) moved = true;
    }
    if (!moved) break;
  }
  snapped.start = round(Math.max(0, snapped.start));
  snapped.end = round(snapped.end);
  return snapped;
}

/** A window covering a whole measure. */
function fullMeasure(score: Score, measureIndex: number): MeasureWindow {
  return { measureIndex, start: 0, end: measureBeats(getEffectiveTimeSignature(score, measureIndex)) };
}

/**
 * The beat windows a selection covers, one per measure, ordered by measure.
 *
 * Measure selections cover their measures whole. Event selections cover only
 * the span of the selected events, which is what keeps an explode from
 * rewriting music the user never selected.
 */
export function selectionWindows(score: Score, selection: Selection): MeasureWindow[] {
  if (selection.kind === "measure") {
    const start = Math.min(selection.startMeasure, selection.endMeasure);
    const end = Math.max(selection.startMeasure, selection.endMeasure);
    return Array.from({ length: end - start + 1 }, (_, offset) => fullMeasure(score, start + offset));
  }

  const windows = new Map<number, MeasureWindow>();
  for (const loc of resolveSelectionEvents(selection, score)) {
    const sequence = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
    if (!sequence) continue;
    // Events inside a tuplet/tremolo are addressed by their container; those
    // measures are rejected by the grid anyway, so scope to the container.
    const index = loc.tupletIndex ?? loc.eventIndex;
    const span = beatOffset(sequence, index);
    if (!span) continue;
    const existing = windows.get(loc.measureIndex);
    if (existing) {
      existing.start = Math.min(existing.start, span.start);
      existing.end = Math.max(existing.end, span.end);
    } else {
      windows.set(loc.measureIndex, { measureIndex: loc.measureIndex, start: span.start, end: span.end });
    }
  }
  return [...windows.values()].sort((left, right) => left.measureIndex - right.measureIndex);
}
