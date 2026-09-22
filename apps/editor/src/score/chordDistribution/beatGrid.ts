/**
 * The rhythmic grid that chord distribution redistributes across.
 *
 * Sources may disagree rhythmically (a sustained half note in one staff against
 * running eighths in another), so the grid is the union of every source onset
 * in a measure. Each resulting slot records which pitches *sound throughout*
 * it; a pitch that began before the slot is flagged as a continuation so the
 * writer can tie it back instead of re-articulating it.
 *
 * Measures containing tuplets, tremolos, or grace notes on a source staff are
 * reported and left untouched: their inner rhythm cannot be expressed on a flat
 * slot grid without silently rewriting the music.
 */

import { isRest, measureBeats, type Note, type Pitch, type Score, type Sequence } from "@viritura/core";
import { getEffectiveTimeSignature, sequenceContentBeats } from "../../commands/noteCommands";
import type { MeasureWindow } from "./selectionRange";
import { staffSequenceIndex, type StaffRef } from "./staffOrder";

const EPSILON = 1e-9;

/** A pitch sounding through a grid slot. */
export interface SoundingNote {
  note: Note;
  pitch: Pitch;
  /** True when the note began before this slot and should be tied into it. */
  continuation: boolean;
}

interface GridSlot {
  beat: number;
  beats: number;
  notes: SoundingNote[];
}

export interface MeasureGrid {
  measureIndex: number;
  /** The beat span this grid covers within the measure. */
  window: MeasureWindow;
  slots: GridSlot[];
}

export interface BeatGrid {
  measures: MeasureGrid[];
  /** Measure indices skipped because a source used an unsupported container. */
  skippedMeasures: number[];
}

interface NoteInterval {
  start: number;
  end: number;
  note: Note;
}

/** True when the sequence holds a container the flat slot grid cannot model. */
function hasUnsupportedContainer(sequence: Sequence): boolean {
  return sequence.content.some((item) => item.type !== "event" && item.type !== "space");
}

function collectIntervals(sequence: Sequence, capacity: number, into: NoteInterval[]): void {
  let beat = 0;
  for (const item of sequence.content) {
    const beats = sequenceContentBeats(item);
    if (item.type === "event" && !isRest(item)) {
      const end = Math.min(beat + beats, capacity);
      for (const note of item.notes ?? []) into.push({ start: beat, end, note });
    }
    beat += beats;
    if (beat >= capacity - EPSILON) break;
  }
}

function slotBoundaries(intervals: readonly NoteInterval[], window: MeasureWindow): number[] {
  const onsets = new Set<number>([round(window.start)]);
  for (const interval of intervals) {
    for (const beat of [interval.start, interval.end]) {
      if (beat > window.start + EPSILON && beat < window.end - EPSILON) onsets.add(round(beat));
    }
  }
  return [...onsets].sort((left, right) => left - right);
}

function round(beat: number): number {
  return Math.round(beat * 1e6) / 1e6;
}

/**
 * Build the grid for one window. Intervals are clipped to the window, so a note
 * sustaining across its edge contributes only the part being redistributed.
 */
function buildMeasureGrid(score: Score, sources: readonly StaffRef[], window: MeasureWindow): MeasureGrid | null {
  const capacity = measureBeats(getEffectiveTimeSignature(score, window.measureIndex));
  if (capacity <= 0 || window.end <= window.start + EPSILON) return null;
  const clipped: MeasureWindow = {
    measureIndex: window.measureIndex,
    start: Math.max(0, window.start),
    end: Math.min(capacity, window.end),
  };

  const intervals: NoteInterval[] = [];
  for (const ref of sources) {
    const sequenceIndex = staffSequenceIndex(score, ref, clipped.measureIndex);
    const sequence = score.parts[ref.partIndex]?.measures[clipped.measureIndex]?.sequences[sequenceIndex];
    if (!sequence) continue;
    if (hasUnsupportedContainer(sequence)) return null;
    collectIntervals(sequence, capacity, intervals);
  }

  const inWindow = intervals.filter(
    (interval) => interval.end > clipped.start + EPSILON && interval.start < clipped.end - EPSILON,
  );
  const boundaries = slotBoundaries(inWindow, clipped);
  const slots: GridSlot[] = boundaries.map((beat, index) => {
    const beats = (boundaries[index + 1] ?? clipped.end) - beat;
    const notes = inWindow
      .filter((interval) => interval.start <= beat + EPSILON && interval.end >= beat + beats - EPSILON)
      .map((interval) => ({
        note: interval.note,
        pitch: interval.note.pitch,
        continuation: interval.start < beat - EPSILON,
      }));
    return { beat, beats, notes };
  });
  return { measureIndex: clipped.measureIndex, window: clipped, slots };
}

/** Build the union-of-onsets grid for `sources` across the given windows. */
export function buildBeatGrid(score: Score, sources: readonly StaffRef[], windows: readonly MeasureWindow[]): BeatGrid {
  const measures: MeasureGrid[] = [];
  const skippedMeasures: number[] = [];
  for (const window of windows) {
    const grid = buildMeasureGrid(score, sources, window);
    if (grid) measures.push(grid);
    else skippedMeasures.push(window.measureIndex);
  }
  return { measures, skippedMeasures };
}

/** The largest simultaneity anywhere in the grid — the staff count a full explode needs. */
export function maxSimultaneity(grid: BeatGrid): number {
  let max = 0;
  for (const measure of grid.measures) {
    for (const slot of measure.slots) max = Math.max(max, slot.notes.length);
  }
  return max;
}
