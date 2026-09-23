/**
 * The rhythmic grid shared by clipboard chord-distribution transforms.
 *
 * Tracks may disagree rhythmically, so the grid is the union of every note
 * boundary. Each slot records the pitches sounding throughout it; a pitch that
 * began before the slot is marked as a continuation so the writer can tie it
 * rather than re-articulate it.
 */

import { isRest, measureBeats, type Note, type Pitch, type SequenceContent, type TimeSignature } from "@viritura/core";
import { sequenceContentBeats } from "../../commands/noteCommands";

const EPSILON = 1e-9;

/** A clipboard sequence and its offset from the copied selection's origin. */
export interface ContentGridSource {
  content: readonly SequenceContent[];
  leadInBeats: number;
}

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

export interface BeatGrid {
  duration: number;
  slots: GridSlot[];
}

interface NoteInterval {
  start: number;
  end: number;
  note: Note;
}

function round(beat: number): number {
  return Math.round(beat * 1e6) / 1e6;
}

function sourceDuration(source: ContentGridSource): number {
  return source.content.reduce((total, item) => total + sequenceContentBeats(item), source.leadInBeats);
}

function collectIntervals(source: ContentGridSource, into: NoteInterval[]): void {
  let beat = source.leadInBeats;
  for (const item of source.content) {
    const beats = sequenceContentBeats(item);
    if (item.type === "event" && !isRest(item)) {
      for (const note of item.notes ?? []) into.push({ start: beat, end: beat + beats, note });
    }
    beat += beats;
  }
}

function slotBoundaries(intervals: readonly NoteInterval[], duration: number, timeSignature: TimeSignature): number[] {
  const boundaries = new Set<number>([0]);
  for (const interval of intervals) {
    if (interval.start > EPSILON && interval.start < duration - EPSILON) boundaries.add(round(interval.start));
    if (interval.end > EPSILON && interval.end < duration - EPSILON) boundaries.add(round(interval.end));
  }
  const capacity = measureBeats(timeSignature);
  if (capacity > EPSILON) {
    for (let beat = capacity; beat < duration - EPSILON; beat += capacity) boundaries.add(round(beat));
  }
  return [...boundaries].sort((left, right) => left - right);
}

/** Build the union-of-onsets grid for clipboard track content. */
export function buildBeatGrid(sources: readonly ContentGridSource[], timeSignature: TimeSignature): BeatGrid | null {
  if (sources.some((source) => source.content.some((item) => item.type !== "event" && item.type !== "space"))) {
    return null;
  }

  const duration = Math.max(0, ...sources.map(sourceDuration));
  if (duration <= EPSILON) return { duration: 0, slots: [] };

  const intervals: NoteInterval[] = [];
  for (const source of sources) collectIntervals(source, intervals);
  const boundaries = slotBoundaries(intervals, duration, timeSignature);
  const slots = boundaries.map((beat, index) => {
    const beats = (boundaries[index + 1] ?? duration) - beat;
    const notes = intervals
      .filter((interval) => interval.start <= beat + EPSILON && interval.end >= beat + beats - EPSILON)
      .map((interval) => ({
        note: interval.note,
        pitch: interval.note.pitch,
        continuation: interval.start < beat - EPSILON,
      }));
    return { beat, beats, notes };
  });
  return { duration, slots };
}

/** The largest simultaneity anywhere in the grid. */
export function maxSimultaneity(grid: BeatGrid): number {
  return grid.slots.reduce((maximum, slot) => Math.max(maximum, slot.notes.length), 0);
}
