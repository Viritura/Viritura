/**
 * Transpose commands — transpose selected notes chromatically or diatonically.
 *
 * Chromatic transposition shifts by semitones preserving enharmonic spelling
 * as closely as possible. Diatonic transposition shifts by scale degrees
 * respecting the key signature.
 */

import type { Score, NoteEvent, Pitch, ScorePatch, SequenceContent } from "@viritura/core";
import { diatonicPosition, patch, pitchToMidi } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import { getEventAtLocation } from "../score/ElementPath";
import type { EventLocation } from "../score/ElementPath";
import { cloneScore } from "../score/scoreClone";

// ═══════════════════════════════════════════
// Pitch transposition helpers
// ═══════════════════════════════════════════

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Semitone offset from C for each step. */
const _STEP_SEMITONES: Record<Step, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * Transpose a pitch chromatically by a number of semitones.
 * Prefers natural spellings, then sharps, then flats.
 */
export function transposePitchChromatic(pitch: Pitch, semitones: number): Pitch {
  if (semitones % 12 === 0) {
    return {
      ...pitch,
      octave: Math.max(0, Math.min(9, pitch.octave + semitones / 12)) as Octave,
    };
  }
  const midi = pitchToMidi(pitch) + semitones;
  const clampedMidi = Math.max(0, Math.min(127, midi));
  const octave = Math.floor(clampedMidi / 12) - 1;
  const pc = ((clampedMidi % 12) + 12) % 12;
  return simplestSpelling(pc, octave);
}

/** Pick the simplest enharmonic spelling for a pitch class. */
function simplestSpelling(pc: number, octave: number): Pitch {
  const NATURAL_PCS: [Step, number][] = [
    ["C", 0],
    ["D", 2],
    ["E", 4],
    ["F", 5],
    ["G", 7],
    ["A", 9],
    ["B", 11],
  ];
  // Try natural first
  for (const [step, semi] of NATURAL_PCS) {
    if (semi === pc) {
      return { step, octave: Math.max(0, Math.min(9, octave)) as Octave };
    }
  }
  // Try sharps
  for (const [step, semi] of NATURAL_PCS) {
    if ((semi + 1) % 12 === pc) {
      return { step, octave: Math.max(0, Math.min(9, octave)) as Octave, alter: 1 };
    }
  }
  // Try flats
  for (const [step, semi] of NATURAL_PCS) {
    if ((semi - 1 + 12) % 12 === pc) {
      let o = octave;
      if (step === "C") o += 1; // Cb is in the next octave down
      return { step, octave: Math.max(0, Math.min(9, o)) as Octave, alter: -1 };
    }
  }
  // Should not reach here, but fallback
  return { step: "C", octave: Math.max(0, Math.min(9, octave)) as Octave };
}

// ═══════════════════════════════════════════
// Key signature helpers
// ═══════════════════════════════════════════

/**
 * Order of sharps and flats on the circle of fifths.
 * Sharps: F C G D A E B  (positive fifths add sharps in this order)
 * Flats:  B E A D G C F  (negative fifths add flats in this order)
 */
const SHARP_ORDER: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly Step[] = ["B", "E", "A", "D", "G", "C", "F"];

/**
 * Get the alteration (sharp/flat) that a key signature applies to a given step.
 * E.g., for D major (fifths=2): C→1, F→1, all others→0
 * For Bb major (fifths=-2): B→-1, E→-1, all others→0
 */
export function getKeySignatureAlter(step: Step, keyFifths: number): number {
  if (keyFifths > 0) {
    // Sharps: first N steps in SHARP_ORDER get alter=1
    for (let i = 0; i < Math.min(keyFifths, 7); i++) {
      if (SHARP_ORDER[i] === step) return 1;
    }
  } else if (keyFifths < 0) {
    // Flats: first |N| steps in FLAT_ORDER get alter=-1
    const count = Math.min(-keyFifths, 7);
    for (let i = 0; i < count; i++) {
      if (FLAT_ORDER[i] === step) return -1;
    }
  }
  return 0;
}

// ═══════════════════════════════════════════
// Diatonic transposition
// ═══════════════════════════════════════════

