import type { Octave, Pitch, Step } from "@viritura/core";
import { MuseScoreConversionError } from "./errors";

const FIFTHS_STEPS: readonly Step[] = ["F", "C", "G", "D", "A", "E", "B"];
const NATURAL_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const BASE_TPC: Record<Step, number> = { F: 13, C: 14, G: 15, D: 16, A: 17, E: 18, B: 19 };

export function pitchFromMidiTpc(midi: number, tpc: number, path: string): Pitch {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127 || !Number.isInteger(tpc) || tpc < -1 || tpc > 33) {
    throw new MuseScoreConversionError("invalid-pitch", "pitch or TPC is outside the supported range", path);
  }
  const shifted = tpc - 13;
  const index = ((shifted % 7) + 7) % 7;
  const alter = Math.floor(shifted / 7);
  const step = FIFTHS_STEPS[index]!;
  const octaveValue = (midi - NATURAL_SEMITONES[step] - alter) / 12 - 1;
  if (!Number.isInteger(octaveValue) || octaveValue < 0 || octaveValue > 9) {
    throw new MuseScoreConversionError("invalid-pitch", "MIDI pitch and TPC spelling disagree", path);
  }
  return alter === 0 ? { step, octave: octaveValue as Octave } : { step, octave: octaveValue as Octave, alter };
}

export function midiFromPitch(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + NATURAL_SEMITONES[pitch.step] + (pitch.alter ?? 0);
}

export function tpcFromPitch(pitch: Pitch): number {
  return BASE_TPC[pitch.step] + (pitch.alter ?? 0) * 7;
}
