import type { Pitch as RawPitch } from "../raw";
import type { Step, Octave } from "../enums";
import type { Narrow } from "./_derive";

/**
 * A musical pitch. Derived from MNX raw `pitch`, with `octave` narrowed
 * from raw's open `number` to the finite tuple-union `Octave` (0..9) so
 * exhaustive switches and bounds checks work at compile time.
 *
 * Raw fields preserved:
 *   - step: "A"|"B"|"C"|"D"|"E"|"F"|"G"
 *   - alter?: chromatic alteration in semitones
 */
export type Pitch = Narrow<RawPitch, { octave: Octave }>;

/**
 * Compute the diatonic staff position of a pitch relative to a reference.
 * Position 0 = reference pitch, positive = above, negative = below.
 * Each step is 1 position (= half a staff space).
 */
export function diatonicPosition(pitch: Pitch): number {
  const stepPositions: Record<string, number> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
  };
  return stepPositions[pitch.step]! + pitch.octave * 7;
}

/**
 * Compute MIDI note number for a pitch.
 */
export function pitchToMidi(pitch: Pitch): number {
  const stepSemitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  return (pitch.octave + 1) * 12 + stepSemitones[pitch.step]! + (pitch.alter ?? 0);
}

const STEPS_ASCENDING: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

/**
 * Build a Pitch result, only including alter when defined.
 */
function makePitch(step: Step, octave: Octave, alter: number | undefined): Pitch {
  const result: Pitch = { step, octave };
  if (alter !== undefined) {
    result.alter = alter;
  }
  return result;
}

/**
 * Move a pitch up by one diatonic step, preserving the alteration.
 * B4 → C5 (crosses octave boundary).
 */
export function stepPitchUp(pitch: Pitch): Pitch {
  const idx = STEPS_ASCENDING.indexOf(pitch.step);
  if (idx === 6) {
    const nextOctave = (pitch.octave + 1) as Octave;
    const clamped = (nextOctave > 9 ? 9 : nextOctave) as Octave;
    return makePitch("C", clamped, pitch.alter);
  }
  return makePitch(STEPS_ASCENDING[idx + 1]!, pitch.octave, pitch.alter);
}

/**
 * Move a pitch down by one diatonic step, preserving the alteration.
 * C4 → B3 (crosses octave boundary).
 */
export function stepPitchDown(pitch: Pitch): Pitch {
  const idx = STEPS_ASCENDING.indexOf(pitch.step);
  if (idx === 0) {
    const prevOctave = (pitch.octave - 1) as Octave;
    const clamped = (prevOctave < 0 ? 0 : prevOctave) as Octave;
    return makePitch("B", clamped, pitch.alter);
  }
  return makePitch(STEPS_ASCENDING[idx - 1]!, pitch.octave, pitch.alter);
}

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"] as const;

/**
 * Construct a Pitch from its diatonic position (C0=0, D0=1, …, B0=6, C1=7, …).
 * Handles negative diatonic positions correctly.
 * @param alter Optional chromatic alteration in semitones.
 */
export function pitchFromDiatonic(diatonic: number, alter?: number): Pitch {
  const octave = Math.floor(diatonic / 7) as Octave;
  const stepIndex = ((diatonic % 7) + 7) % 7; // safe modulo for negatives
  const step = STEPS[stepIndex]!;
  return alter !== undefined ? { step, octave, alter } : { step, octave };
}