/**
 * Transpose a pitch diatonically by a number of scale degrees.
 * Moves to the next/previous letter name and applies the key signature's
 * alteration for that step. Any accidental outside the key signature
 * is dropped — the note snaps to the key's diatonic pitch.
 *
 * Example in D major (F#, C#):
 *   C#4 +1 → D4 (D is natural in D major)
 *   F#4 +1 → G4 (G is natural in D major)
 *   E4  +1 → F#4 (F is sharp in D major)
 *   Eb4 +1 → F#4 (extra flat dropped, F is sharp in D major)
 */
export function transposePitchDiatonic(pitch: Pitch, steps: number, keyFifths: number): Pitch {
  // Move diatonically (by letter name)
  const diatonic = diatonicPosition(pitch) + steps;
  const newStepIndex = ((diatonic % 7) + 7) % 7;
  const newStep = STEPS[newStepIndex]!;
  const newOctave = Math.floor(diatonic / 7);

  // Apply the key signature's alter for the new step (drop any extra accidental)
  const newKeyAlter = getKeySignatureAlter(newStep, keyFifths);

  const clampedOctave = Math.max(0, Math.min(9, newOctave)) as Octave;
  return newKeyAlter === 0
    ? { step: newStep, octave: clampedOctave }
    : { step: newStep, octave: clampedOctave, alter: newKeyAlter };
}

// ═══════════════════════════════════════════
// Note-entry pitch resolution (written ↔ sounding)
// ═══════════════════════════════════════════

/** A note-entry pitch in both representations the editor needs. */
export interface EntryPitchPair {
  /** The pitch on the staff the user sees — what they typed or clicked. Use
   *  this for audio preview and octave memory (`lastPitch`). */
  written: Pitch;
  /** The concert/sounding pitch MNX stores. Use this for score mutation. */
  sounding: Pitch;
}

/**
 * Resolve a note-entry gesture's WRITTEN pitch into both the written pitch
 * (for audio preview + octave memory) and the SOUNDING pitch MNX stores.
 *
 * This is the single source of truth shared by the keyboard and click note-
 * entry paths, so preview, octave memory, and storage can never drift apart
 * (the cause of two prior transposing-instrument bugs). When the part is
 * concert-pitch, has no transposition, or the score isn't displaying written
 * pitches, the two representations are identical.
 *
 * `keyFifths` is the concert-pitch key signature at the entry measure; callers
 * resolve it from their own context (e.g. `resolveKeyAtMeasure`).
 *
 * Convention (MNX): sounding + interval = written.
 */
export function resolveEntryPitch(written: Pitch, score: Score, partIndex: number, keyFifths: number): EntryPitchPair {
  const writtenPitch: Pitch = { ...written };
  const globalUseWritten = score.scores?.[0]?.useWritten ?? false;
  const partTransposition = score.parts[partIndex]?.transposition;
  const prefersWritten = partTransposition?.prefersWrittenPitches ?? false;
  if (!(globalUseWritten || prefersWritten) || !partTransposition) {
    return { written: writtenPitch, sounding: { ...writtenPitch } };
  }

  const { staffDistance, halfSteps } = partTransposition.interval;
  // Pure octave transpositions (piccolo, double bass, …): shift the octave only.
  if (Math.abs(staffDistance) === 7 && Math.abs(halfSteps) === 12) {
    const sounding: Pitch = { ...writtenPitch, octave: (writtenPitch.octave - Math.sign(staffDistance)) as Octave };
    return { written: writtenPitch, sounding };
  }

  const sounding = transposePitchDiatonic(writtenPitch, -staffDistance, keyFifths);
  const diatonicHalfSteps = pitchToMidi(sounding) - pitchToMidi(writtenPitch);
  if (Math.abs(diatonicHalfSteps - -halfSteps) > 0.5) {
    sounding.alter = (sounding.alter ?? 0) + (-halfSteps - diatonicHalfSteps);
  }
  return { written: writtenPitch, sounding };
}

// ═══════════════════════════════════════════
// Transpose parameters
// ═══════════════════════════════════════════

export type TransposeMode = "chromatic" | "diatonic";
export type TransposeDirection = "up" | "down";

