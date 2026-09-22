/**
 * The chord-distribution writer.
 *
 * One engine serves explode (1 staff → N), reduce (N → 1), and arbitrary
 * many-to-many redistribution: every case is "pool the pitches sounding on the
 * source staves, then re-lay them across the target staves". Source staves that
 * are not also targets are emptied to rests, which is what makes a reduce
 * actually reduce.
 *
 * Distribution rewrites only the beat window the selection covers, splicing
 * around whatever each target staff already holds. Additional voices on a
 * target staff are left alone and reported, because silently folding them in
 * would discard authored part-writing.
 */

import {
  measureBeats,
  pitchToMidi,
  type Note,
  type NoteEvent,
  type Score,
  type Sequence,
  type SequenceContent,
  type TimeSignature,
} from "@viritura/core";
import {
  createRest,
  decomposeDuration,
  decomposeRestsAtPosition,
  generateEventId,
  getEffectiveTimeSignature,
  sequenceContentBeats,
} from "../../commands/noteCommands";
import { produce } from "../scoreClone";
import { allocateTopDown, pitchKey, sortByPitchDescending } from "./allocation";
import { buildBeatGrid, type MeasureGrid, type SoundingNote } from "./beatGrid";
import { cloneNoteForChord } from "./chordMerge";
import type { MeasureWindow } from "./selectionRange";
import { sameStaff, staffSequenceIndex, staffVoiceCount, type StaffRef } from "./staffOrder";

const EPSILON = 1e-9;

export interface RedistributeParams {
  sources: readonly StaffRef[];
  targets: readonly StaffRef[];
  /** The beat spans to rewrite; music outside them is preserved. */
  windows: readonly MeasureWindow[];
}

export interface RedistributeResult {
  score: Score;
  warnings: string[];
  changed: boolean;
}

/** Per-target memory of the last note emitted for each pitch, for tie continuation. */
type TieCarry = Map<string, Note>;

function emitRests(beat: number, beats: number, time: TimeSignature): NoteEvent[] {
  return decomposeRestsAtPosition(beats, beat, time).map((duration) => createRest(duration));
}

/**
 * Emit one slot's chord for a single target, splitting it into tied pieces when
 * the slot length is not a single note value. `carry` links a sustained pitch
 * back to its previous slot; pitches that moved staves simply re-articulate.
 */
function emitChord(slot: { beats: number }, assigned: readonly SoundingNote[], carry: TieCarry): NoteEvent[] {
  const durations = decomposeDuration(slot.beats);
  const events: NoteEvent[] = [];
  const emittedKeys = new Set(assigned.map((entry) => pitchKey(entry.pitch)));
  // Allocation hands pitches over top-down, but a chord is stored low-to-high.
  const stacked = [...assigned].sort((left, right) => pitchToMidi(left.pitch) - pitchToMidi(right.pitch));

  for (const [pieceIndex, duration] of durations.entries()) {
    const notes: Note[] = stacked.map((entry) => {
      const note = cloneNoteForChord(entry.note);
      const key = pitchKey(entry.pitch);
      const previous = carry.get(key);
      // Only the first piece continues from a prior slot; later pieces always
      // continue from the piece this loop just emitted.
      if (previous && (pieceIndex > 0 || entry.continuation)) previous.ties = [{ target: note.id! }];
      carry.set(key, note);
      return note;
    });
    events.push({ type: "event", id: generateEventId(), duration, notes });
  }

  for (const key of [...carry.keys()]) {
    if (!emittedKeys.has(key)) carry.delete(key);
  }
  return events;
}

function buildTargetContent(grid: MeasureGrid, targetCount: number, time: TimeSignature): NoteEvent[][] {
  const content: NoteEvent[][] = Array.from({ length: targetCount }, () => []);
  const carries: TieCarry[] = Array.from({ length: targetCount }, () => new Map());

  for (const slot of grid.slots) {
    const allocations = allocateTopDown(sortByPitchDescending(slot.notes), targetCount);
    for (let index = 0; index < targetCount; index++) {
      const assigned = allocations[index]!;
      if (assigned.length === 0) {
        carries[index]!.clear();
        content[index]!.push(...emitRests(slot.beat, slot.beats, time));
      } else {
        content[index]!.push(...emitChord(slot, assigned, carries[index]!));
      }
    }
  }
  return content;
}

/**
 * Get (creating if needed) the primary sequence for `ref` in `measureIndex`.
 * Returns null when the part has no such measure at all.
 */
