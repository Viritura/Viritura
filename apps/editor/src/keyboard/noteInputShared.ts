/**
 * Shared helpers for note input mode (cursor/clef/ottava resolution,
 * optimistic-paint event emission, accidental stepping). Extracted from
 * noteInputHandlers.ts so individual handler files can use them without
 * pulling in the full handler module.
 */

import type { Score, Pitch, Clef, AccidentalType } from "@viritura/core";
import { clefLineFromBottom, clefReferencePitch, diatonicPosition } from "@viritura/core";
import type { KeyboardHandlerContext } from "./types";
import { resolveVoiceTarget, type LaneRef } from "../voiceLanes";

const OPTIMISTIC_NOTE_INPUT_EVENT = "viritura:optimistic-note-input";

/** Clamp a cursor staff index to the selected part's local staff range. */
export function normalizePartLocalStaffIndex(score: Score, partIndex: number, staffIndex: number): number {
  const part = score.parts[partIndex];
  if (!part) return 0;
  const sequenceStaffCount = part.measures.reduce(
    (max, measure) => Math.max(max, ...measure.sequences.map((sequence) => sequence.staff ?? 1)),
    1,
  );
  const staffCount = Math.max(1, part.staves ?? sequenceStaffCount);
  return Math.max(0, Math.min(staffCount - 1, staffIndex));
}

export function staffPositionForPitch(pitch: Pitch, clef: Clef): number {
  return (4 - clefLineFromBottom(clef)) * 2 - (diatonicPosition(pitch) - clefReferencePitch(clef));
}

export function emitOptimisticNoteInput(args: {
  cursor: { measureIndex: number; beatPosition: number; partIndex: number; staffIndex?: number };
  staffPosition: number;
  duration: string;
  accidental: string | null;
  isRest: boolean;
}): void {
  if (args.isRest || typeof window === "undefined") return;
  // Mark the input boundary so InputCursor can measure `viritura:input-to-paint`
  // for real keyboard entry (the keydown→emit handler gap is sub-millisecond).
  performance.mark("viritura:input-event");
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_NOTE_INPUT_EVENT, { detail: args }));
}

/**
 * Resolve the active clef for a specific staff (0-based) at a given measure
 * by walking backwards through measures. Falls back to treble for staff 0,
 * bass for staff 1+.
 */
export function resolveActiveClefForStaff(
  score: Score,
  partIndex: number,
  staffIndex: number,
  measureIndex: number,
): Clef {
  const staffNumber = normalizePartLocalStaffIndex(score, partIndex, staffIndex) + 1;
  const defaultClef: Clef = staffNumber >= 2 ? { sign: "F", staffPosition: 2 } : { sign: "G", staffPosition: -2 };
  const part = score.parts[partIndex];
  if (!part) return defaultClef;
  for (let m = measureIndex; m >= 0; m--) {
    const meas = part.measures[m];
    if (meas?.clefs && meas.clefs.length > 0) {
      const staffClef = meas.clefs.find((c) => c.staff === staffNumber || c.staff == null);
      if (staffClef) return staffClef.clef;
    }
  }
  return defaultClef;
}

/**
 * Resolve the ottava shift (in octaves) active at a given beat position on
 * a staff within a measure. Returns +1 for 8va, -1 for 8vb, +2 for 15ma,
 * -2 for 15mb, or 0 if no ottava is active.
 */
export function resolveOttavaShift(
  score: Score,
  partIndex: number,
  staffIndex: number,
  measureIndex: number,
  beatPosition: number,
): number {
  const staffNumber = staffIndex + 1;
  const measure = score.parts[partIndex]?.measures[measureIndex];
  if (!measure?.ottavas) return 0;

  for (const ott of measure.ottavas) {
    if (ott.staff != null && ott.staff !== staffNumber) continue;

    const startBeat = ott.position.fraction[1] !== 0 ? (ott.position.fraction[0] / ott.position.fraction[1]) * 4 : 0;

    if (beatPosition < startBeat - 1e-9) continue;

    const endMeasureIdx = parseInt(ott.end.measure, 10);
    const isEndInLaterMeasure = !isNaN(endMeasureIdx) && endMeasureIdx > measureIndex;
    const isEndInSameMeasure = !isNaN(endMeasureIdx) && endMeasureIdx === measureIndex;

    if (isEndInLaterMeasure) {
      // spans into later measures — cursor under it
    } else if (isEndInSameMeasure) {
      const endBeat =
        ott.end.position.fraction[1] !== 0 ? (ott.end.position.fraction[0] / ott.end.position.fraction[1]) * 4 : 0;
      if (beatPosition >= endBeat - 1e-9) continue;
    }

    const octaves = (ott.value ?? 8) === 15 ? 2 : 1;
    const direction = ott.placement === "below" ? -1 : 1;
    return direction * octaves;
  }

  return 0;
}

/** Ordered accidental levels from most-flat to most-sharp. */
const ACCIDENTAL_LEVELS: AccidentalType[] = [
  "triple-flat",
  "double-flat",
  "flat",
  "natural",
  "sharp",
  "double-sharp",
  "triple-sharp",
];

/** Step the current accidental up (+1 = sharper) or down (-1 = flatter).
 *  null (no accidental) is treated as "natural" for stepping purposes.
 *  Returns null if already at the boundary (noop). */
export function stepAccidental(current: string | null, direction: 1 | -1): AccidentalType | null {
  const effective = current ?? "natural";
  const idx = ACCIDENTAL_LEVELS.indexOf(effective as AccidentalType);
  const cur = idx === -1 ? 3 : idx;
  const next = cur + direction;
  if (next < 0 || next >= ACCIDENTAL_LEVELS.length) return null;
  return ACCIDENTAL_LEVELS[next] ?? null;
}

/** The input lane (voice lane + staff) the note-input cursor is writing into. */
export function currentLaneRef(currentScore: Score, ctx: KeyboardHandlerContext): LaneRef {
  const ni = ctx.getNoteInput();
  const partIndex = ni.cursorPosition?.partIndex ?? 0;
  const staffIdx = normalizePartLocalStaffIndex(currentScore, partIndex, ni.cursorPosition?.staffIndex ?? 0);
  return { lane: ni.currentVoice, staff: staffIdx + 1 };
}

/**
 * Resolve the sequence index of the current voice lane in the cursor's measure.
 *
 * Lanes, not array slots, identify voices: a bar may hold its Down 1 voice in
 * any slot, or not at all. When the lane is absent this returns one past the
 * last sequence, which is where `prepareLaneSequence` would create it.
 */
export function resolveSeqIndex(currentScore: Score, ctx: KeyboardHandlerContext): number {
  const ni = ctx.getNoteInput();
  const partIndex = ni.cursorPosition?.partIndex ?? 0;
  const part = currentScore.parts[partIndex];
  const measure = part?.measures[ni.cursorPosition?.measureIndex ?? 0] ?? part?.measures[0];
  if (!measure) return ni.currentVoice - 1;
  return resolveVoiceTarget(measure.sequences, currentLaneRef(currentScore, ctx)) ?? measure.sequences.length;
}
