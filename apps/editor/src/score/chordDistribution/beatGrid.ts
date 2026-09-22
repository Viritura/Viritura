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
import { staffSequenceIndex, type StaffRef } from "./staffOrder";

const EPSILON = 1e-9;

/** A pitch sounding through a grid slot. */
export interface SoundingNote {
  note: Note;
  pitch: Pitch;
  /** True when the note began before this slot and should be tied into it. */
  continuation: boolean;
}

export interface GridSlot {
  beat: number;
  beats: number;
  notes: SoundingNote[];
}

export interface MeasureGrid {
  measureIndex: number;
  /** Total quarter-note beats the measure holds. */
  capacity: number;
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

function slotBoundaries(intervals: readonly NoteInterval[], capacity: number): number[] {
  const onsets = new Set<number>([0]);
  for (const interval of intervals) {
    if (interval.start > EPSILON && interval.start < capacity - EPSILON) onsets.add(round(interval.start));
    if (interval.end > EPSILON && interval.end < capacity - EPSILON) onsets.add(round(interval.end));
  }
  return [...onsets].sort((left, right) => left - right);
}

function round(beat: number): number {
  return Math.round(beat * 1e6) / 1e6;
}

function buildMeasureGrid(score: Score, sources: readonly StaffRef[], measureIndex: number): MeasureGrid | null {
  const capacity = measureBeats(getEffectiveTimeSignature(score, measureIndex));
  if (capacity <= 0) return null;
  const intervals: NoteInterval[] = [];
  for (const ref of sources) {
    const sequenceIndex = staffSequenceIndex(score, ref, measureIndex);
    const sequence = score.parts[ref.partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
    if (!sequence) continue;
    if (hasUnsupportedContainer(sequence)) return null;
    collectIntervals(sequence, capacity, intervals);
  }

  const boundaries = slotBoundaries(intervals, capacity);
  const slots: GridSlot[] = boundaries.map((beat, index) => {
    const beats = (boundaries[index + 1] ?? capacity) - beat;
    const notes = intervals
      .filter((interval) => interval.start <= beat + EPSILON && interval.end >= beat + beats - EPSILON)
      .map((interval) => ({
        note: interval.note,
        pitch: interval.note.pitch,
        continuation: interval.start < beat - EPSILON,
      }));
    return { beat, beats, notes };
  });
  return { measureIndex, capacity, slots };
}

/** Build the union-of-onsets grid for `sources` across an inclusive measure range. */
export function buildBeatGrid(
  score: Score,
  sources: readonly StaffRef[],
  startMeasure: number,
  endMeasure: number,
): BeatGrid {
  const measures: MeasureGrid[] = [];
  const skippedMeasures: number[] = [];
  for (let measureIndex = startMeasure; measureIndex <= endMeasure; measureIndex++) {
    const grid = buildMeasureGrid(score, sources, measureIndex);
    if (grid) measures.push(grid);
    else skippedMeasures.push(measureIndex);
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