function ensureStaffSequence(draft: Score, ref: StaffRef, measureIndex: number): Sequence | null {
  const measure = draft.parts[ref.partIndex]?.measures[measureIndex];
  if (!measure) return null;
  const index = staffSequenceIndex(draft, ref, measureIndex);
  if (index >= 0) return measure.sequences[index]!;
  const created: Sequence = ref.staff > 1 ? { content: [], staff: ref.staff } : { content: [] };
  measure.sequences.push(created);
  return created;
}

function writeSequence(sequence: Sequence, window: MeasureWindow, content: NoteEvent[], time: TimeSignature): void {
  // A full-measure sequence has no explicit content to splice around.
  if (sequence.fullMeasure) {
    delete sequence.fullMeasure;
    sequence.content = [
      ...emitRests(0, window.start, time),
      ...content,
      ...emitRests(window.end, measureBeats(time) - window.end, time),
    ];
    return;
  }
  spliceWindow(sequence, window, content, time);
}

/**
 * Replace `window` within `sequence` with `content`, keeping everything
 * outside it. The window was snapped to event boundaries on the source staves,
 * but a target staff may still straddle an edge, so the target's own enclosing
 * events are absorbed and the uncovered remainder is re-filled with rests.
 */
function spliceWindow(sequence: Sequence, window: MeasureWindow, content: NoteEvent[], time: TimeSignature): void {
  const head: SequenceContent[] = [];
  const tail: SequenceContent[] = [];
  let coveredStart = window.start;
  let coveredEnd = window.end;
  let beat = 0;

  for (const item of sequence.content) {
    const itemStart = beat;
    const itemEnd = beat + sequenceContentBeats(item);
    beat = itemEnd;
    if (itemEnd <= window.start + EPSILON) head.push(item);
    else if (itemStart >= window.end - EPSILON) tail.push(item);
    else {
      // Straddles the window: absorbed, and its overhang becomes rests.
      coveredStart = Math.min(coveredStart, itemStart);
      coveredEnd = Math.max(coveredEnd, itemEnd);
    }
  }

  sequence.content = [
    ...head,
    ...emitRests(coveredStart, window.start - coveredStart, time),
    ...content,
    ...emitRests(window.end, coveredEnd - window.end, time),
    ...tail,
  ];
}

function collectVoiceWarnings(score: Score, refs: readonly StaffRef[], measureIndex: number, into: Set<string>): void {
  for (const ref of refs) {
    if (staffVoiceCount(score, ref, measureIndex) > 1) {
      const name = score.parts[ref.partIndex]?.name ?? `Part ${ref.partIndex + 1}`;
      into.add(`${name} staff ${ref.staff} has more than one voice; only the first voice was redistributed.`);
    }
  }
}

/**
 * Redistribute the pitches on `sources` across `targets` for every measure in
 * the range. Returns the original score untouched when there is nothing to do.
 */
export function redistributeStaves(score: Score, params: RedistributeParams): RedistributeResult {
  const { sources, targets, windows } = params;
  if (sources.length === 0 || targets.length === 0 || windows.length === 0) {
    return { score, warnings: [], changed: false };
  }

  const grid = buildBeatGrid(score, sources, windows);
  if (grid.measures.length === 0) {
    return {
      score,
      warnings: ["Nothing was redistributed: the selection only covers tuplets, tremolos, or grace notes."],
      changed: false,
    };
  }

  const warnings = new Set<string>();
  if (grid.skippedMeasures.length > 0) {
    const list = grid.skippedMeasures.map((index) => index + 1).join(", ");
    warnings.add(`Measures ${list} contain tuplets, tremolos, or grace notes and were left unchanged.`);
  }
  const silenced = sources.filter((source) => !targets.some((target) => sameStaff(target, source)));

  const next = produce(score, (draft) => {
    for (const measure of grid.measures) {
      const time = getEffectiveTimeSignature(draft, measure.measureIndex);
      collectVoiceWarnings(draft, [...targets, ...silenced], measure.measureIndex, warnings);
      const content = buildTargetContent(measure, targets.length, time);
      for (const [index, ref] of targets.entries()) {
        const sequence = ensureStaffSequence(draft, ref, measure.measureIndex);
        if (sequence) writeSequence(sequence, measure.window, content[index]!, time);
      }
      for (const ref of silenced) {
        const sequence = ensureStaffSequence(draft, ref, measure.measureIndex);
        const rests = emitRests(measure.window.start, measure.window.end - measure.window.start, time);
        if (sequence) writeSequence(sequence, measure.window, rests, time);
      }
    }
  });

  return { score: next, warnings: [...warnings], changed: next !== score };
}
