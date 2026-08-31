/**
 * Helpers extracted from `handleNoteInputArrowUpDown` to keep the dispatcher slim.
 * Splits plain-arrow navigation, transpose-target lookup, and per-arrow
 * transposition into separate units.
 */

import type { Score, Pitch, Octave } from "@viritura/core";
import { isRest } from "@viritura/core";
import type { CursorPosition } from "./types";
import { transposePitchChromatic, transposePitchDiatonic, resolveKeyAtMeasure } from "../commands/transposeCommands";
import { durationToBeats, findLastNoteEvent, sequenceContentBeats } from "../commands/noteCommands";
import { defaultPitchForClef } from "../input/octaveLogic";
import { produce } from "../score/scoreClone";
import type { KeyboardHandlerContext } from "./types";
import { resolveActiveClefForStaff, resolveOttavaShift } from "./noteInputShared";

type NoteInputCursorSnapshot = CursorPosition;

/** Plain arrow (no modifiers): move cursor between parts/staves.
 *  Returns true if movement was handled, false to fall through to transpose. */
export function arrowNavigateStaffPart(
  e: KeyboardEvent,
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  cursor: NoteInputCursorSnapshot,
): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;

  const partIndex = cursor.partIndex ?? 0;
  const part = currentScore.parts[partIndex];
  const partCount = currentScore.parts.length;
  const staffCount = part?.staves ?? 1;
  const staffIdx = cursor.staffIndex ?? 0;
  let newStaffIdx = staffIdx;
  let newPartIndex = partIndex;

  if (e.key === "ArrowUp" && staffIdx > 0) {
    newStaffIdx = staffIdx - 1;
    ctx.setCursor({ ...cursor, staffIndex: newStaffIdx });
  } else if (e.key === "ArrowDown" && staffIdx < staffCount - 1) {
    newStaffIdx = staffIdx + 1;
    ctx.setCursor({ ...cursor, staffIndex: newStaffIdx });
  } else if (e.key === "ArrowUp" && partIndex > 0) {
    newPartIndex = partIndex - 1;
    newStaffIdx = 0;
    ctx.setCursor({ ...cursor, partIndex: newPartIndex, staffIndex: 0 });
  } else if (e.key === "ArrowDown" && partIndex < partCount - 1) {
    newPartIndex = partIndex + 1;
    newStaffIdx = 0;
    ctx.setCursor({ ...cursor, partIndex: newPartIndex, staffIndex: 0 });
  } else {
    return true; // no movement happened but the key was handled
  }

  if (newPartIndex !== partIndex || newStaffIdx !== staffIdx) {
    const clef = resolveActiveClefForStaff(currentScore, newPartIndex, newStaffIdx, cursor.measureIndex);
    const ott = resolveOttavaShift(currentScore, newPartIndex, newStaffIdx, cursor.measureIndex, cursor.beatPosition);
    ctx.setLastPitch(defaultPitchForClef(clef, ott));
  }
  return true;
}

interface TransposeLoc {
  measureIndex: number;
  eventIndex: number;
}

/** Find the note event to transpose: prefer the event at the cursor's beat,
 *  otherwise fall back to the last note in the voice. */
export function findTransposeTarget(
  currentScore: Score,
  ctx: KeyboardHandlerContext,
  cursor: NoteInputCursorSnapshot,
  voiceIdx: number,
): TransposeLoc | null {
  const partIndex = cursor.partIndex ?? 0;
  const seq = currentScore.parts[partIndex]?.measures[cursor.measureIndex]?.sequences[voiceIdx];
  if (seq) {
    let accBeats = 0;
    for (let i = 0; i < seq.content.length; i++) {
      const ev = seq.content[i];
      if (!ev) continue;
      // Containers (tuplet/tremolo/grace/space) aren't top-level transpose
      // targets, but their real-time beats must still advance accBeats so the
      // threshold test below doesn't mis-fire on a later top-level event.
      if (ev.type !== "event") {
        accBeats += sequenceContentBeats(ev);
        continue;
      }
      const evBeats = durationToBeats(ev.duration);
      if (accBeats + evBeats >= cursor.beatPosition - 1e-9 && !isRest(ev)) {
        return { measureIndex: cursor.measureIndex, eventIndex: i };
      }
      accBeats += evBeats;
    }
  }
  return findLastNoteEvent(currentScore, partIndex, voiceIdx);
}

function pickTransposeMode(e: KeyboardEvent): "octave" | "diatonic" | "chromatic" | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.altKey && !e.shiftKey) return "octave";
  if (!mod && e.altKey && e.shiftKey) return "chromatic";
  if (!mod && e.altKey) return "diatonic";
  return null;
}

function applyTransposeToNotes(
  notes: { pitch: Pitch }[],
  mode: "octave" | "diatonic" | "chromatic",
  direction: 1 | -1,
  keyFifths: number,
): void {
  if (mode === "octave") {
    const semitones = 12 * direction;
    for (const note of notes) note.pitch = transposePitchChromatic(note.pitch, semitones);
  } else if (mode === "diatonic") {
    for (const note of notes) note.pitch = transposePitchDiatonic(note.pitch, direction, keyFifths);
  } else {
    for (const note of notes) note.pitch = transposePitchChromatic(note.pitch, direction);
  }
}

function updateOctaveMemoryFromEvent(
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  resultScore: Score,
  partIndex: number,
  voiceIdx: number,
  loc: TransposeLoc,
): void {
  const ev = resultScore.parts[partIndex]?.measures[loc.measureIndex]?.sequences[voiceIdx]?.content[loc.eventIndex];
  if (!ev || ev.type !== "event" || !ev.notes?.length) return;
  const firstNote = ev.notes[0];
  if (!firstNote) return;

  const partTransposition = currentScore.parts[partIndex]?.transposition;
  const globalUseWritten = currentScore.scores?.[0]?.useWritten ?? false;
  const prefersWritten = partTransposition?.prefersWrittenPitches ?? false;
  if ((globalUseWritten || prefersWritten) && partTransposition) {
    const { staffDistance, halfSteps } = partTransposition.interval;
    if (Math.abs(staffDistance) === 7 && Math.abs(halfSteps) === 12) {
      ctx.setLastPitch({
        ...firstNote.pitch,
        octave: (firstNote.pitch.octave + Math.sign(staffDistance)) as Octave,
      });
      return;
    }
  }
  ctx.setLastPitch(firstNote.pitch);
}

/** Apply transposition (octave / diatonic / chromatic) to the located event. */
export function applyArrowTranspose(
  e: KeyboardEvent,
  ctx: KeyboardHandlerContext,
  currentScore: Score,
  cursor: NoteInputCursorSnapshot,
  voiceIdx: number,
  loc: TransposeLoc,
): void {
  const mode = pickTransposeMode(e);
  if (!mode) return;
  const direction: 1 | -1 = e.key === "ArrowUp" ? 1 : -1;
  const partIndex = cursor.partIndex ?? 0;
  const keyFifths = resolveKeyAtMeasure(currentScore, cursor.measureIndex ?? 0);

  const newScore = produce(currentScore, (draft) => {
    const ev = draft.parts[partIndex]?.measures[loc.measureIndex]?.sequences[voiceIdx]?.content[loc.eventIndex];
    if (ev && ev.type === "event" && ev.notes?.length) {
      applyTransposeToNotes(ev.notes, mode, direction, keyFifths);
    }
  });
  if (newScore !== currentScore) {
    ctx.updateScore(newScore);
    updateOctaveMemoryFromEvent(ctx, currentScore, newScore, partIndex, voiceIdx, loc);
  }
}
