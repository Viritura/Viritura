/**
 * The rhythmic grid shared by clipboard chord-distribution transforms.
 *
 * Tracks may disagree rhythmically, so the grid is the union of every note
 * boundary. Each slot records the pitches sounding throughout it; a pitch that
 * began before the slot is marked as a continuation so the writer can tie it
 * rather than re-articulate it.
 */

import {
  isRest,
  measureBeats,
  type Note,
  type NoteEvent,
  type Pitch,
  type SequenceContent,
  type TimeSignature,
} from "@viritura/core";
import { sequenceContentBeats } from "../../commands/noteCommands";

const EPSILON = 1e-9;

/** A clipboard sequence and its offset from the copied selection's origin. */
export interface ContentGridSource {
  content: readonly SequenceContent[];
  leadInBeats: number;
}

/**
 * How a timeline relates to the measure grid.
 *
 * A tuplet's interior is its own unmetered timeline measured in notated inner
 * beats, so barlines and beat structure do not apply there. `startBeat` lets a
 * metered timeline that begins part-way through a measure place its barlines
 * where they actually fall.
 */
export interface RhythmContext {
  timeSignature: TimeSignature;
  metered: boolean;
  startBeat: number;
}

/** The metered timeline beginning at `startBeat` of a measure. */
export function meteredRhythm(timeSignature: TimeSignature, startBeat = 0): RhythmContext {
  return { timeSignature, metered: true, startBeat };
}

/** The unmetered timeline inside a tuplet, measured in notated inner beats. */
export function tupletRhythm(timeSignature: TimeSignature): RhythmContext {
  return { timeSignature, metered: false, startBeat: 0 };
}

/** A pitch sounding through a grid slot. */
export interface SoundingNote {
  note: Note;
  pitch: Pitch;
  /** The event the note was copied from, carrying its articulations and lyrics. */
  event: NoteEvent;
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
  event: NoteEvent;
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
      for (const note of item.notes ?? []) into.push({ start: beat, end: beat + beats, note, event: item });
    }
    beat += beats;
  }
}

function slotBoundaries(intervals: readonly NoteInterval[], duration: number, rhythm: RhythmContext): number[] {
  const boundaries = new Set<number>([0]);
  for (const interval of intervals) {
    if (interval.start > EPSILON && interval.start < duration - EPSILON) boundaries.add(round(interval.start));
    if (interval.end > EPSILON && interval.end < duration - EPSILON) boundaries.add(round(interval.end));
  }
  const capacity = rhythm.metered ? measureBeats(rhythm.timeSignature) : 0;
  if (capacity > EPSILON) {
    const offset = rhythm.startBeat % capacity;
    for (let beat = capacity - offset; beat < duration - EPSILON; beat += capacity) {
      if (beat > EPSILON) boundaries.add(round(beat));
    }
  }
  return [...boundaries].sort((left, right) => left - right);
}

/** Build the union-of-onsets grid for clipboard track content. */
export function buildBeatGrid(sources: readonly ContentGridSource[], rhythm: RhythmContext): BeatGrid | null {
  if (sources.some((source) => source.content.some((item) => item.type !== "event" && item.type !== "space"))) {
    return null;
  }

  const duration = Math.max(0, ...sources.map(sourceDuration));
  if (duration <= EPSILON) return { duration: 0, slots: [] };

  const intervals: NoteInterval[] = [];
  for (const source of sources) collectIntervals(source, intervals);
  const boundaries = slotBoundaries(intervals, duration, rhythm);
  const slots = boundaries.map((beat, index) => {
    const beats = (boundaries[index + 1] ?? duration) - beat;
    const notes = intervals
      .filter((interval) => interval.start <= beat + EPSILON && interval.end >= beat + beats - EPSILON)
      .map((interval) => ({
        note: interval.note,
        pitch: interval.note.pitch,
        event: interval.event,
        continuation: interval.start < beat - EPSILON,
      }));
    return { beat, beats, notes };
  });
  return { duration, slots };
}