/** Chromatic interval sizes in semitones. */
export const CHROMATIC_INTERVALS: Record<string, number> = {
  "Minor 2nd": 1,
  "Major 2nd": 2,
  "Minor 3rd": 3,
  "Major 3rd": 4,
  "Perfect 4th": 5,
  Tritone: 6,
  "Perfect 5th": 7,
  "Minor 6th": 8,
  "Major 6th": 9,
  "Minor 7th": 10,
  "Major 7th": 11,
  Octave: 12,
};

/** Diatonic interval sizes in scale degrees. */
export const DIATONIC_INTERVALS: Record<string, number> = {
  "2nd": 1,
  "3rd": 2,
  "4th": 3,
  "5th": 4,
  "6th": 5,
  "7th": 6,
  Octave: 7,
};

export interface TransposeParams {
  direction: TransposeDirection;
  mode: TransposeMode;
  interval: string;
}

// ═══════════════════════════════════════════
// Score mutation: transpose selected notes
// ═══════════════════════════════════════════

/** Transpose a single note event's pitches in-place. */
function transposeEvent(
  event: SequenceContent,
  mode: TransposeMode,
  amount: number,
  keyFifths: number,
  noteIndex?: number,
): void {
  if (event.type !== "event") return;
  const noteEvent = event as NoteEvent;
  if (!noteEvent.notes || noteEvent.notes.length === 0) return;

  if (noteIndex !== undefined && noteIndex < noteEvent.notes.length) {
    // Transpose only the targeted note in the chord
    const note = noteEvent.notes[noteIndex]!;
    note.pitch =
      mode === "chromatic"
        ? transposePitchChromatic(note.pitch, amount)
        : transposePitchDiatonic(note.pitch, amount, keyFifths);
  } else {
    for (const note of noteEvent.notes) {
      note.pitch =
        mode === "chromatic"
          ? transposePitchChromatic(note.pitch, amount)
          : transposePitchDiatonic(note.pitch, amount, keyFifths);
    }
  }
}

/** Resolve the active key signature at a given measure index. */
export function resolveKeyAtMeasure(score: Score, measureIndex: number): number {
  let fifths = 0;
  for (let m = 0; m <= measureIndex; m++) {
    const gm = score.global.measures[m];
    if (gm?.key) fifths = gm.key.fifths;
  }
  return fifths;
}

/**
 * Transpose all notes at the given locations.
 * Returns a new Score (immutable).
 */
export function transposeNotes(score: Score, locations: EventLocation[], mode: TransposeMode, amount: number): Score {
  const newScore = cloneScore(score);

  for (const loc of locations) {
    const event = getEventAtLocation(newScore, loc);
    if (!event) continue;

    const keyFifths = resolveKeyAtMeasure(newScore, loc.measureIndex);
    transposeEvent(event, mode, amount, keyFifths, loc.noteIndex);
  }

  return newScore;
}

/**
 * Plan an ID-addressed transpose without cloning the Score.
 *
 * Returns `null` when any selected target lacks the stable IDs required by the
 * patch interpreter; callers then use {@link transposeNotes} as a conservative
 * compatibility fallback. The all-or-nothing choice prevents half-applying a
 * multi-selection.
 */
export function planTransposeNotes(
  score: Score,
  locations: EventLocation[],
  mode: TransposeMode,
  amount: number,
): ScorePatch[] | null {
  if (locations.length === 0) return null;
  const patches: ScorePatch[] = [];

  for (const loc of locations) {
    const part = score.parts[loc.partIndex];
    const event = getEventAtLocation(score, loc);
    if (!part?.id || event?.type !== "event" || !event.id || !event.notes?.length) return null;

    const keyFifths = resolveKeyAtMeasure(score, loc.measureIndex);
    const targets = loc.noteIndex === undefined ? event.notes.map((note) => note) : [event.notes[loc.noteIndex]];
    if (targets.some((note) => !note?.id)) return null;

    const locator = {
      sequencePath: {
        partId: part.id,
        measureIndex: loc.measureIndex,
        voice: loc.sequenceIndex,
      },
      eventId: event.id,
    };
    for (const note of targets) {
      if (!note?.id) return null;
      const pitch =
        mode === "chromatic"
          ? transposePitchChromatic(note.pitch, amount)
          : transposePitchDiatonic(note.pitch, amount, keyFifths);
      patches.push(patch.setNotePitch(locator, note.id, pitch));
    }
  }

  return patches.length > 0 ? patches : null;
}
